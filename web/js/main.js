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
import { MouthCapture } from './mouth-capture.js';

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
const roleSelect = /** @type {HTMLSelectElement} */ (document.getElementById('role-select'));
const roleDescription = document.getElementById('role-description');
const roleMeta = document.getElementById('role-meta');
const defaultRoleDescription = roleDescription?.textContent || '';
const visemeDisplay = document.getElementById('viseme-display');
const autoGainToggle = /** @type {HTMLInputElement} */ (document.getElementById('auto-gain-toggle'));
const webcamToggle = /** @type {HTMLInputElement} */ (document.getElementById('webcam-mouth-toggle'));
const webcamStatus = document.getElementById('webcam-status');
const wordTimelineBar = /** @type {HTMLDivElement} */ (document.getElementById('word-timeline-bar'));
const wordTimelineStatus = document.getElementById('word-timeline-status');
const wordVttInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('word-vtt-input'));
const applyVttButton = /** @type {HTMLButtonElement} */ (document.getElementById('apply-vtt-btn'));
const clearVttButton = /** @type {HTMLButtonElement} */ (document.getElementById('clear-vtt-btn'));
const useManualVttCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('use-manual-vtt'));

// 初始化渲染器
const avatar = new BigMouthAvatar(canvas);
avatar.start();
overlayInfo('stickbot 已就绪，优先使用服务端时间轴驱动。');

// 口型信号
const mouthSignal = new MouthSignal();
const mouthCapture = new MouthCapture();
mouthSignal.subscribe((frame) => {
  avatar.setMouthFrame(frame);
  mouthProgress.value = frame.value;
  if (visemeDisplay) {
    visemeDisplay.textContent = `viseme ${Math.round(frame.visemeId)} · ${frame.phoneme}`;
  }
});

/** @type {{ text: string, tStart: number, tEnd: number }[]} */
let serverWordTimeline = [];
/** @type {{ text: string, tStart: number, tEnd: number }[]} */
let manualWordTimeline = [];
/** @type {{ text: string, tStart: number, tEnd: number }[]} */
let activeWordTimeline = [];
/** @type {HTMLSpanElement[]} */
let wordChipElements = [];
/** @type {number|null} */
let wordHighlightRaf = null;
/** @type {number} */
let lastActiveWordIndex = -1;
/** @type {number|null} */
let wordStatusResetTimer = null;
/** @type {boolean} */
let audioDriving = false;

const AUTO_GAIN_STORAGE_KEY = 'stickbot:auto-gain';
const ROLE_STORAGE_KEY = 'stickbot:active-role';

/**
 * @typedef {Object} RoleProfile
 * @property {string} id - 角色唯一标识。
 * @property {string} [name] - 展示名称。
 * @property {string} [description] - 角色简介。
 * @property {string} [voice] - 默认语音 ID。
 * @property {Record<string, number>} [preset] - 表情预设。
 * @property {string} [theme] - 主题皮肤标识。
 * @property {string} [renderMode] - 默认渲染模式。
 */

const DEFAULT_ROLE = {
  id: 'default',
  name: '基础款',
  description: '默认表情与经典主题，适合大多数演示场景。',
  voice: 'zh',
  preset: {
    mouthOpenScale: 1,
    lipTension: 0,
    cornerCurve: 0.05,
    eyeBlinkBias: 0,
    headNodAmp: 0.2,
    swayAmp: 0.25,
  },
  theme: 'classic',
  renderMode: 'vector',
};

const hostStickBot = /** @type {HTMLElement & { setExpressionOverride?: (preset: Record<string, number>) => void, setTheme?: (theme: string) => void, setRenderMode?: (mode: string) => void }} */ (
  document.querySelector('stick-bot')
);

/** @type {RoleProfile[]} */
let availableRoles = [];
/** @type {RoleProfile|null} */
let activeRole = null;

const sanitizeRole = (role, fallbackId) => {
  const id = typeof role?.id === 'string' && role.id.trim() ? role.id.trim() : fallbackId;
  const preset = role && typeof role.preset === 'object' && role.preset ? role.preset : {};
  const renderMode = typeof role?.renderMode === 'string' && role.renderMode ? role.renderMode : 'vector';
  const theme = typeof role?.theme === 'string' && role.theme ? role.theme : 'classic';
  return {
    id,
    name: typeof role?.name === 'string' && role.name.trim() ? role.name.trim() : id,
    description: typeof role?.description === 'string' ? role.description : '',
    voice: typeof role?.voice === 'string' && role.voice ? role.voice : '',
    preset,
    theme: theme.toLowerCase(),
    renderMode: renderMode.toLowerCase(),
  };
};

