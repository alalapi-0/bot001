/**
 * @module main
 * @description 浏览器入口脚本，负责页面交互、口型驱动策略选择以及与 avatar.js 的集成。
 * 设计原则：
 * 1. 将渲染与口型逻辑解耦，main.js 只处理 DOM 和策略切换；
 * 2. 对 Web Speech 与回退策略进行能力检测，确保在任何浏览器都不会抛错；
 * 3. 通过 AbortController 管理异步流程，避免重复点击造成状态紊乱。
 */

import { StickbotAvatar } from './avatar.js';
import { MouthSignal, speakWithWebSpeech, fetchTtsFallback, generatePlaceholderTimeline } from './lipsync.js';

/**
 * 页面初始化：查找 DOM 元素并建立引用。
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

// 初始化火柴人并启动动画循环
overlayInfo('初始化 stickbot...');
const avatar = new StickbotAvatar(canvas);
avatar.start();

// MouthSignal 作为口型事件总线
const mouthSignal = new MouthSignal();
mouthSignal.subscribe((value) => {
  avatar.setMouthValue(value);
  mouthProgress.value = value;
});

/** @type {AbortController|null} */
let currentAbort = null;

/**
 * 工具函数：更新进度文案。
 * @param {string} message - 要显示的提示。
 */
function overlayInfo(message) {
  // 以 console 为主，避免干扰 UI；未来可扩展为 toast
  console.info(`[stickbot] ${message}`);
}

/**
 * 工具函数：停止当前流程。
 */
function stopCurrentPlayback() {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  mouthSignal.stop();
  overlayInfo('已停止当前播放。');
}

// 绑定滑条显示
rateSlider.addEventListener('input', () => {
  rateDisplay.textContent = rateSlider.value;
});
pitchSlider.addEventListener('input', () => {
  pitchDisplay.textContent = pitchSlider.value;
});

// 播放按钮逻辑
playButton.addEventListener('click', async () => {
  const text = textArea.value.trim();
  if (!text) {
    overlayInfo('请输入要朗读的文本。');
    const timeline = generatePlaceholderTimeline('...');
    mouthSignal.start();
    mouthSignal.playEnvelope(timeline, performance.now());
    return;
  }

  stopCurrentPlayback();
  playButton.disabled = true;
  overlayInfo('开始演示口型同步。');

  try {
    if (useWebSpeechCheckbox.checked && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[a-zA-Z]/.test(text) ? 'en-US' : 'zh-CN';
      utterance.rate = parseFloat(rateSlider.value);
      utterance.pitch = parseFloat(pitchSlider.value);
      await speakWithWebSpeech(utterance, mouthSignal);
    } else {
      currentAbort = new AbortController();
      await fetchTtsFallback(text, mouthSignal, currentAbort.signal);
    }
  } catch (error) {
    console.error('播放失败：', error);
    mouthSignal.stop();
  } finally {
    playButton.disabled = false;
    currentAbort = null;
    overlayInfo('播放流程结束。');
  }
});

// 停止按钮逻辑
stopButton.addEventListener('click', () => {
  stopCurrentPlayback();
});

// 在页面失焦时也停止播放，避免后台语音造成困扰
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCurrentPlayback();
  }
});

// 为不支持 Web Speech 的浏览器展示一次提示
if (!('speechSynthesis' in window)) {
  useWebSpeechCheckbox.checked = false;
  useWebSpeechCheckbox.disabled = true;
  overlayInfo('当前浏览器不支持 Web Speech API，已自动切换为回退策略。');
}
