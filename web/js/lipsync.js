/**
 * @module lipsync
 * @description 提供口型信号控制器，支持 Web Speech 边界事件脉冲、Web Audio 分析与文本占位包络三种方式。
 * 核心职责：
 * 1. 统一 mouth 值的发布，供 avatar.js 订阅；
 * 2. 在没有音频时提供可预期的衰减动画，避免角色僵硬；
 * 3. 为未来接入 mouthTimeline 留好扩展点，只需调用 playEnvelope 即可。
 */

/**
 * @typedef {Object} PulseOptions
 * @property {number} [strength] 脉冲幅度，范围 0-1，缺省为 0.8。
 */

/**
 * @typedef {Object} EnvelopePoint
 * @property {number} t - 时间（秒）。
 * @property {number} v - mouth 值（0-1）。
 */

/**
 * 口型控制器配置，可根据喜好调整。
 * @type {{decay: number, minValue: number}}
 */
const SIGNAL_CONFIG = {
  decay: 0.92, // 每帧衰减系数，越小衰减越快
  minValue: 0.02, // 避免完全归零导致画面僵硬
};

/**
 * @callback MouthSubscriber
 * @param {number} value - 当前 mouth 值。
 */

/**
 * @class MouthSignal
 * @description 负责维护 mouth 值、应用衰减并通知订阅者。
 */
export class MouthSignal {
  constructor() {
    /** @type {Set<MouthSubscriber>} */
    this.subscribers = new Set();
    /** @type {number} */
    this.value = 0;
    /** @type {number|null} */
    this.rafId = null;
    /** @type {number} */
    this.lastTick = 0;
    /** @type {AnalyserNode|null} */
    this.analyser = null;
    /** @type {Float32Array|null} */
    this.analyserBuffer = null;
    /** @type {EnvelopePlayback|null} */
    this.envelopePlayback = null;
  }

  /**
   * 订阅 mouth 更新。
   * @param {MouthSubscriber} fn - 回调函数。
   * @returns {() => void} 取消订阅方法。
   */
  subscribe(fn) {
    this.subscribers.add(fn);
    fn(this.value);
    return () => this.subscribers.delete(fn);
  }

  /**
   * 设置当前 mouth 值并通知订阅者。
   * @param {number} next - 新的 mouth 值，0-1。
   */
  setValue(next) {
    const clamped = Math.min(1, Math.max(0, next));
    this.value = Math.max(SIGNAL_CONFIG.minValue, clamped);
    this.emit();
  }

  /**
   * 触发一次脉冲，常用于 onboundary 事件。
   * @param {PulseOptions} [options]
   */
  pulse(options = {}) {
    const strength = options.strength ?? 0.8;
    this.setValue(Math.max(this.value, strength));
  }

  /**
   * 启动帧循环，实现自然衰减或监听音频分析结果。
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
   * 停止帧循环并重置状态。
   */
  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.analyser = null;
    this.analyserBuffer = null;
    this.envelopePlayback = null;
    this.setValue(0);
  }

  /**
   * 每帧调用，用于衰减或读取 analyser 数据。
   * @param {number} timestamp - 当前帧的毫秒时间戳。
   */
  tick(timestamp) {
    if (!this.lastTick) {
      this.lastTick = timestamp;
    }
    const delta = (timestamp - this.lastTick) / (1000 / 60);
    this.lastTick = timestamp;

    if (this.envelopePlayback) {
      this.updateFromEnvelope(timestamp);
      return;
    }

    if (this.analyser && this.analyserBuffer) {
      this.updateFromAnalyser();
    } else {
      // 无 analyser 时执行被动衰减，保持最小值
      const decayed = this.value * Math.pow(SIGNAL_CONFIG.decay, delta);
      this.value = Math.max(SIGNAL_CONFIG.minValue, decayed);
      this.emit();
    }
  }

  /**
   * 连接 Web Audio 分析器，用于能量包络回退。
   * @param {AnalyserNode} analyser - Web Audio 的 AnalyserNode。
   */
  attachAnalyser(analyser) {
    this.analyser = analyser;
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyserBuffer = new Float32Array(this.analyser.fftSize);
  }

  /**
   * 断开 analyser。
   */
  detachAnalyser() {
    this.analyser = null;
    this.analyserBuffer = null;
  }

  /**
   * 从 analyser 中读取信号并映射到 mouth 值。
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
    this.setValue(mapped);
  }

  /**
   * 播放 mouth 时间轴。
   * @param {EnvelopePoint[]} timeline - 按时间排序的 mouth 值。
   * @param {number} startTimestamp - requestAnimationFrame 的毫秒时间戳。
   */
  playEnvelope(timeline, startTimestamp) {
    this.envelopePlayback = new EnvelopePlayback(timeline, startTimestamp, (v) => this.setValue(v));
  }

  /**
   * envelope 播放器驱动。
   * @param {number} timestamp - 当前帧时间戳（毫秒）。
   */
  updateFromEnvelope(timestamp) {
    if (!this.envelopePlayback) return;
    const done = this.envelopePlayback.update(timestamp);
    if (done) {
      this.envelopePlayback = null;
    }
  }

  /**
   * 通知所有订阅者。
   */
  emit() {
    for (const fn of this.subscribers) {
      fn(this.value);
    }
  }
}