const buildRoleMeta = (role) => {
  const parts = [];
  if (role?.voice) {
    parts.push(`voice: ${role.voice}`);
  }
  if (role?.renderMode) {
    parts.push(`渲染: ${role.renderMode}`);
  }
  if (role?.theme) {
    parts.push(`主题: ${role.theme}`);
  }
  return parts.join(' · ');
};

const applyTheme = (themeId) => {
  const body = document.body;
  if (!body) {
    return;
  }
  const target = themeId ? `theme-${themeId}` : 'theme-classic';
  body.classList.forEach((cls) => {
    if (cls.startsWith('theme-') && cls !== target) {
      body.classList.remove(cls);
    }
  });
  if (!body.classList.contains(target)) {
    body.classList.add(target);
  }
  if (hostStickBot && typeof hostStickBot.setTheme === 'function') {
    hostStickBot.setTheme(themeId);
  }
};

const applyExpressionPreset = (preset) => {
  const expression = preset && typeof preset === 'object' ? preset : {};
  if (hostStickBot && typeof hostStickBot.setExpressionOverride === 'function') {
    hostStickBot.setExpressionOverride(expression);
  }
  if (typeof avatar.setExpressionOverride === 'function') {
    avatar.setExpressionOverride(expression);
  }
};

const loadStoredRoleId = () => {
  try {
    return window.localStorage?.getItem(ROLE_STORAGE_KEY) || '';
  } catch (error) {
    console.warn('[stickbot] 读取角色档案失败', error);
    return '';
  }
};

const saveActiveRoleId = (roleId) => {
  try {
    window.localStorage?.setItem(ROLE_STORAGE_KEY, roleId);
  } catch (error) {
    console.warn('[stickbot] 保存角色档案失败', error);
  }
};

const populateRoleSelect = () => {
  if (!roleSelect) {
    return;
  }
  roleSelect.innerHTML = '';
  for (const role of availableRoles) {
    const option = document.createElement('option');
    option.value = role.id;
    option.textContent = role.name || role.id;
    roleSelect.appendChild(option);
  }
  roleSelect.disabled = availableRoles.length === 0;
};

const updateRoleDisplay = (role) => {
  if (roleDescription) {
    const text = role?.description && role.description.trim() ? role.description : defaultRoleDescription;
    roleDescription.textContent = text;
  }
  if (roleMeta) {
    roleMeta.textContent = buildRoleMeta(role || null);
  }
};

const applyRole = async (role, options = {}) => {
  if (!role) {
    return;
  }
  const persist = options.persist !== false;
  const sanitized = sanitizeRole(role, role.id || 'role');
  activeRole = { ...sanitized };

  if (roleSelect) {
    roleSelect.disabled = false;
    roleSelect.value = activeRole.id;
  }

  applyExpressionPreset(activeRole.preset);
  applyTheme(activeRole.theme);
  updateRoleDisplay(activeRole);

  if (renderSelect) {
    renderSelect.value = activeRole.renderMode;
  }

  if (hostStickBot && typeof hostStickBot.setRenderMode === 'function') {
    hostStickBot.setRenderMode(activeRole.renderMode);
  }

  if (typeof avatar.setRenderMode === 'function') {
    const ok = await avatar.setRenderMode(activeRole.renderMode);
    if (!ok) {
      overlayInfo('未检测到 Sprite 资源，已回退至 Vector 模式。');
      activeRole.renderMode = 'vector';
      if (renderSelect) {
        renderSelect.value = 'vector';
      }
      await avatar.setRenderMode('vector');
      if (hostStickBot && typeof hostStickBot.setRenderMode === 'function') {
        hostStickBot.setRenderMode('vector');
      }
      updateRoleDisplay(activeRole);
    }
  }

  if (persist) {
    saveActiveRoleId(activeRole.id);
  }

  overlayInfo(`已切换到角色「${activeRole.name || activeRole.id}」。`);
};

