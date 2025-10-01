/**
 * @module lipsync
 * @description 提供口型信号控制、时间轴插值以及多种驱动策略的封装。
 *              第二轮中优先使用服务端返回的 mouthTimeline，仍保留 Web Speech 与音量包络作为兜底。
 */

import { AutoGainProcessor, DEFAULT_AUTO_GAIN_CONFIG } from './auto-gain.js';

/**
 * @typedef {Object} MouthFrame
 * @property {number} value - mouth 数值，范围 [0,1]。
 * @property {number} visemeId - 当前口型编号。
 * @property {string} phoneme - 来源音素或事件标识。
 */

/**
 * @typedef {Object} TimelinePoint
 * @property {number} t - 时间（秒）。
 * @property {number} v - mouth 值。
 * @property {number} visemeId - 口型编号。
 * @property {string} [phoneme] - 可选音素标签。
 */

/**
 * @typedef {Object} PulseOptions
 * @property {number} [strength] - 口型脉冲强度，默认 0.8。
 * @property {number} [visemeId] - 可选口型编号。
 * @property {string} [phoneme] - 自定义音素标签。
 */

/**
 * 口型控制器基础配置。
 */
const SIGNAL_CONFIG = {
  decay: 0.9, // 逐帧衰减系数
  minValue: 0.04, // 避免完全闭嘴造成角色僵硬
};

const AUTO_GAIN_STORAGE_KEY = 'stickbot:auto-gain';

/**
 * 计算服务端基础地址。默认指向与前端同主机的 8787 端口，亦可通过 window.STICKBOT_SERVER_ORIGIN 覆盖。
 * @returns {string} 服务端基础地址。
 */
const detectServerOrigin = () => {
  if (typeof window === 'undefined') {
    return 'http://localhost:8787';
  }
  if (window.STICKBOT_SERVER_ORIGIN) {
    return window.STICKBOT_SERVER_ORIGIN;
  }
  const protocol = window.location?.protocol || 'http:';
  const hostname = window.location?.hostname || 'localhost';
  const configuredPort = window.STICKBOT_SERVER_PORT || '8787';
  if (window.location?.port && window.location.port === String(configuredPort)) {
    return `${protocol}//${hostname}${window.location.port ? `:${window.location.port}` : ''}`;
  }
  return `${protocol}//${hostname}:${configuredPort}`;
};

const SERVER_ORIGIN = detectServerOrigin();

/**
 * 将相对路径转换为服务端的绝对 URL。
 * @param {string} path - 相对或绝对路径。
 * @returns {string} 可用于 fetch 的地址。
 */
export const resolveServerUrl = (path) => {
  if (!path) return SERVER_ORIGIN;
  if (/^https?:/i.test(path)) {
    return path;
  }
  return new URL(path, SERVER_ORIGIN).toString();
};

/**
 * @callback MouthSubscriber
 * @param {MouthFrame} frame - mouth 帧数据。
 */

/**
 * @class MouthSignal
 * @description 负责维护 mouth 数值、连接各类驱动源并在 RAF 循环中做插值。
 */
export class MouthSignal {
  constructor() {
    /** @type {Set<MouthSubscriber>} */
    this.subscribers = new Set();
    /** @type {MouthFrame} */
    this.frame = { value: SIGNAL_CONFIG.minValue, visemeId: 0, phoneme: 'idle' };
    /** @type {number|null} */
    this.rafId = null;
    /** @type {number} */
    this.lastTick = 0;
    /** @type {AnalyserNode|null} */
    this.analyser = null;
    /** @type {Float32Array|null} */
    this.analyserBuffer = null;
    /** @type {TimelinePlayback|null} */
    this.timelinePlayback = null;
    /** @type {boolean} */
    this.autoGainEnabled = false;
    /** @type {{ windowSec: number, targetRMS: number, floor: number, ceil: number, smoothing?: number }} */
    this.autoGainConfig = { ...DEFAULT_AUTO_GAIN_CONFIG };
  }

  /**
   * 订阅 mouth 帧。
   * @param {MouthSubscriber} fn - 回调函数。
   * @returns {() => void} 取消订阅方法。
   */
  subscribe(fn) {
    this.subscribers.add(fn);
    fn(this.frame);
    return () => this.subscribers.delete(fn);
  }

