/**
 * @module main
 * @description 浏览器入口逻辑：协调 UI、TTS 请求与 BigMouthAvatar 渲染。
 */

import { BigMouthAvatar } from './avatar.js';
import {
  MouthSignal,
  speakWithWebSpeech,
  generatePlaceholderTimeline,
  requestServerTts,
  playWithAnalyser,
  resolveServerUrl,
} from './lipsync.js';
import { DEFAULT_AUTO_GAIN_CONFIG } from './auto-gain.js';

/**
 * DOM 引用。
 */
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('stickbot-canvas'));
const textArea = /** @type {HTMLTextAreaElement} */ (document.getElementById('speech-text'));
const useWebSpeechCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('use-webspeech'));
const playButton = /** @type {HTMLButtonElement} */ (document.getElementById('play-btn'));
const stopButton = /** @type {HTMLButtonElement} */ (document.getElementById('stop-btn'));
const rateSlider = /** @type {HTMLInputElement} */ (document.getElementById('rate-slider'));
const pitchSlider = /** @type {HTMLInputElement} */ (document.getElementById('pitch-slider'));
const rateDisplay = document.getElementById('rate-display');
const pitchDisplay = document.getElementById('pitch-display');
const mouthProgress = /** @type {HTMLProgressElement} */ (document.getElementById('mouth-progress'));
const providerSelect = /** @type {HTMLSelectElement} */ (document.getElementById('tts-provider'));
const providerHint = document.getElementById('provider-hint');
const renderSelect = /** @type {HTMLSelectElement} */ (document.getElementById('render-mode'));
const visemeDisplay = document.getElementById('viseme-display');
const autoGainToggle = /** @type {HTMLInputElement} */ (document.getElementById('auto-gain-toggle'));

// 初始化渲染器
const avatar = new BigMouthAvatar(canvas);
avatar.start();
overlayInfo('stickbot 已就绪，优先使用服务端时间轴驱动。');

// 口型信号
const mouthSignal = new MouthSignal();
mouthSignal.subscribe((frame) => {
  avatar.setMouthFrame(frame);
  mouthProgress.value = frame.value;
  if (visemeDisplay) {
    visemeDisplay.textContent = `viseme ${Math.round(frame.visemeId)} · ${frame.phoneme}`;
  }
});

const AUTO_GAIN_STORAGE_KEY = 'stickbot:auto-gain';

const loadAutoGainPreference = () => {
  if (!autoGainToggle) {
    return { enabled: true, config: { ...DEFAULT_AUTO_GAIN_CONFIG } };
  }
  let enabled = true;
  let config = { ...DEFAULT_AUTO_GAIN_CONFIG };
  try {
    const raw = window.localStorage?.getItem(AUTO_GAIN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.enabled === 'boolean') {
        enabled = parsed.enabled;
      }
      if (parsed?.config && typeof parsed.config === 'object') {
        config = { ...config, ...parsed.config };
      }
    }
  } catch (error) {
    console.warn('[stickbot] 读取自动增益设置失败', error);
  }
  autoGainToggle.checked = enabled;
  return { enabled, config };
};

let autoGainPreference = loadAutoGainPreference();

const applyAutoGainPreference = (enabled, config) => {
  autoGainPreference = { enabled, config };
  mouthSignal.setAutoGain(enabled, config);
};

if (autoGainToggle) {
  applyAutoGainPreference(autoGainPreference.enabled, autoGainPreference.config);
  autoGainToggle.addEventListener('change', () => {
    applyAutoGainPreference(autoGainToggle.checked, autoGainPreference.config);
  });
} else {
  mouthSignal.setAutoGain(true, autoGainPreference.config);
}

/** @type {AbortController|null} */
let currentAbort = null;
/** @type {HTMLAudioElement|null} */
let currentAudio = null;
/** @type {number|null} */
let placeholderTimer = null;
/** @type {(() => void)|null} */
let currentAudioCleanup = null;

/**
 * 输出调试信息。
 * @param {string} message - 文案。
 */
function overlayInfo(message) {
  console.info(`[stickbot] ${message}`);
  if (providerHint) {
    providerHint.textContent = message;
  }
}

/**
 * 停止当前流程。
 */