const loadRoles = async () => {
  if (roleSelect) {
    roleSelect.disabled = true;
  }
  /** @type {RoleProfile[]} */
  let roles = [];
  try {
    const response = await fetch(resolveServerUrl('/roles'));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (Array.isArray(payload?.roles)) {
      roles = payload.roles;
    } else if (Array.isArray(payload)) {
      roles = payload;
    }
  } catch (error) {
    console.warn('[stickbot] 加载角色档案失败', error);
  }

  if (!Array.isArray(roles) || roles.length === 0) {
    roles = [DEFAULT_ROLE];
  }

  availableRoles = roles.map((role, index) => sanitizeRole(role, `role-${index}`));
  if (availableRoles.length === 0) {
    availableRoles = [sanitizeRole(DEFAULT_ROLE, 'default')];
  }
  populateRoleSelect();

  const storedId = loadStoredRoleId();
  let initialRole = availableRoles[0];
  if (storedId) {
    const storedRole = availableRoles.find((item) => item.id === storedId);
    if (storedRole) {
      initialRole = storedRole;
    }
  }
  await applyRole(initialRole, { persist: false });
};

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

const updateWebcamStatus = (message) => {
  if (webcamStatus) {
    webcamStatus.textContent = message;
  }
};

const describeWebcamMode = (mode) => {
  switch (mode) {
    case 'facemesh':
      return '已启用摄像头：检测到 faceMesh，使用关键点估计口型。';
    case 'luma':
      return '已启用摄像头：未检测到 faceMesh，使用亮度差分占位估计。';
    default:
      return '默认关闭，启用后浏览器会请求摄像头权限。';
  }
};

updateWebcamStatus(describeWebcamMode('idle'));

mouthCapture.onMouth((value) => {
  if (!webcamToggle?.checked) {
    return;
  }
  if (audioDriving) {
    return;
  }
  const safe = Math.max(0, Math.min(1, value));
  const visemeId = safe > 0.75 ? 8 : safe > 0.45 ? 5 : safe > 0.2 ? 2 : 0;
  mouthSignal.setFrame({ value: safe, visemeId, phoneme: 'webcam' });
});

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

if (webcamToggle) {
  webcamToggle.checked = false;
  webcamToggle.addEventListener('change', async () => {
    if (webcamToggle.checked) {
      updateWebcamStatus('正在请求摄像头权限...');
      webcamToggle.disabled = true;
      const ok = await mouthCapture.enableWebcam();
      webcamToggle.disabled = false;
      if (!ok) {
        updateWebcamStatus('启用失败，请检查摄像头权限或设备占用情况。');
        webcamToggle.checked = false;
        return;
      }
      updateWebcamStatus(describeWebcamMode(mouthCapture.mode));
      overlayInfo('摄像头口型捕捉已开启，可在未播放音频时驱动火柴人。');
    } else {
      mouthCapture.disableWebcam();
      updateWebcamStatus(describeWebcamMode('idle'));
      overlayInfo('已关闭摄像头口型捕捉。');
    }
  });
}