  /**
   * 直接设置 mouth 帧，常用于外部插值结果。
   * @param {Partial<MouthFrame>} patch - 要更新的字段。
   */
  setFrame(patch) {
    const value = patch.value ?? this.frame.value;
    const visemeId = patch.visemeId ?? this.frame.visemeId;
    const phoneme = patch.phoneme ?? this.frame.phoneme;
    const clamped = Math.max(SIGNAL_CONFIG.minValue, Math.min(1, value));
    this.frame = { value: clamped, visemeId, phoneme };
    this.emit();
  }

  /**
   * 兼容旧逻辑的数值设置。
   * @param {number} value - mouth 值。
   */
  setValue(value) {
    this.setFrame({ value });
  }

  /**
   * 触发一次脉冲，例如 Web Speech boundary 事件。
   * @param {PulseOptions} [options] - 脉冲配置。
   */
  pulse(options = {}) {
    const strength = options.strength ?? 0.8;
    const visemeId = options.visemeId ?? 2;
    const phoneme = options.phoneme ?? 'pulse';
    this.setFrame({ value: Math.max(this.frame.value, strength), visemeId, phoneme });
  }

  /**
   * 开始 RAF 循环。
   */
  start() {
    if (this.rafId !== null) return;
    const loop = (timestamp) => {
      this.tick(timestamp);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * 停止循环并重置状态。
   */
  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTick = 0;
    this.timelinePlayback = null;
    this.analyser = null;
    this.analyserBuffer = null;
    this.setFrame({ value: SIGNAL_CONFIG.minValue, visemeId: 0, phoneme: 'idle' });
  }

  /**
   * RAF tick：根据当前驱动源更新 mouth。
   * @param {number} timestamp - RAF 时间戳（毫秒）。
   */
  tick(timestamp) {
    if (!this.lastTick) {
      this.lastTick = timestamp;
    }
    const delta = (timestamp - this.lastTick) / (1000 / 60);
    this.lastTick = timestamp;

    if (this.timelinePlayback) {
      const done = this.timelinePlayback.update();
      if (done) {
        this.timelinePlayback = null;
      }
      return;
    }

    if (this.analyser && this.analyserBuffer) {
      this.updateFromAnalyser();
      return;
    }

    // 默认衰减
    const decayed = this.frame.value * Math.pow(SIGNAL_CONFIG.decay, delta);
    this.setFrame({ value: decayed, phoneme: 'decay' });
  }

  /**
   * 绑定 Web Audio analyser，用于音量包络回退策略。
   * @param {AnalyserNode} analyser - Web Audio 分析器。
   */
  attachAnalyser(analyser) {
    this.analyser = analyser;
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.6;
    this.analyserBuffer = new Float32Array(this.analyser.fftSize);
  }

  /**
   * 解除 analyser 绑定。
   */
  detachAnalyser() {
    this.analyser = null;
    this.analyserBuffer = null;
  }

  /**
   * 基于 analyser 数据计算 RMS 并映射到 mouth。
   */
  updateFromAnalyser() {
    if (!this.analyser || !this.analyserBuffer) return;
    this.analyser.getFloatTimeDomainData(this.analyserBuffer);
    let sum = 0;
    for (const sample of this.analyserBuffer) {
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.analyserBuffer.length);
    const mapped = Math.min(1, rms * 12);
    this.setFrame({ value: mapped, phoneme: 'rms', visemeId: mapped > 0.6 ? 8 : mapped > 0.3 ? 5 : 2 });
  }

  /**
   * 使用时间轴驱动口型。
   * @param {TimelinePoint[]} timeline - mouth 时间轴。
   * @param {() => number} clock - 返回当前播放进度（秒）的函数，例如 AudioElement.currentTime。
   */
  playTimeline(timeline, clock) {
    const autoGain = this.autoGainEnabled ? this.autoGainConfig : null;
    this.timelinePlayback = new TimelinePlayback(timeline, clock, (value, visemeId, phoneme) => {
      this.setFrame({ value, visemeId, phoneme });
    }, autoGain);
  }

  /**
   * 广播当前帧给所有订阅者。
   */
  emit() {
    for (const fn of this.subscribers) {
      fn(this.frame);
    }
  }

  /**
   * 设置自动增益状态。
   * @param {boolean} enabled - 是否启用。
   * @param {{ windowSec?: number, targetRMS?: number, floor?: number, ceil?: number, smoothing?: number }} [config] - 可选配置。
   */
  setAutoGain(enabled, config = {}) {
    this.autoGainEnabled = Boolean(enabled);
    this.autoGainConfig = { ...DEFAULT_AUTO_GAIN_CONFIG, ...config };
    if (this.timelinePlayback) {
      this.timelinePlayback.setAutoGain(this.autoGainEnabled ? this.autoGainConfig : null);
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(
          AUTO_GAIN_STORAGE_KEY,
          JSON.stringify({ enabled: this.autoGainEnabled, config: this.autoGainConfig }),
        );
      } catch (error) {
        console.warn('[stickbot] 保存自动增益状态失败', error);
      }
    }
  }
}