/**
 * EnvelopePlayback 负责根据时间轴插值 mouth 值。
 */
class EnvelopePlayback {
  /**
   * @param {EnvelopePoint[]} timeline - mouth 时间轴。
   * @param {number} startTimestamp - 播放开始时的帧时间戳（毫秒）。
   * @param {(value: number) => void} onValue - 更新回调。
   */
  constructor(timeline, startTimestamp, onValue) {
    this.timeline = timeline;
    this.startTimestamp = startTimestamp;
    this.onValue = onValue;
    this.duration = timeline.length > 0 ? timeline[timeline.length - 1].t : 0;
  }

  /**
   * @param {number} timestamp - 当前帧时间戳（毫秒）。
   * @returns {boolean} 是否播放结束。
   */
  update(timestamp) {
    const elapsed = (timestamp - this.startTimestamp) / 1000;
    if (elapsed >= this.duration) {
      this.onValue(this.timeline.length ? this.timeline[this.timeline.length - 1].v : SIGNAL_CONFIG.minValue);
      return true;
    }
    const nextIndex = this.timeline.findIndex((point) => point.t > elapsed);
    if (nextIndex === -1) {
      this.onValue(this.timeline[this.timeline.length - 1].v);
      return false;
    }
    if (nextIndex === 0) {
      this.onValue(this.timeline[0].v);
      return false;
    }
    const prev = this.timeline[nextIndex - 1];
    const next = this.timeline[nextIndex];
    const span = next.t - prev.t || 0.001;
    const factor = (elapsed - prev.t) / span;
    const value = prev.v + (next.v - prev.v) * factor;
    this.onValue(value);
    return false;
  }
}

/**
 * 根据文本生成一个占位的 mouth 时间轴，字符越多口型越丰富。
 * @param {string} text - 输入文本。
 * @returns {EnvelopePoint[]} 简单的占位时间轴。
 */
export const generatePlaceholderTimeline = (text) => {
  const sanitized = text.trim();
  if (!sanitized) {
    return [
      { t: 0, v: 0 },
      { t: 0.3, v: 0.1 },
      { t: 0.6, v: 0 },
    ];
  }
  const points = [];
  const baseDuration = Math.max(1, sanitized.length * 0.08);
  const syllableCount = Math.max(3, Math.floor(sanitized.length / 2));
  for (let i = 0; i < syllableCount; i += 1) {
    const t = (i / syllableCount) * baseDuration;
    const v = 0.4 + Math.abs(Math.sin(i * 1.3)) * 0.5;
    points.push({ t, v });
    points.push({ t: t + baseDuration / syllableCount / 2, v: 0.15 });
  }
  points.push({ t: baseDuration + 0.2, v: 0 });
  return points;
};

/**
 * 使用 Web Speech API 朗读文本，并在边界事件上触发口型脉冲。
 * @param {SpeechSynthesisUtterance} utterance - 已配置好的 utterance。
 * @param {MouthSignal} signal - 口型控制器。
 * @returns {Promise<void>} 朗读完成时解析。
 */
export const speakWithWebSpeech = (utterance, signal) => {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('当前浏览器不支持 Web Speech API。'));
      return;
    }

    const handleBoundary = () => {
      signal.pulse({ strength: 0.9 });
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
      reject(event.error || new Error('Speech 合成出现未知错误'));
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
 * 回退策略：请求 `/tts` 接口，若返回音频则分析音量包络，否则则使用占位时间轴。
 * @param {string} text - 待转换文本。
 * @param {MouthSignal} signal - 口型控制器。
 * @param {AbortSignal} [abortSignal] - 允许外部取消。
 */
export const fetchTtsFallback = async (text, signal, abortSignal) => {
  const response = await fetch(`/tts?text=${encodeURIComponent(text)}`, {
    method: 'GET',
    signal: abortSignal,
  });

  const contentType = response.headers.get('content-type') || '';
  if (contentType.startsWith('audio/')) {
    await playWithAnalyser(response, signal);
    return;
  }

  const message = await response.text();
  console.info('TTS 占位响应：', message);
  const timeline = generatePlaceholderTimeline(text);
  signal.start();
  signal.playEnvelope(timeline, performance.now());
};

/**
 * 将音频响应传入 Web Audio，实时分析能量。
 * @param {Response} response - fetch 返回的 Response。
 * @param {MouthSignal} signal - 口型控制器。
 */
const playWithAnalyser = async (response, signal) => {
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

  await new Promise((resolve) => {
    source.addEventListener('ended', () => {
      resolve();
    });
  });

  signal.detachAnalyser();
  signal.stop();
  await audioContext.close();
};