if (roleSelect) {
  roleSelect.disabled = true;
  roleSelect.addEventListener('change', async () => {
    const selected = availableRoles.find((item) => item.id === roleSelect.value);
    if (selected) {
      await applyRole(selected);
    }
  });
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
 * 解析可用的数字。
 * @param {unknown} value - 原始值。
 * @returns {number|null} 数字或 null。
 */
const pickNumeric = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

/**
 * 将服务端或手动传入的逐词时间轴规范化。
 * @param {Array<{ text?: string, tStart?: number, tEnd?: number, start?: number, end?: number, t?: number }>} timeline - 原始数
据。
 * @returns {{ text: string, tStart: number, tEnd: number }[]} 规范化时间轴。
 */
const normalizeWordTimeline = (timeline) => {
  if (!Array.isArray(timeline)) {
    return [];
  }
  return timeline
    .map((item) => {
      const rawText = item?.text ?? '';
      const text = String(rawText).trim();
      if (!text) {
        return null;
      }
      const startCandidate = [item?.tStart, item?.start, item?.t].map(pickNumeric).find((value) => value !== null);
      const endCandidate = [item?.tEnd, item?.end, item?.t].map(pickNumeric).find((value) => value !== null);
      const start = Math.max(0, startCandidate ?? 0);
      let end = endCandidate ?? start;
      if (end < start) {
        end = start;
      }
      if (end === start) {
        end = start + 0.001;
      }
      return { text, tStart: start, tEnd: end };
    })
    .filter(Boolean)
    .sort((a, b) => a.tStart - b.tStart);
};

/**
 * 更新逐词字幕展示区域。
 */
const renderWordTimeline = () => {
  if (!wordTimelineBar) return;
  const useManual = useManualVttCheckbox?.checked;
  const timeline = useManual ? manualWordTimeline : serverWordTimeline;
  activeWordTimeline = timeline;
  wordChipElements = [];
  lastActiveWordIndex = -1;
  wordTimelineBar.innerHTML = '';

  if (!timeline || timeline.length === 0) {
    const placeholder = document.createElement('span');
    placeholder.className = 'word-timeline-status';
    placeholder.textContent = useManual
      ? '手动字幕为空，请粘贴有效的 WebVTT。'
      : '暂无逐词字幕，等待服务端响应或启用手动 VTT。';
    wordTimelineBar.appendChild(placeholder);
    return;
  }

  timeline.forEach((item, index) => {
    const chip = document.createElement('span');
    chip.className = 'word-chip';
    chip.textContent = item.text;
    chip.dataset.index = String(index);
    chip.dataset.start = String(item.tStart);
    chip.dataset.end = String(item.tEnd);
    wordTimelineBar.appendChild(chip);
    wordChipElements.push(chip);
  });
};

/**
 * 更新字幕状态提示。
 * @param {string} [message] - 可选提示信息。
 */
const refreshWordTimelineStatus = (message) => {
  if (!wordTimelineStatus) return;
  if (message) {
    wordTimelineStatus.textContent = message;
    if (wordStatusResetTimer !== null) {
      clearTimeout(wordStatusResetTimer);
    }
    wordStatusResetTimer = window.setTimeout(() => {
      wordStatusResetTimer = null;
      refreshWordTimelineStatus();
    }, 2000);
    return;
  }
  if (wordStatusResetTimer !== null) {
    clearTimeout(wordStatusResetTimer);
    wordStatusResetTimer = null;
  }
  if (useManualVttCheckbox?.checked) {
    wordTimelineStatus.textContent =
      manualWordTimeline.length > 0 ? '正在使用手动 VTT 字幕。' : '已启用手动 VTT，请粘贴字幕文本。';
  } else {
    wordTimelineStatus.textContent =
      serverWordTimeline.length > 0 ? '已加载服务端 wordTimeline。' : '服务端暂无 wordTimeline，可粘贴 WebVTT 覆盖。';
  }
};

/**
 * 保存服务端返回的逐词时间轴。
 * @param {Array<{ text?: string, tStart?: number, tEnd?: number }>} timeline - 服务端时间轴。
 */
const setServerWordTimeline = (timeline) => {
  serverWordTimeline = normalizeWordTimeline(timeline);
  if (!useManualVttCheckbox?.checked) {
    renderWordTimeline();
  }
  refreshWordTimelineStatus();
};

/**
 * 保存手动粘贴的逐词时间轴。
 * @param {Array<{ text?: string, tStart?: number, tEnd?: number }>} timeline - 手动时间轴。
 */
const setManualWordTimeline = (timeline) => {
  manualWordTimeline = normalizeWordTimeline(timeline);
  if (useManualVttCheckbox?.checked) {
    renderWordTimeline();
  }
  refreshWordTimelineStatus();
};

/**
 * 解析 WebVTT 时间戳。
 * @param {string} value - 时间戳字符串。
 * @returns {number} 秒数。
 */
const parseVttTimestamp = (value) => {
  if (!value) return NaN;
  const normalized = value.replace(',', '.').trim();
  const match = normalized.match(/^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!match) {
    return NaN;
  }
  const hours = Number(match[1] ?? '0');
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, '0'));
  if ([hours, minutes, seconds, millis].some((num) => !Number.isFinite(num))) {
    return NaN;
  }
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
};

/**
 * 将 WebVTT 文本解析为逐词时间轴。
 * @param {string} input - VTT 文本。
 * @returns {{ text: string, tStart: number, tEnd: number }[]} 解析结果。
 */
const parseWebVtt = (input) => {
  if (!input) return [];
  const trimmed = input.replace(/\ufeff/g, '').trim();
  if (!trimmed) return [];
  const withoutHeader = trimmed.replace(/^WEBVTT[^\n]*\n?/i, '');
  const blocks = withoutHeader.split(/\r?\n\r?\n+/).filter(Boolean);
  const result = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) {
      continue;
    }
    let cueIndex = 0;
    if (/^\d+$/.test(lines[0])) {
      cueIndex = 1;
    }
    const timingLine = lines[cueIndex];
    if (!timingLine || !timingLine.includes('-->')) {
      continue;
    }
    const [startRaw, endRaw] = timingLine.split(/-->/).map((part) => part.trim());
    const start = parseVttTimestamp(startRaw);
    const end = parseVttTimestamp(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    const text = lines.slice(cueIndex + 1).join(' ').trim();
    result.push({ text: text || '...', tStart: Math.max(0, start), tEnd: Math.max(start, end) });
  }
  return normalizeWordTimeline(result);
};