/**
 * TimelinePlayback 根据给定 clock 对时间轴做线性插值。
 */
class TimelinePlayback {
  /**
   * @param {TimelinePoint[]} timeline - mouth 时间轴。
   * @param {() => number} clock - 播放进度函数，返回秒。
   * @param {(value: number, visemeId: number, phoneme: string) => void} onFrame - 帧更新回调。
   * @param {{ windowSec?: number, targetRMS?: number, floor?: number, ceil?: number, smoothing?: number }|null} autoGain - 自动增益配置。
   */
  constructor(timeline, clock, onFrame, autoGain = null) {
    this.timeline = timeline;
    this.clock = clock;
    this.onFrame = onFrame;
    this.duration = timeline.length > 0 ? timeline[timeline.length - 1].t : 0;
    this.index = 0;
    this.autoGain = autoGain ? new AutoGainProcessor(timeline, autoGain) : null;
  }

  /**
   * 更新一次口型，返回是否播放完毕。
   * @returns {boolean} 是否结束。
   */
  update() {
    if (this.timeline.length === 0) {
      this.onFrame(SIGNAL_CONFIG.minValue, 0, 'idle');
      return true;
    }
    const time = this.clock();
    if (!Number.isFinite(time)) {
      return false;
    }
    if (time >= this.duration) {
      const last = this.timeline[this.timeline.length - 1];
      this.onFrame(last.v, last.visemeId, last.phoneme || 'tail');
      return true;
    }
    while (this.index < this.timeline.length && this.timeline[this.index].t < time) {
      this.index += 1;
    }
    const next = this.timeline[this.index] ?? this.timeline[this.timeline.length - 1];
    const prev = this.timeline[this.index - 1] ?? next;
    const span = Math.max(next.t - prev.t, 1e-6);
    const ratio = (time - prev.t) / span;
    let value = prev.v + (next.v - prev.v) * ratio;
    const visemeId = ratio > 0.5 ? next.visemeId : prev.visemeId;
    const phoneme = ratio > 0.5 ? (next.phoneme || 'blend') : (prev.phoneme || 'blend');
    if (this.autoGain) {
      value = this.autoGain.apply(time, value).value;
    }
    this.onFrame(value, visemeId, phoneme);
    return false;
  }

  /**
   * 更新自动增益配置。
   * @param {{ windowSec?: number, targetRMS?: number, floor?: number, ceil?: number, smoothing?: number }|null} autoGain - 自动增益配置。
   */
  setAutoGain(autoGain) {
    if (autoGain) {
      this.autoGain = new AutoGainProcessor(this.timeline, autoGain);
    } else {
      this.autoGain = null;
    }
  }
}

/**
 * 生成一个占位时间轴，确保没有音频时也能看到口型变化。
 * @param {string} text - 输入文本。
 * @returns {TimelinePoint[]} 占位时间轴。
 */