function stopCurrentPlayback() {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
  if (placeholderTimer) {
    clearTimeout(placeholderTimer);
    placeholderTimer = null;
  }
  if (currentAudio) {
    currentAudio.pause();
  }
  if (currentAudioCleanup) {
    currentAudioCleanup();
    currentAudioCleanup = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  mouthSignal.stop();
  overlayInfo('已停止当前播放。');
}

// 滑条即时更新数值显示
rateSlider.addEventListener('input', () => {
  rateDisplay.textContent = rateSlider.value;
});
pitchSlider.addEventListener('input', () => {
  pitchDisplay.textContent = pitchSlider.value;
});

// 渲染模式切换
renderSelect.addEventListener('change', async () => {
  const mode = renderSelect.value;
  const ok = await avatar.setRenderMode(mode);
  if (!ok) {
    overlayInfo('未检测到 Sprite 资源，已回退至 Vector 模式。');
    renderSelect.value = 'vector';
  } else {
    overlayInfo(`已切换至 ${mode} 渲染模式。`);
  }
});

/**
 * 播放按钮点击逻辑。
 */
playButton.addEventListener('click', async () => {
  const text = textArea.value.trim();
  if (!text) {
    overlayInfo('请输入要朗读的文本，已播放占位口型。');
    const timeline = generatePlaceholderTimeline('...');
    const startTime = performance.now();
    mouthSignal.start();
    mouthSignal.playTimeline(timeline, () => (performance.now() - startTime) / 1000);
    const duration = timeline.length > 0 ? timeline[timeline.length - 1].t : 1;
    if (placeholderTimer) {
      clearTimeout(placeholderTimer);
    }
    placeholderTimer = window.setTimeout(() => {
      placeholderTimer = null;
      mouthSignal.stop();
    }, (duration + 0.4) * 1000);
    return;
  }

  stopCurrentPlayback();
  playButton.disabled = true;
  overlayInfo('开始请求 TTS...');

  try {
    const provider = providerSelect.value;
    const speechRate = parseFloat(rateSlider.value);
    const espeakRate = Math.max(80, Math.round(170 * speechRate));
    currentAbort = new AbortController();

    let serverResult = null;
    try {
      serverResult = await requestServerTts(text, {
        provider,
        rate: espeakRate,
        abortSignal: currentAbort.signal,
      });
    } catch (error) {
      console.warn('调用服务端 TTS 失败，将尝试 Web Speech 或回退。', error);
    }

    if (serverResult && Array.isArray(serverResult.mouthTimeline) && serverResult.mouthTimeline.length > 0 && serverResult.audioUrl) {
      overlayInfo('使用服务端时间轴驱动口型。');
      await playWithTimeline(serverResult);
    } else if (serverResult && serverResult.audioUrl) {
      overlayInfo('服务端未提供时间轴，改用音量包络分析。');
      await playWithAnalyserUrl(serverResult.audioUrl);
    } else if (useWebSpeechCheckbox.checked && 'speechSynthesis' in window) {
      overlayInfo('使用 Web Speech API 作为兜底。');
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[a-zA-Z]/.test(text) ? 'en-US' : 'zh-CN';
      utterance.rate = speechRate;
      utterance.pitch = parseFloat(pitchSlider.value);
      await speakWithWebSpeech(utterance, mouthSignal);
    } else {
      overlayInfo('无法使用服务端或 Web Speech，播放占位时间轴。');
      const placeholder = generatePlaceholderTimeline(text);
      const startTime = performance.now();
      mouthSignal.start();
      mouthSignal.playTimeline(placeholder, () => (performance.now() - startTime) / 1000);
      const duration = placeholder.length > 0 ? placeholder[placeholder.length - 1].t : 1;
      if (placeholderTimer) {
        clearTimeout(placeholderTimer);
      }
      placeholderTimer = window.setTimeout(() => {
        placeholderTimer = null;
        mouthSignal.stop();
      }, (duration + 0.4) * 1000);
    }
  } catch (error) {
    console.error('播放失败：', error);
    overlayInfo(`播放失败：${error instanceof Error ? error.message : String(error)}`);
    mouthSignal.stop();
  } finally {
    playButton.disabled = false;
    currentAbort = null;
    overlayInfo('播放流程结束。');
  }
});

// 停止按钮
stopButton.addEventListener('click', () => {
  stopCurrentPlayback();
});

// 页面隐藏时自动停止，避免后台播放
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCurrentPlayback();
  }
});

// 不支持 Web Speech 时禁用选项
if (!('speechSynthesis' in window)) {
  useWebSpeechCheckbox.checked = false;
  useWebSpeechCheckbox.disabled = true;
  overlayInfo('当前浏览器不支持 Web Speech API，已禁用相关选项。');
}

/**
 * 使用时间轴播放音频。
 * @param {{ audioUrl: string, mouthTimeline: import('./lipsync.js').TimelinePoint[], duration: number }} result - 服务端返回。
 */
async function playWithTimeline(result) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(resolveServerUrl(result.audioUrl));
    currentAudio = audio;
    audio.crossOrigin = 'anonymous';

    let settled = false;

    const finalize = (status, error) => {
      if (settled) return;
      settled = true;
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      currentAudio = null;
      currentAudioCleanup = null;
      mouthSignal.stop();
      if (status === 'error') {
        reject(error || new Error('音频播放失败'));
      } else {
        resolve();
      }
    };

    const handlePlay = () => {
      mouthSignal.start();
      mouthSignal.playTimeline(result.mouthTimeline, () => audio.currentTime);
    };

    const handleEnded = () => {
      finalize('ended');
    };

    const handleError = (event) => {
      finalize('error', event.error);
    };

    audio.addEventListener('play', handlePlay, { once: true });
    audio.addEventListener('ended', handleEnded, { once: true });
    audio.addEventListener('error', handleError, { once: true });

    currentAudioCleanup = () => {
      finalize('manual');
    };

    audio.play().catch((error) => {
      finalize('error', error);
    });
  });
}

/**
 * 通过音量包络播放音频。
 * @param {string} url - 音频地址。
 */
async function playWithAnalyserUrl(url) {
  if (!url) return;
  const response = await fetch(resolveServerUrl(url), { signal: currentAbort?.signal });
  await playWithAnalyser(response, mouthSignal);
}

/**
 * 查询服务端可用 provider，更新下拉框禁用状态。
 */
async function initProviderAvailability() {
  try {
    const response = await fetch(resolveServerUrl('/'));
    const data = await response.json();
    const available = Array.isArray(data.providers) ? data.providers : [];
    const azureOption = providerSelect.querySelector('option[value="azure"]');
    if (azureOption && !available.includes('azure')) {
      azureOption.disabled = true;
      if (providerSelect.value === 'azure') {
        providerSelect.value = 'espeak';
      }
      if (providerHint) {
        providerHint.textContent = 'Azure 未启用，请在 .env 配置密钥后重启服务端。';
      }
    }
  } catch (error) {
    console.warn('获取 provider 列表失败：', error);
  }
}

initProviderAvailability();