/**
 * 启动逐词字幕高亮。
 * @param {() => number} clock - 返回当前播放进度（秒）。
 */
const startWordHighlight = (clock) => {
  stopWordHighlight();
  if (!activeWordTimeline || activeWordTimeline.length === 0) {
    return;
  }
  const update = () => {
    const timeline = activeWordTimeline;
    if (!timeline || timeline.length === 0) {
      return;
    }
    const time = clock();
    if (!Number.isFinite(time)) {
      wordHighlightRaf = requestAnimationFrame(update);
      return;
    }
    let index = -1;
    for (let i = 0; i < timeline.length; i += 1) {
      const segment = timeline[i];
      if (time >= segment.tStart && time < segment.tEnd) {
        index = i;
        break;
      }
    }
    if (index === -1 && timeline.length > 0 && time >= timeline[timeline.length - 1].tEnd) {
      index = timeline.length - 1;
    }
    if (index !== lastActiveWordIndex) {
      if (lastActiveWordIndex >= 0 && wordChipElements[lastActiveWordIndex]) {
        wordChipElements[lastActiveWordIndex].classList.remove('active');
      }
      if (index >= 0 && wordChipElements[index]) {
        wordChipElements[index].classList.add('active');
      }
      lastActiveWordIndex = index;
    }
    wordHighlightRaf = requestAnimationFrame(update);
  };
  wordHighlightRaf = requestAnimationFrame(update);
};

/**
 * 停止字幕高亮并清理状态。
 */
const stopWordHighlight = () => {
  if (wordHighlightRaf !== null) {
    cancelAnimationFrame(wordHighlightRaf);
    wordHighlightRaf = null;
  }
  if (lastActiveWordIndex >= 0 && wordChipElements[lastActiveWordIndex]) {
    wordChipElements[lastActiveWordIndex].classList.remove('active');
  }
  lastActiveWordIndex = -1;
};

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
  stopWordHighlight();
  mouthSignal.stop();
  audioDriving = false;
  overlayInfo('已停止当前播放。');
}

// 滑条即时更新数值显示
rateSlider.addEventListener('input', () => {
  rateDisplay.textContent = rateSlider.value;
});
pitchSlider.addEventListener('input', () => {
  pitchDisplay.textContent = pitchSlider.value;
});

if (applyVttButton) {
  applyVttButton.addEventListener('click', () => {
    if (!wordVttInput) return;
    const parsed = parseWebVtt(wordVttInput.value);
    if (parsed.length === 0) {
      setManualWordTimeline([]);
      refreshWordTimelineStatus('未解析出有效的 WebVTT 字幕。');
      stopWordHighlight();
      renderWordTimeline();
      return;
    }
    setManualWordTimeline(parsed);
    if (useManualVttCheckbox) {
      useManualVttCheckbox.checked = true;
    }
    renderWordTimeline();
    refreshWordTimelineStatus('已加载手动 VTT 字幕。');
    if (currentAudio && !currentAudio.paused) {
      startWordHighlight(() => currentAudio.currentTime);
    }
  });
}

if (clearVttButton) {
  clearVttButton.addEventListener('click', () => {
    setManualWordTimeline([]);
    if (wordVttInput) {
      wordVttInput.value = '';
    }
    renderWordTimeline();
    refreshWordTimelineStatus('已清除手动字幕。');
    if (currentAudio && !currentAudio.paused) {
      stopWordHighlight();
      if (activeWordTimeline.length > 0) {
        startWordHighlight(() => currentAudio.currentTime);
      }
    }
  });
}

if (useManualVttCheckbox) {
  useManualVttCheckbox.addEventListener('change', () => {
    renderWordTimeline();
    refreshWordTimelineStatus();
    if (currentAudio && !currentAudio.paused) {
      if (activeWordTimeline.length > 0) {
        startWordHighlight(() => currentAudio.currentTime);
      } else {
        stopWordHighlight();
      }
    } else {
      stopWordHighlight();
    }
  });
}