export const generatePlaceholderTimeline = (text) => {
  const sanitized = text.trim();
  if (!sanitized) {
    return [
      { t: 0, v: 0.1, visemeId: 0, phoneme: 'idle' },
      { t: 0.3, v: 0.4, visemeId: 4, phoneme: 'idle' },
      { t: 0.6, v: 0.1, visemeId: 0, phoneme: 'idle' },
    ];
  }
  const points = [];
  const duration = Math.max(1.2, sanitized.length * 0.08);
  const syllables = Math.max(4, Math.floor(sanitized.length / 2));
  for (let i = 0; i <= syllables; i += 1) {
    const t = (i / syllables) * duration;
    const peak = 0.35 + Math.abs(Math.sin(i * 1.2)) * 0.55;
    const visemeId = peak > 0.8 ? 8 : peak > 0.6 ? 7 : peak > 0.4 ? 5 : 2;
    points.push({ t, v: peak, visemeId, phoneme: 'placeholder' });
  }
  points.push({ t: duration + 0.2, v: 0.1, visemeId: 0, phoneme: 'placeholder' });
  return points;
};

/**
 * 使用 Web Speech API 朗读文本并触发口型脉冲。
 * @param {SpeechSynthesisUtterance} utterance - 配置好的 utterance。
 * @param {MouthSignal} signal - 口型控制器。
 * @returns {Promise<void>} 完成时解析。
 */
export const speakWithWebSpeech = (utterance, signal) => {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('当前浏览器不支持 Web Speech API。'));
      return;
    }

    const handleBoundary = () => {
      signal.pulse({ strength: 0.85, visemeId: 4, phoneme: 'boundary' });
    };

    const handleStart = () => {
      signal.start();
    };

    const cleanup = () => {
      utterance.removeEventListener('boundary', handleBoundary);
      utterance.removeEventListener('start', handleStart);
      utterance.removeEventListener('end', handleEnd);
      utterance.removeEventListener('error', handleError);
    };

    const handleEnd = () => {
      cleanup();
      signal.stop();
      resolve();
    };

    const handleError = (event) => {
      cleanup();
      signal.stop();
      reject(event.error || new Error('Web Speech 出现未知错误'));
    };

    utterance.addEventListener('boundary', handleBoundary);
    utterance.addEventListener('start', handleStart);
    utterance.addEventListener('end', handleEnd);
    utterance.addEventListener('error', handleError);

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
};

/**
 * 请求服务端 `/tts` 接口，返回 JSON 结果。
 * @param {string} text - 合成文本。
 * @param {{ voice?: string, rate?: number, provider?: string, abortSignal?: AbortSignal, segmentIndex?: number, segmentCount?: number, segmentId?: string }} options - 请求参数。
 * @returns {Promise<{
 *   audioUrl: string,
 *   mouthTimeline: TimelinePoint[],
 *   wordTimeline?: { tStart: number, tEnd: number, text: string }[],
 *   duration: number,
 *   provider: string,
 *   sampleRate: number,
 * }>} 结果。
*/
export const requestServerTts = async (text, options = {}) => {
  const params = new URLSearchParams({ text });
  if (options.voice) params.set('voice', options.voice);
  if (options.rate) params.set('rate', String(options.rate));
  if (options.provider) params.set('provider', options.provider);
  if (Number.isFinite(options.segmentIndex)) params.set('segmentIndex', String(options.segmentIndex));
  if (Number.isFinite(options.segmentCount)) params.set('segmentCount', String(options.segmentCount));
  if (options.segmentId) params.set('segmentId', options.segmentId);
  const response = await fetch(resolveServerUrl(`/tts?${params.toString()}`), {
    method: 'GET',
    signal: options.abortSignal,
  });
  if (!response.ok) {
    throw new Error(`TTS 请求失败：${response.status}`);
  }
  const data = await response.json();
  return data;
};

/**
 * 使用 Web Audio analyser 播放音频并驱动口型，作为兜底方案。
 * @param {Response} response - fetch 返回的音频响应。
 * @param {MouthSignal} signal - mouth 控制器。
 */
export const playWithAnalyser = async (response, signal) => {
  const arrayBuffer = await response.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  const analyser = audioContext.createAnalyser();
  source.connect(analyser);
  analyser.connect(audioContext.destination);
  signal.attachAnalyser(analyser);
  signal.start();
  source.start();
  await new Promise((resolve) => source.addEventListener('ended', resolve));
  signal.detachAnalyser();
  signal.stop();
  await audioContext.close();
};