// 渲染模式切换
renderSelect.addEventListener('change', async () => {
  const mode = renderSelect.value;
  const ok = await avatar.setRenderMode(mode);
  if (!ok) {
    overlayInfo('未检测到 Sprite 资源，已回退至 Vector 模式。');
    renderSelect.value = 'vector';
    if (hostStickBot && typeof hostStickBot.setRenderMode === 'function') {
      hostStickBot.setRenderMode('vector');
    }
    if (activeRole) {
      activeRole.renderMode = 'vector';
      updateRoleDisplay(activeRole);
    }
  } else {
    overlayInfo(`已切换至 ${mode} 渲染模式。`);
    if (hostStickBot && typeof hostStickBot.setRenderMode === 'function') {
      hostStickBot.setRenderMode(mode);
    }
    if (activeRole) {
      activeRole.renderMode = mode;
      updateRoleDisplay(activeRole);
    }
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
    audioDriving = true;
    mouthSignal.start();
    mouthSignal.playTimeline(timeline, () => (performance.now() - startTime) / 1000);
    const duration = timeline.length > 0 ? timeline[timeline.length - 1].t : 1;
    if (placeholderTimer) {
      clearTimeout(placeholderTimer);
    }
    placeholderTimer = window.setTimeout(() => {
      placeholderTimer = null;
      mouthSignal.stop();
      audioDriving = false;
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
        voice: activeRole?.voice,
        abortSignal: currentAbort.signal,
      });
    } catch (error) {
      console.warn('调用服务端 TTS 失败，将尝试 Web Speech 或回退。', error);
    }

    if (serverResult) {
      setServerWordTimeline(serverResult.wordTimeline || []);
    } else {
      setServerWordTimeline([]);
    }

    if (serverResult && Array.isArray(serverResult.mouthTimeline) && serverResult.mouthTimeline.length > 0 && serverResult.audioUrl) {
      overlayInfo('使用服务端时间轴驱动口型。');
      audioDriving = true;
      try {
        await playWithTimeline(serverResult);
      } finally {
        audioDriving = false;
      }
    } else if (serverResult && serverResult.audioUrl) {
      overlayInfo('服务端未提供时间轴，改用音量包络分析。');
      stopWordHighlight();
      audioDriving = true;
      try {
        await playWithAnalyserUrl(serverResult.audioUrl);
      } finally {
        audioDriving = false;
      }
    } else if (useWebSpeechCheckbox.checked && 'speechSynthesis' in window) {
      overlayInfo('使用 Web Speech API 作为兜底。');
      stopWordHighlight();
      const utterance = new SpeechSynthesisUtterance(text);
      const fallbackLang =
        activeRole?.voice && activeRole.voice.trim()
          ? activeRole.voice
          : /[a-zA-Z]/.test(text)
            ? 'en-US'
            : 'zh-CN';
      utterance.lang = fallbackLang;
      utterance.rate = speechRate;
      utterance.pitch = parseFloat(pitchSlider.value);
      audioDriving = true;
      try {
        await speakWithWebSpeech(utterance, mouthSignal);
      } finally {
        audioDriving = false;
      }
    } else {
      overlayInfo('无法使用服务端或 Web Speech，播放占位时间轴。');
      stopWordHighlight();
      const placeholder = generatePlaceholderTimeline(text);
      const startTime = performance.now();
      audioDriving = true;
      mouthSignal.start();
      mouthSignal.playTimeline(placeholder, () => (performance.now() - startTime) / 1000);
      const duration = placeholder.length > 0 ? placeholder[placeholder.length - 1].t : 1;
      if (placeholderTimer) {
        clearTimeout(placeholderTimer);
      }
      placeholderTimer = window.setTimeout(() => {
        placeholderTimer = null;
        mouthSignal.stop();
        audioDriving = false;
      }, (duration + 0.4) * 1000);
    }
  } catch (error) {
    console.error('播放失败：', error);
    overlayInfo(`播放失败：${error instanceof Error ? error.message : String(error)}`);
    mouthSignal.stop();
    audioDriving = false;
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
    if (webcamToggle?.checked) {
      mouthCapture.disableWebcam();
      webcamToggle.checked = false;
      updateWebcamStatus('页面隐藏，已自动关闭摄像头。');
    }
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
      stopWordHighlight();
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
      if (activeWordTimeline.length > 0) {
        startWordHighlight(() => audio.currentTime);
      } else {
        stopWordHighlight();
      }
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

loadRoles().catch((error) => {
  console.warn('[stickbot] 初始化角色档案失败', error);
  availableRoles = [sanitizeRole(DEFAULT_ROLE, 'default')];
  populateRoleSelect();
  applyRole(availableRoles[0], { persist: false }).catch((applyError) => {
    console.warn('[stickbot] 回退角色应用失败', applyError);
  });
});

renderWordTimeline();
refreshWordTimelineStatus();

