/**
 * @module main
 * @description 浏览器入口逻辑：协调 UI、TTS 请求与 BigMouthAvatar 渲染。
 */

import { BigMouthAvatar, DEFAULT_THEME } from './avatar.js';
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
const themeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('theme-select'));
const roleDescription = document.getElementById('role-description');
const roleMeta = document.getElementById('role-meta');
const defaultRoleDescription = roleDescription?.textContent || '';
const visemeDisplay = document.getElementById('viseme-display');
const autoGainToggle = /** @type {HTMLInputElement} */ (document.getElementById('auto-gain-toggle'));
const semanticToggle = /** @type {HTMLInputElement} */ (document.getElementById('semantic-toggle'));
const webcamToggle = /** @type {HTMLInputElement} */ (document.getElementById('webcam-mouth-toggle'));
const webcamStatus = document.getElementById('webcam-status');
const wordTimelineBar = /** @type {HTMLDivElement} */ (document.getElementById('word-timeline-bar'));
const wordTimelineStatus = document.getElementById('word-timeline-status');
const wordVttInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('word-vtt-input'));
const applyVttButton = /** @type {HTMLButtonElement} */ (document.getElementById('apply-vtt-btn'));
const clearVttButton = /** @type {HTMLButtonElement} */ (document.getElementById('clear-vtt-btn'));
const useManualVttCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('use-manual-vtt'));
const diagnosticsToggle = /** @type {HTMLInputElement} */ (document.getElementById('diagnostics-toggle'));
const diagnosticsOverlay = document.getElementById('diagnostics-overlay');
const diagnosticsFieldRefs = diagnosticsOverlay
  ? {
      syncSource: diagnosticsOverlay.querySelector('[data-diag="syncSource"]'),
      captureMode: diagnosticsOverlay.querySelector('[data-diag="captureMode"]'),
      mouthValue: diagnosticsOverlay.querySelector('[data-diag="mouthValue"]'),
      emaValue: diagnosticsOverlay.querySelector('[data-diag="emaValue"]'),
      visemeValue: diagnosticsOverlay.querySelector('[data-diag="visemeValue"]'),
      segmentIndex: diagnosticsOverlay.querySelector('[data-diag="segmentIndex"]'),
      preparedSegments: diagnosticsOverlay.querySelector('[data-diag="preparedSegments"]'),
      prefetchSegments: diagnosticsOverlay.querySelector('[data-diag="prefetchSegments"]'),
      bufferStatus: diagnosticsOverlay.querySelector('[data-diag="bufferStatus"]'),
      extraInfo: diagnosticsOverlay.querySelector('[data-diag="extraInfo"]'),
    }
  : null;

/**
 * @typedef {Object} StickBotPlugin
 * @property {string} name - 插件名称。
 * @property {(ctx: { timeline: any, avatar: BigMouthAvatar, bus: EventTarget, options?: any }) => void} setup - 初始化方法。
 * @property {() => void} [dispose] - 可选的清理方法。
 */

const THEME_STORAGE_KEY = 'stickbot:manual-theme';

const THEME_ALIASES = {
  noir: 'dark',
  pastel: 'minimal',
  default: 'classic',
};

const cloneTheme = (theme) => JSON.parse(JSON.stringify(theme || {}));

const FALLBACK_THEME_ENTRIES = [
  {
    id: 'classic',
    name: '经典紫调',
    data: {
      id: 'classic',
      name: '经典紫调',
      bg: '#f5f5f5',
      lineWidth: 6,
      stroke: '#1f2937',
      fill: '#f3f4ff',
      body: { stroke: '#1f2937', lineWidth: 6 },
      head: { stroke: '#312e81', fill: '#f3f4ff', lineWidth: 5 },
      eye: { stroke: '#312e81', lineWidth: 4, gap: 20, minHeight: 2 },
      mouth: {
        stroke: '#7c3aed',
        lineWidth: 6,
        fill: '#4c1d95',
        innerFill: '#4c1d95',
        toothFill: '#ede9fe',
        toothCount: 6,
        toothScale: 1,
        widthScale: 1,
        heightScale: 1,
        cornerCurveBase: 0.1,
        highlightStroke: '#a855f7',
        highlightWidth: 2,
        roundedViseme: 9,
      },
    },
  },
  {
    id: 'bright',
    name: '暖阳活力',
    data: {
      id: 'bright',
      name: '暖阳活力',
      bg: '#fff7ed',
      lineWidth: 6,
      stroke: '#7c2d12',
      fill: '#fffaf0',
      body: { stroke: '#7c2d12', lineWidth: 6 },
      head: { stroke: '#9a3412', fill: '#fffaf0', lineWidth: 5 },
      eye: { stroke: '#9a3412', lineWidth: 4, gap: 22, minHeight: 2 },
      mouth: {
        stroke: '#ea580c',
        lineWidth: 6,
        fill: '#c2410c',
        innerFill: '#c2410c',
        toothFill: '#fffbeb',
        toothCount: 5,
        toothScale: 1.1,
        widthScale: 1.05,
        heightScale: 1.1,
        cornerCurveBase: 0.08,
        highlightStroke: '#fb923c',
        highlightWidth: 2,
        roundedViseme: 8,
      },
    },
  },
  {
    id: 'dark',
    name: '午夜霓虹',
    data: {
      id: 'dark',
      name: '午夜霓虹',
      bg: '#0f172a',
      lineWidth: 6,
      stroke: '#e2e8f0',
      fill: '#1e293b',
      body: { stroke: '#e2e8f0', lineWidth: 6 },
      head: { stroke: '#38bdf8', fill: '#1e293b', lineWidth: 5 },
      eye: { stroke: '#38bdf8', lineWidth: 4, gap: 22, minHeight: 1.5 },
      mouth: {
        stroke: '#0ea5e9',
        lineWidth: 5.5,
        fill: '#082f49',
        innerFill: '#082f49',
        toothFill: '#bae6fd',
        toothCount: 4,
        toothScale: 0.9,
        widthScale: 0.95,
        heightScale: 1.05,
        cornerCurveBase: 0.04,
        highlightStroke: '#38bdf8',
        highlightWidth: 1.8,
        roundedViseme: 10,
      },
    },
  },
  {
    id: 'minimal',
    name: '极简线条',
    data: {
      id: 'minimal',
      name: '极简线条',
      bg: '#fdfdfc',
      lineWidth: 5,
      stroke: '#1a1a1a',
      fill: '#ffffff',
      body: { stroke: '#1a1a1a', lineWidth: 5 },
      head: { stroke: '#1a1a1a', fill: '#ffffff', lineWidth: 4.5 },
      eye: { stroke: '#111111', lineWidth: 3, gap: 18, minHeight: 1.5 },
      mouth: {
        stroke: '#1f2937',
        lineWidth: 4.5,
        fill: '#111111',
        innerFill: '#111111',
        toothFill: '#f4f4f5',
        toothCount: 4,
        toothScale: 0.8,
        widthScale: 0.9,
        heightScale: 0.85,
        cornerCurveBase: 0,
        highlightStroke: '#52525b',
        highlightWidth: 1.5,
        roundedViseme: 7,
      },
    },
  },
];

const DIAGNOSTICS_EMA_ALPHA = 0.28;

const DIAGNOSTICS_STAGE_MAP = {
  start: '等待首段',
  prepared: '已缓冲',
  'play-request': '等待播放',
  'segment-start': '播放中',
  prefetch: '预取中',
  done: '已完成',
  stopped: '已停止',
  error: '异常',
  reset: '准备中',
};

/**
 * 诊断叠层内部状态。
 * @type {{
 *   enabled: boolean,
 *   syncSource: string,
 *   mouthValue: number,
 *   emaValue: number,
 *   visemeId: number,
 *   phoneme: string,
 *   captureMode: string,
 *   extraInfo: string,
 *   timeline: { total: number, prepared: number, prefetched: number, current: number, status: string },
 * }}
 */
const diagnosticsState = {
  enabled: Boolean(diagnosticsToggle?.checked),
  syncSource: '空闲',
  mouthValue: 0,
  emaValue: 0,
  visemeId: 0,
  phoneme: 'idle',
  captureMode: '关闭',
  extraInfo: '等待音频或摄像头驱动。',
  timeline: {
    total: 0,
    prepared: 0,
    prefetched: 0,
    current: -1,
    status: '空闲',
  },
};

let diagnosticsEma = diagnosticsState.emaValue;

/**
 * 将数值格式化为两位小数文本。
 * @param {number} value - 原始数值。
 * @returns {string} 已格式化字符串。
 */
const formatDiagnosticsValue = (value) => {
  if (!Number.isFinite(value)) {
    return '0.00';
  }
  return value.toFixed(2);
};

/**
 * 刷新诊断叠层的 DOM 展示。
 */
const renderDiagnosticsOverlay = () => {
  if (!diagnosticsOverlay || !diagnosticsFieldRefs) {
    return;
  }
  diagnosticsOverlay.dataset.active = diagnosticsState.enabled ? 'true' : 'false';
  diagnosticsOverlay.setAttribute('aria-hidden', diagnosticsState.enabled ? 'false' : 'true');
  if (diagnosticsFieldRefs.syncSource) {
    diagnosticsFieldRefs.syncSource.textContent = diagnosticsState.syncSource;
  }
  if (diagnosticsFieldRefs.captureMode) {
    diagnosticsFieldRefs.captureMode.textContent = diagnosticsState.captureMode;
  }
  if (diagnosticsFieldRefs.mouthValue) {
    diagnosticsFieldRefs.mouthValue.textContent = formatDiagnosticsValue(diagnosticsState.mouthValue);
  }
  if (diagnosticsFieldRefs.emaValue) {
    diagnosticsFieldRefs.emaValue.textContent = formatDiagnosticsValue(diagnosticsState.emaValue);
  }
  if (diagnosticsFieldRefs.visemeValue) {
    diagnosticsFieldRefs.visemeValue.textContent = `#${Math.max(0, Math.round(diagnosticsState.visemeId))} · ${
      diagnosticsState.phoneme || 'idle'
    }`;
  }
  const totalSegments = Math.max(0, diagnosticsState.timeline.total);
  const currentDisplay = diagnosticsState.timeline.current >= 0
    ? Math.min(diagnosticsState.timeline.current + 1, totalSegments || 0)
    : 0;
  if (diagnosticsFieldRefs.segmentIndex) {
    diagnosticsFieldRefs.segmentIndex.textContent = `${currentDisplay} / ${totalSegments}`;
  }
  if (diagnosticsFieldRefs.preparedSegments) {
    diagnosticsFieldRefs.preparedSegments.textContent = String(Math.max(0, diagnosticsState.timeline.prepared));
  }
  if (diagnosticsFieldRefs.prefetchSegments) {
    diagnosticsFieldRefs.prefetchSegments.textContent = String(Math.max(0, diagnosticsState.timeline.prefetched));
  }
  if (diagnosticsFieldRefs.bufferStatus) {
    diagnosticsFieldRefs.bufferStatus.textContent = diagnosticsState.timeline.status;
  }
  if (diagnosticsFieldRefs.extraInfo) {
    diagnosticsFieldRefs.extraInfo.textContent = diagnosticsState.extraInfo;
  }
};

/**
 * 合并诊断状态并刷新显示。
 * @param {{ syncSource?: string, mouthValue?: number, emaValue?: number, visemeId?: number, phoneme?: string, captureMode?: string, extraInfo?: string, timeline?: Partial<{ total: number, prepared: number, prefetched: number, current: number, status: string }> }} patch - 更新片段。
 */
const updateDiagnosticsState = (patch = {}) => {
  if (!patch) {
    return;
  }
  const { timeline, ...rest } = patch;
  Object.assign(diagnosticsState, rest);
  if (timeline) {
    diagnosticsState.timeline = { ...diagnosticsState.timeline, ...timeline };
  }
  renderDiagnosticsOverlay();
};

/**
 * 处理时间轴播放器上报，更新缓冲与段索引展示。
 * @param {{ stage?: string, statusText?: string, totalSegments?: number, preparedSegments?: number, prefetchedSegments?: number, currentIndex?: number }} payload - 播放阶段数据。
 */
const handleTimelineDiagnostics = (payload = {}) => {
  if (!payload) {
    return;
  }
  const statusText = payload.statusText || (payload.stage ? DIAGNOSTICS_STAGE_MAP[payload.stage] : '');
  const totalSegments =
    typeof payload.totalSegments === 'number' ? Math.max(0, payload.totalSegments) : diagnosticsState.timeline.total;
  const preparedSegments =
    typeof payload.preparedSegments === 'number'
      ? Math.max(0, payload.preparedSegments)
      : diagnosticsState.timeline.prepared;
  const prefetchedSegments =
    typeof payload.prefetchedSegments === 'number'
      ? Math.max(0, payload.prefetchedSegments)
      : diagnosticsState.timeline.prefetched;
  const currentIndex =
    typeof payload.currentIndex === 'number' ? payload.currentIndex : diagnosticsState.timeline.current;
  const displayIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, totalSegments || 0) : 0;
  const infoText = statusText
    ? totalSegments > 0
      ? `${statusText} · 段 ${displayIndex}/${totalSegments}`
      : statusText
    : undefined;
  updateDiagnosticsState({
    timeline: {
      total: totalSegments,
      prepared: preparedSegments,
      prefetched: prefetchedSegments,
      current: currentIndex,
      status: statusText || diagnosticsState.timeline.status,
    },
    ...(infoText ? { extraInfo: infoText } : {}),
  });
};

if (diagnosticsToggle && diagnosticsOverlay) {
  diagnosticsToggle.addEventListener('change', () => {
    diagnosticsState.enabled = diagnosticsToggle.checked;
    renderDiagnosticsOverlay();
  });
} else {
  diagnosticsState.enabled = false;
}

renderDiagnosticsOverlay();

/** @type {Map<string, { id: string, name: string, data: import('./avatar.js').AvatarTheme }>} */
const themeRegistry = new Map();
/** @type {{ id: string, name: string, data: import('./avatar.js').AvatarTheme }[]} */
let themeList = [];
/** @type {Map<string, string>} */
const themeDisplayMap = new Map();
let defaultThemeId = 'classic';
let manualThemeId = '';
let activeThemeId = 'classic';

const normalizeThemeId = (value, options = {}) => {
  const allowEmpty = Boolean(options.allowEmpty);
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) {
    return allowEmpty ? '' : 'classic';
  }
  return THEME_ALIASES[raw] || raw;
};

const getThemeDisplayName = (themeId) => themeDisplayMap.get(themeId) || themeId;

const persistManualThemeId = (themeId) => {
  try {
    if (themeId) {
      window.localStorage?.setItem(THEME_STORAGE_KEY, themeId);
    } else {
      window.localStorage?.removeItem(THEME_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('[stickbot] 保存主题偏好失败', error);
  }
};

const loadStoredManualThemeId = () => {
  try {
    const stored = window.localStorage?.getItem(THEME_STORAGE_KEY) || '';
    return normalizeThemeId(stored, { allowEmpty: true });
  } catch (error) {
    console.warn('[stickbot] 读取主题偏好失败', error);
    return '';
  }
};

const updateThemeOptions = () => {
  if (!themeSelect) return;
  themeSelect.innerHTML = '';
  const followOption = document.createElement('option');
  followOption.value = '';
  followOption.textContent = '跟随角色';
  themeSelect.appendChild(followOption);
  for (const entry of themeList) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name || entry.id;
    themeSelect.appendChild(option);
  }
  themeSelect.disabled = themeList.length === 0;
  themeSelect.value = manualThemeId ? manualThemeId : '';
};

const applyThemeClass = (themeId) => {
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
};

const applyThemeFromState = ({ skipManualUpdate = false } = {}) => {
  const roleThemeId = activeRole?.theme ? normalizeThemeId(activeRole.theme) : '';
  const desiredId = manualThemeId || roleThemeId || defaultThemeId;
  const entry = themeRegistry.get(desiredId) || themeRegistry.get(defaultThemeId) || themeList[0] || null;
  if (!entry) {
    return;
  }
  activeThemeId = entry.id;
  applyThemeClass(entry.id);
  if (typeof avatar.setTheme === 'function') {
    avatar.setTheme(entry.data);
  }
  if (hostStickBot && typeof hostStickBot.setTheme === 'function') {
    hostStickBot.setTheme(entry.id);
  }
  if (!skipManualUpdate && themeSelect) {
    themeSelect.value = manualThemeId ? entry.id : '';
  }
  updateRoleDisplay(activeRole);
};

const initializeThemes = (entries, defaultId) => {
  themeRegistry.clear();
  themeList = [];
  themeDisplayMap.clear();
  const seen = new Set();
  for (const entry of entries) {
    const normalizedId = normalizeThemeId(entry.id);
    if (seen.has(normalizedId)) {
      continue;
    }
    seen.add(normalizedId);
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : normalizedId;
    const data = cloneTheme(entry.data || {});
    if (!data.id) {
      data.id = normalizedId;
    }
    if (!data.name) {
      data.name = name;
    }
    const prepared = { id: normalizedId, name, data };
    themeList.push(prepared);
    themeRegistry.set(normalizedId, prepared);
    themeDisplayMap.set(normalizedId, name);
  }
  const normalizedDefault = normalizeThemeId(defaultId);
  if (themeRegistry.has(normalizedDefault)) {
    defaultThemeId = normalizedDefault;
  }
  if (manualThemeId && !themeRegistry.has(manualThemeId)) {
    manualThemeId = '';
    persistManualThemeId('');
  }
  updateThemeOptions();
  applyThemeFromState({ skipManualUpdate: true });
};

const loadThemeManifest = async () => {
  const candidates = [];
  try {
    candidates.push(new URL('../themes/manifest.json', window.location.href).toString());
  } catch (error) {
    // ignore
  }
  const serverCandidate = resolveServerUrl('/themes/manifest.json');
  if (serverCandidate && !candidates.includes(serverCandidate)) {
    candidates.push(serverCandidate);
  }
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }
      const manifest = await response.json();
      if (!manifest || !Array.isArray(manifest.themes)) {
        continue;
      }
      const loaded = [];
      for (const item of manifest.themes) {
        const rawId = normalizeThemeId(item.id, { allowEmpty: false });
        if (!rawId) {
          continue;
        }
        const path = typeof item.path === 'string' ? item.path : '';
        if (!path) {
          continue;
        }
        try {
          const themeUrl = new URL(path, url);
          const themeResponse = await fetch(themeUrl.toString());
          if (!themeResponse.ok) {
            continue;
          }
          const themeData = await themeResponse.json();
          loaded.push({
            id: rawId,
            name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : rawId,
            data: themeData,
          });
        } catch (error) {
          console.warn('[stickbot] 加载主题失败', error);
        }
      }
      if (loaded.length > 0) {
        const seen = new Set(loaded.map((entry) => entry.id));
        for (const fallback of FALLBACK_THEME_ENTRIES) {
          const normalizedId = normalizeThemeId(fallback.id);
          if (!seen.has(normalizedId)) {
            loaded.push({ id: normalizedId, name: fallback.name, data: fallback.data });
            seen.add(normalizedId);
          }
        }
        const manifestDefault = typeof manifest.default === 'string' ? manifest.default : defaultThemeId;
        initializeThemes(loaded, manifestDefault);
        return;
      }
    } catch (error) {
      console.warn('[stickbot] 请求主题清单失败', error);
    }
  }
};

// 初始化渲染器
manualThemeId = loadStoredManualThemeId();
const avatar = new BigMouthAvatar(canvas, { theme: DEFAULT_THEME });
initializeThemes(FALLBACK_THEME_ENTRIES, 'classic');
avatar.start();
loadThemeManifest().catch((error) => {
  console.warn('[stickbot] 主题清单加载失败', error);
});
overlayInfo('stickbot 已就绪，优先使用服务端时间轴驱动。');

// 口型信号
const mouthSignal = new MouthSignal();
const mouthCapture = new MouthCapture();
const pluginBus = new EventTarget();

/** @type {Map<string, StickBotPlugin>} */
const activePlugins = new Map();

const pluginContext = {
  timeline: /** @type {any} */ ({}),
  avatar,
  bus: pluginBus,
  options: {},
};

/** @type {Record<string, () => StickBotPlugin>} */
const pluginFactories = {
  'auto-gain': createAutoGainPlugin,
  'semantic-triggers': createSemanticPlugin,
  'mouth-capture': createMouthCapturePlugin,
};

const syncPluginToggle = (name, enabled) => {
  switch (name) {
    case 'auto-gain':
      if (autoGainToggle) {
        autoGainToggle.checked = enabled;
      }
      break;
    case 'semantic-triggers':
      if (semanticToggle) {
        semanticToggle.checked = enabled;
      }
      break;
    case 'mouth-capture':
      if (webcamToggle) {
        webcamToggle.checked = enabled;
      }
      break;
    default:
      break;
  }
};

const enablePlugin = (name) => {
  if (activePlugins.has(name)) {
    return activePlugins.get(name) || null;
  }
  const factory = pluginFactories[name];
  if (typeof factory !== 'function') {
    return null;
  }
  const plugin = factory();
  if (!plugin || typeof plugin.setup !== 'function') {
    return null;
  }
  activePlugins.set(name, plugin);
  try {
    plugin.setup(pluginContext);
    syncPluginToggle(name, true);
    return plugin;
  } catch (error) {
    console.warn('[stickbot] 启用插件失败', name, error);
    activePlugins.delete(name);
    syncPluginToggle(name, false);
    return null;
  }
};

const disablePlugin = (name) => {
  const plugin = activePlugins.get(name);
  if (!plugin) {
    syncPluginToggle(name, false);
    return;
  }
  try {
    plugin.dispose?.();
  } catch (error) {
    console.warn('[stickbot] 卸载插件失败', name, error);
  }
  activePlugins.delete(name);
  syncPluginToggle(name, false);
};

const togglePlugin = (name, enabled) => {
  if (enabled) {
    enablePlugin(name);
  } else {
    disablePlugin(name);
  }
};

const isPluginActive = (name) => activePlugins.has(name);
mouthSignal.subscribe((frame) => {
  avatar.setMouthFrame(frame);
  mouthProgress.value = frame.value;
  if (visemeDisplay) {
    visemeDisplay.textContent = `viseme ${Math.round(frame.visemeId)} · ${frame.phoneme}`;
  }
  diagnosticsEma += (frame.value - diagnosticsEma) * DIAGNOSTICS_EMA_ALPHA;
  diagnosticsEma = Math.max(0, Math.min(1, diagnosticsEma));
  updateDiagnosticsState({
    mouthValue: frame.value,
    emaValue: diagnosticsEma,
    visemeId: frame.visemeId,
    phoneme: frame.phoneme,
  });
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
/** @type {boolean} */
let mouthCaptureActive = false;
/** @type {TimelinePlayer|null} */
let activeTimelinePlayer = null;

pluginBus.addEventListener('stickbot:mouth-capture:status', (event) => {
  const detail = event?.detail || {};
  const active = Boolean(detail.active);
  mouthCaptureActive = active;
  const mode = typeof detail.mode === 'string' ? detail.mode : 'idle';
  const captureLabel = active ? (mode === 'facemesh' ? 'faceMesh' : mode === 'luma' ? '亮度估计' : '随机波动') : '关闭';
  updateDiagnosticsState({ captureMode: captureLabel });
  if (active && !audioDriving) {
    updateDiagnosticsState({
      syncSource: '摄像头捕捉',
      timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: '摄像头驱动' },
      extraInfo: '摄像头帧直接驱动 mouth 值。',
    });
  }
  if (!active && !audioDriving) {
    updateDiagnosticsState({
      syncSource: '空闲',
      timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: '空闲' },
      extraInfo: '等待音频或摄像头驱动。',
    });
  }
});

const TIMELINE_PREFS = (() => {
  const defaults = {
    prefetchThreshold: 0.7,
    segmentMinChars: 80,
    segmentMaxChars: 220,
    segmentMode: 'auto',
    latencyCompensation: {
      enabled: true,
      thresholdMs: 160,
      maxLeadMs: 320,
    },
  };
  if (typeof window === 'undefined') {
    return defaults;
  }
  const overrides =
    typeof window.STICKBOT_TIMELINE_PREFS === 'object' && window.STICKBOT_TIMELINE_PREFS
      ? window.STICKBOT_TIMELINE_PREFS
      : {};
  const threshold =
    typeof overrides.prefetchThreshold === 'number'
      ? Math.min(0.95, Math.max(0.1, overrides.prefetchThreshold))
      : defaults.prefetchThreshold;
  const minChars =
    Number.isFinite(overrides.segmentMinChars) && overrides.segmentMinChars > 0
      ? overrides.segmentMinChars
      : defaults.segmentMinChars;
  const maxChars =
    Number.isFinite(overrides.segmentMaxChars) && overrides.segmentMaxChars > minChars
      ? overrides.segmentMaxChars
      : defaults.segmentMaxChars;
  const latencyOverrides = typeof overrides.latencyCompensation === 'object' && overrides.latencyCompensation
    ? overrides.latencyCompensation
    : {};
  const latencyCompensation = {
    enabled:
      typeof latencyOverrides.enabled === 'boolean'
        ? latencyOverrides.enabled
        : defaults.latencyCompensation.enabled,
    thresholdMs:
      Number.isFinite(latencyOverrides.thresholdMs) && latencyOverrides.thresholdMs >= 0
        ? latencyOverrides.thresholdMs
        : defaults.latencyCompensation.thresholdMs,
    maxLeadMs:
      Number.isFinite(latencyOverrides.maxLeadMs) && latencyOverrides.maxLeadMs >= 0
        ? latencyOverrides.maxLeadMs
        : defaults.latencyCompensation.maxLeadMs,
  };
  const segmentMode =
    typeof overrides.segmentMode === 'string' && overrides.segmentMode
      ? overrides.segmentMode
      : defaults.segmentMode;
  return {
    prefetchThreshold: threshold,
    segmentMinChars: minChars,
    segmentMaxChars: maxChars,
    segmentMode: segmentMode.toLowerCase(),
    latencyCompensation,
  };
})();

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
  const theme = normalizeThemeId(role?.theme);
  return {
    id,
    name: typeof role?.name === 'string' && role.name.trim() ? role.name.trim() : id,
    description: typeof role?.description === 'string' ? role.description : '',
    voice: typeof role?.voice === 'string' && role.voice ? role.voice : '',
    preset,
    theme,
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
    parts.push(`主题: ${getThemeDisplayName(normalizeThemeId(role.theme))}`);
  }
  return parts.join(' · ');
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
    const displayRole = role ? { ...role, theme: activeThemeId } : role;
    roleMeta.textContent = buildRoleMeta(displayRole || null);
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
  applyThemeFromState();

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

const persistAutoGainPreference = (state) => {
  try {
    window.localStorage?.setItem(
      AUTO_GAIN_STORAGE_KEY,
      JSON.stringify({ enabled: state.enabled, config: state.config }),
    );
  } catch (error) {
    console.warn('[stickbot] 保存自动增益设置失败', error);
  }
};

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
  if (!mouthCaptureActive) {
    return;
  }
  if (audioDriving) {
    return;
  }
  const safe = Math.max(0, Math.min(1, value));
  const visemeId = safe > 0.75 ? 8 : safe > 0.45 ? 5 : safe > 0.2 ? 2 : 0;
  mouthSignal.setFrame({ value: safe, visemeId, phoneme: 'webcam' });
});

const applyAutoGainPreference = (enabled, config = autoGainPreference.config) => {
  const mergedConfig = { ...DEFAULT_AUTO_GAIN_CONFIG, ...(config || {}) };
  autoGainPreference = { enabled, config: mergedConfig };
  persistAutoGainPreference(autoGainPreference);
};

if (autoGainToggle) {
  autoGainToggle.checked = autoGainPreference.enabled;
  autoGainToggle.addEventListener('change', () => {
    togglePlugin('auto-gain', autoGainToggle.checked);
  });
}

if (semanticToggle) {
  semanticToggle.checked = false;
  semanticToggle.addEventListener('change', () => {
    togglePlugin('semantic-triggers', semanticToggle.checked);
  });
}

if (webcamToggle) {
  webcamToggle.checked = false;
  webcamToggle.addEventListener('change', () => {
    togglePlugin('mouth-capture', webcamToggle.checked);
  });
}

togglePlugin('auto-gain', autoGainPreference.enabled);

const prepareTimelineWithPlugins = (text) => {
  const detail = {
    text,
    sentiment: null,
    wordTimeline: Array.isArray(activeWordTimeline) ? [...activeWordTimeline] : [],
    timelineOptions: {
      autoGain: autoGainPreference.enabled ? { ...autoGainPreference.config } : false,
      expressionPreset: null,
      emoteTimeline: [],
      gestureTimeline: [],
      expressionTimeline: [],
    },
  };
  pluginBus.dispatchEvent(new CustomEvent('stickbot:timeline:prepare', { detail }));
  const timelineOptions = detail.timelineOptions || {};
  const autoGainOption = timelineOptions.autoGain;
  if (autoGainOption && typeof autoGainOption === 'object') {
    mouthSignal.setAutoGain(true, { ...autoGainPreference.config, ...autoGainOption });
  } else if (autoGainOption === true) {
    mouthSignal.setAutoGain(true, autoGainPreference.config);
  } else {
    mouthSignal.setAutoGain(false, autoGainPreference.config);
  }
  if (timelineOptions.expressionPreset) {
    const merged = {
      ...(activeRole?.preset || {}),
      ...timelineOptions.expressionPreset,
    };
    applyExpressionPreset(merged);
  } else if (activeRole) {
    applyExpressionPreset(activeRole.preset);
  }
};

function createAutoGainPlugin() {
  let onPrepare = null;
  return {
    name: 'auto-gain',
    setup() {
      applyAutoGainPreference(true);
      mouthSignal.setAutoGain(true, autoGainPreference.config);
      onPrepare = (event) => {
        if (!(event instanceof CustomEvent)) {
          return;
        }
        const detail = event.detail;
        if (!detail || !detail.timelineOptions) {
          return;
        }
        detail.timelineOptions.autoGain = { ...autoGainPreference.config };
      };
      pluginBus.addEventListener('stickbot:timeline:prepare', onPrepare);
    },
    dispose() {
      if (onPrepare) {
        pluginBus.removeEventListener('stickbot:timeline:prepare', onPrepare);
      }
      onPrepare = null;
      mouthSignal.setAutoGain(false, autoGainPreference.config);
      applyAutoGainPreference(false);
    },
  };
}

function createSemanticPlugin() {
  let onPrepare = null;
  return {
    name: 'semantic-triggers',
    setup() {
      onPrepare = (event) => {
        if (!(event instanceof CustomEvent)) {
          return;
        }
        const detail = event.detail;
        if (!detail || !detail.timelineOptions) {
          return;
        }
        const text = detail.text || '';
        if (!text.trim()) {
          return;
        }
        const exclaimCount = (text.match(/[!！]/gu) || []).length;
        const questionCount = (text.match(/[?？]/gu) || []).length;
        if (exclaimCount === 0 && questionCount === 0) {
          return;
        }
        const preset = { ...(detail.timelineOptions.expressionPreset || {}) };
        if (exclaimCount > 0) {
          preset.mouthOpenScale = Math.min(1.6, 1 + exclaimCount * 0.08);
          preset.headNodAmp = Math.min(0.9, (preset.headNodAmp || 0) + exclaimCount * 0.12);
          preset.cornerCurve = Math.min(0.8, (preset.cornerCurve || 0) + exclaimCount * 0.1);
        }
        if (questionCount > 0) {
          preset.eyeBlinkBias = Math.max(-0.6, (preset.eyeBlinkBias || 0) - questionCount * 0.18);
        }
        detail.timelineOptions.expressionPreset = preset;
      };
      pluginBus.addEventListener('stickbot:timeline:prepare', onPrepare);
    },
    dispose() {
      if (onPrepare) {
        pluginBus.removeEventListener('stickbot:timeline:prepare', onPrepare);
      }
      onPrepare = null;
    },
  };
}

function createMouthCapturePlugin() {
  let disposed = false;
  let started = false;
  return {
    name: 'mouth-capture',
    setup() {
      disposed = false;
      started = false;
      mouthCaptureActive = false;
      updateWebcamStatus('正在请求摄像头权限...');
      if (webcamToggle) {
        webcamToggle.disabled = true;
      }
      Promise.resolve()
        .then(() => mouthCapture.enableWebcam())
        .then((ok) => {
          if (disposed) {
            return;
          }
          if (!ok) {
            updateWebcamStatus('启用失败，请检查摄像头权限或设备占用情况。');
            if (webcamToggle) {
              webcamToggle.disabled = false;
            }
            setTimeout(() => disablePlugin('mouth-capture'), 0);
            return;
          }
          mouthCaptureActive = true;
          started = true;
          updateWebcamStatus(describeWebcamMode(mouthCapture.mode));
          if (webcamToggle) {
            webcamToggle.disabled = false;
          }
          overlayInfo('摄像头口型捕捉已开启，可在未播放音频时驱动火柴人。');
          pluginBus.dispatchEvent(new CustomEvent('stickbot:mouth-capture:status', {
            detail: { active: true, mode: mouthCapture.mode },
          }));
        })
        .catch((error) => {
          if (disposed) {
            return;
          }
          console.warn('[stickbot] 摄像头捕捉启用失败', error);
          updateWebcamStatus('启用失败，请检查摄像头权限或设备占用情况。');
          if (webcamToggle) {
            webcamToggle.disabled = false;
          }
          setTimeout(() => disablePlugin('mouth-capture'), 0);
        });
    },
    dispose() {
      disposed = true;
      mouthCaptureActive = false;
      mouthCapture.disableWebcam();
      if (webcamToggle) {
        webcamToggle.disabled = false;
      }
      if (started) {
        updateWebcamStatus(describeWebcamMode('idle'));
      }
      pluginBus.dispatchEvent(new CustomEvent('stickbot:mouth-capture:status', {
        detail: { active: false, mode: 'idle' },
      }));
      if (started && !audioDriving) {
        overlayInfo('已关闭摄像头口型捕捉。');
      }
    },
  };
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

if (themeSelect) {
  themeSelect.addEventListener('change', () => {
    const value = themeSelect.value || '';
    const normalized = normalizeThemeId(value, { allowEmpty: true });
    if (!normalized) {
      manualThemeId = '';
      persistManualThemeId('');
    } else {
      manualThemeId = normalized;
      persistManualThemeId(manualThemeId);
    }
    applyThemeFromState({ skipManualUpdate: true });
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

const appendWordTimelineEntries = (collector, timeline, offset) => {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return;
  }
  for (const item of timeline) {
    const rawText = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!rawText) {
      continue;
    }
    const startCandidates = [item?.tStart, item?.start, item?.t];
    const endCandidates = [item?.tEnd, item?.end, item?.t];
    const baseStart = startCandidates
      .map((value) => (Number.isFinite(value) ? Number(value) : NaN))
      .find((value) => Number.isFinite(value));
    const baseEnd = endCandidates
      .map((value) => (Number.isFinite(value) ? Number(value) : NaN))
      .find((value) => Number.isFinite(value));
    const resolvedStart = Number.isFinite(baseStart) ? baseStart : 0;
    let resolvedEnd = Number.isFinite(baseEnd) ? baseEnd : resolvedStart;
    if (resolvedEnd < resolvedStart) {
      resolvedEnd = resolvedStart;
    }
    const offsetStart = resolvedStart + offset;
    const offsetEnd = resolvedEnd + offset;
    collector.push({
      text: rawText,
      tStart: offsetStart,
      tEnd: offsetEnd > offsetStart ? offsetEnd : offsetStart + 0.001,
    });
  }
};

const splitTextIntoSegments = (text) => {
  const sanitized = text.replace(/\r\n/g, '\n').trim();
  if (!sanitized) {
    return [];
  }
  if (TIMELINE_PREFS.segmentMode === 'off') {
    return [sanitized];
  }
  const minLen = Math.max(10, TIMELINE_PREFS.segmentMinChars);
  const maxLen = Math.max(minLen + 10, TIMELINE_PREFS.segmentMaxChars);
  if (sanitized.length <= maxLen) {
    return [sanitized];
  }
  const segments = [];
  const pushSegment = (value) => {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed) {
      segments.push(trimmed);
    }
  };
  const rawBlocks = sanitized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const blocks = rawBlocks.length > 0 ? rawBlocks : [sanitized];
  const punctuationRe = /[。！？?!；;，,]/;
  for (const block of blocks) {
    if (block.length <= maxLen) {
      pushSegment(block);
      continue;
    }
    let buffer = '';
    for (let i = 0; i < block.length; i += 1) {
      const char = block[i];
      buffer += char;
      const isBoundary = punctuationRe.test(char) || char === '\n';
      if (buffer.length >= minLen && isBoundary) {
        pushSegment(buffer);
        buffer = '';
        continue;
      }
      if (buffer.length >= maxLen) {
        pushSegment(buffer);
        buffer = '';
      }
    }
    if (buffer.trim()) {
      pushSegment(buffer);
    }
  }
  if (segments.length <= 1) {
    return [sanitized];
  }
  for (let i = 1; i < segments.length; i += 1) {
    const current = segments[i];
    const previous = segments[i - 1];
    if (current.length < minLen * 0.5 && previous.length + current.length <= maxLen) {
      segments[i - 1] = `${previous} ${current}`.replace(/\s+/g, ' ').trim();
      segments.splice(i, 1);
      i -= 1;
    }
  }
  return segments;
};

const getActivePlaybackClock = () => {
  if (activeTimelinePlayer) {
    return activeTimelinePlayer.getCurrentTime();
  }
  if (currentAudio) {
    const time = currentAudio.currentTime;
    return Number.isFinite(time) ? time : 0;
  }
  return 0;
};

class TimelinePlayer {
  /**
   * @param {{
   *   mouthSignal: MouthSignal,
   *   prefetchThreshold?: number,
   *   latencyCompensation?: { enabled?: boolean, thresholdMs?: number, maxLeadMs?: number },
   *   onSegmentPrepared?: (index: number, result: any, offset: number, duration: number) => void,
   *   onSegmentStart?: (audio: HTMLAudioElement, index: number, clock: () => number) => void,
   *   onSegmentEnd?: (index: number) => void,
   *   onPlaybackComplete?: (context: { stopped: boolean }) => void,
   *   onPlaybackError?: (error: Error) => void,
   *   diagnosticsReporter?: (state: {
   *     stage?: string,
   *     statusText?: string,
   *     totalSegments?: number,
   *     preparedSegments?: number,
   *     prefetchedSegments?: number,
   *     currentIndex?: number,
   *   }) => void,
   * }} options - 配置。
   */
  constructor(options) {
    this.mouthSignal = options.mouthSignal;
    this.prefetchThreshold = typeof options.prefetchThreshold === 'number' ? options.prefetchThreshold : 0.7;
    const baseLatency = { enabled: true, thresholdMs: 160, maxLeadMs: 320 };
    const latencyOverrides = options.latencyCompensation || {};
    this.latencyComp = {
      enabled:
        typeof latencyOverrides.enabled === 'boolean' ? latencyOverrides.enabled : baseLatency.enabled,
      thresholdMs:
        Number.isFinite(latencyOverrides.thresholdMs) && latencyOverrides.thresholdMs >= 0
          ? latencyOverrides.thresholdMs
          : baseLatency.thresholdMs,
      maxLeadMs:
        Number.isFinite(latencyOverrides.maxLeadMs) && latencyOverrides.maxLeadMs >= 0
          ? latencyOverrides.maxLeadMs
          : baseLatency.maxLeadMs,
    };
    this.onSegmentPrepared = options.onSegmentPrepared;
    this.onSegmentStart = options.onSegmentStart;
    this.onSegmentEnd = options.onSegmentEnd;
    this.onPlaybackComplete = options.onPlaybackComplete;
    this.onPlaybackError = options.onPlaybackError;
    this.segmentPromises = new Map();
    this.segmentFetchers = new Map();
    this.segmentDurations = [];
    this.segmentOffsets = [];
    this.loadedSegments = new Set();
    this.prefetchIndices = new Set();
    this.currentAudio = null;
    this.currentIndex = -1;
    this.monitorId = null;
    this.latencyTimers = { threshold: null, maxLead: null };
    this.latencyCleanup = null;
    this.clockState = null;
    this.mouthSignalActive = false;
    this.totalSegments = 0;
    this.stopped = false;
    this.finished = false;
    this.resolvePlayback = null;
    this.rejectPlayback = null;
    this.diagnosticsReporter = typeof options.diagnosticsReporter === 'function' ? options.diagnosticsReporter : null;
  }

  reportDiagnostics(extra = {}) {
    if (!this.diagnosticsReporter) {
      return;
    }
    const payload = {
      totalSegments: this.totalSegments,
      preparedSegments: this.loadedSegments.size,
      prefetchedSegments: this.prefetchIndices.size,
      currentIndex: typeof extra.currentIndex === 'number' ? extra.currentIndex : this.currentIndex,
      stage: extra.stage,
      statusText: extra.statusText,
    };
    this.diagnosticsReporter(payload);
  }

  resetState() {
    this.segmentPromises.clear();
    this.segmentFetchers.clear();
    this.segmentDurations = [];
    this.segmentOffsets = [];
    this.loadedSegments.clear();
    this.prefetchIndices.clear();
    if (this.monitorId !== null) {
      cancelAnimationFrame(this.monitorId);
      this.monitorId = null;
    }
    this.clearLatencyTimers();
    if (this.latencyCleanup) {
      this.latencyCleanup();
      this.latencyCleanup = null;
    }
    this.clockState = null;
    this.currentAudio = null;
    this.currentIndex = -1;
    this.mouthSignalActive = false;
    this.stopped = false;
    this.finished = false;
    this.reportDiagnostics({ stage: 'reset', statusText: '准备中', currentIndex: -1 });
  }

  /**
   * 开始播放。
   * @param {any} initialResult - 首段结果。
   * @param {Array<() => Promise<any>>} [fetchers] - 后续分段获取函数。
   * @returns {Promise<void>} 播放结束。
   */
  async play(initialResult, fetchers = []) {
    this.resetState();
    this.totalSegments = 1 + fetchers.length;
    this.reportDiagnostics({ stage: 'start', statusText: '等待首段', currentIndex: -1 });
    this.segmentPromises.set(0, Promise.resolve(initialResult));
    fetchers.forEach((fn, idx) => {
      this.segmentFetchers.set(idx + 1, fn);
    });
    this.handleSegmentPrepared(0, initialResult);
    return new Promise((resolve, reject) => {
      this.resolvePlayback = resolve;
      this.rejectPlayback = reject;
      this.playSegment(0);
    });
  }

  stop() {
    if (this.finished) {
      return;
    }
    this.stopped = true;
    this.finish('stopped');
  }

  async playSegment(index) {
    if (this.finished) {
      return;
    }
    const promise = this.obtainSegmentPromise(index);
    if (!promise) {
      this.finish('done');
      return;
    }
    this.reportDiagnostics({ stage: 'play-request', statusText: '等待播放', currentIndex: index });
    let result;
    try {
      result = await promise;
    } catch (error) {
      this.finish('error', error);
      return;
    }
    const { offset, duration } = this.handleSegmentPrepared(index, result);
    try {
      await this.runSegmentPlayback(result, index, offset, duration);
    } catch (error) {
      this.finish('error', error);
      return;
    }
    if (this.finished) {
      return;
    }
    if (index + 1 >= this.totalSegments) {
      this.finish('done');
    } else {
      this.playSegment(index + 1);
    }
  }

  obtainSegmentPromise(index) {
    if (this.segmentPromises.has(index)) {
      return this.segmentPromises.get(index);
    }
    const fetcher = this.segmentFetchers.get(index);
    if (!fetcher) {
      return null;
    }
    const promise = fetcher();
    this.segmentPromises.set(index, promise);
    promise
      .then((result) => {
        if (!this.finished) {
          this.handleSegmentPrepared(index, result);
        }
        return result;
      })
      .catch((error) => {
        if (!this.finished) {
          this.finish('error', error);
        }
        throw error;
      });
    return promise;
  }

  handleSegmentPrepared(index, result) {
    if (this.loadedSegments.has(index)) {
      const offset = this.segmentOffsets[index] ?? this.computeOffset(index);
      const duration = this.segmentDurations[index] ?? this.deriveDuration(result);
      return { offset, duration };
    }
    const offset = this.computeOffset(index);
    const duration = this.deriveDuration(result);
    this.segmentOffsets[index] = offset;
    this.segmentDurations[index] = duration;
    this.loadedSegments.add(index);
    if (typeof this.onSegmentPrepared === 'function') {
      this.onSegmentPrepared(index, result, offset, duration);
    }
    this.reportDiagnostics({ stage: 'prepared', statusText: '已缓冲', currentIndex: index });
    return { offset, duration };
  }

  computeOffset(index) {
    let offset = 0;
    for (let i = 0; i < index; i += 1) {
      const duration = this.segmentDurations[i];
      if (Number.isFinite(duration) && duration > 0) {
        offset += duration;
      }
    }
    return offset;
  }

  deriveDuration(result) {
    if (Number.isFinite(result?.duration) && result.duration > 0) {
      return Number(result.duration);
    }
    const timeline = Array.isArray(result?.mouthTimeline) ? result.mouthTimeline : [];
    if (timeline.length > 0) {
      const last = timeline[timeline.length - 1];
      if (Number.isFinite(last?.t)) {
        return Math.max(0, Number(last.t));
      }
    }
    return 0;
  }

  runSegmentPlayback(result, index, offset, expectedDuration) {
    return new Promise((resolve, reject) => {
      if (!result || !result.audioUrl) {
        resolve();
        return;
      }
      const audio = new Audio(resolveServerUrl(result.audioUrl));
      audio.crossOrigin = 'anonymous';
      this.currentAudio = audio;
      this.currentIndex = index;
      let settled = false;
      const cleanup = () => {
        if (this.monitorId !== null) {
          cancelAnimationFrame(this.monitorId);
          this.monitorId = null;
        }
        this.clearLatencyTimers();
        if (this.latencyCleanup) {
          this.latencyCleanup();
          this.latencyCleanup = null;
        }
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        if (typeof this.onSegmentEnd === 'function') {
          this.onSegmentEnd(index);
        }
      };

      const finalize = (status, error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (status === 'error') {
          reject(error);
        } else {
          resolve();
        }
      };

      const handlePlay = () => {
        if (this.finished) {
          finalize('done');
          return;
        }
        if (!this.mouthSignalActive) {
          this.mouthSignal.start();
          this.mouthSignalActive = true;
        }
        this.activateClock(audio, offset, index);
        const clock = () => this.computeClock();
        this.mouthSignal.playTimeline(Array.isArray(result.mouthTimeline) ? result.mouthTimeline : [], clock);
        if (typeof this.onSegmentStart === 'function') {
          this.onSegmentStart(audio, index, clock);
        }
        this.reportDiagnostics({ stage: 'segment-start', statusText: '播放中', currentIndex: index });
        if (this.prefetchThreshold > 0) {
          this.armPrefetch(index + 1, expectedDuration, audio);
        }
      };

      const handleEnded = () => {
        finalize('done');
      };

      const handleError = (event) => {
        const error = event?.error instanceof Error ? event.error : new Error('音频播放失败');
        finalize('error', error);
      };

      const handleTimeUpdate = () => {
        if (this.clockState?.useFallback) {
          this.switchToAudioClock();
        }
      };

      audio.addEventListener('play', handlePlay, { once: true });
      audio.addEventListener('ended', handleEnded, { once: true });
      audio.addEventListener('error', handleError, { once: true });
      audio.addEventListener('timeupdate', handleTimeUpdate);

      audio.play().catch((error) => {
        finalize('error', error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  activateClock(audio, offset, index) {
    this.clockState = {
      audio,
      offsetBase: offset,
      extraOffset: 0,
      useFallback: false,
      fallbackStart: 0,
      fallbackLast: 0,
    };
    this.clearLatencyTimers();
    if (this.latencyCleanup) {
      this.latencyCleanup();
      this.latencyCleanup = null;
    }
    if (index === 0 && this.latencyComp.enabled) {
      const threshold = Number.isFinite(this.latencyComp.thresholdMs) ? this.latencyComp.thresholdMs : 0;
      if (threshold > 0) {
        this.latencyTimers.threshold = window.setTimeout(() => {
          if (this.finished || !this.clockState || this.clockState.audio !== audio) {
            return;
          }
          if (audio.currentTime > 0.02) {
            return;
          }
          this.clockState.useFallback = true;
          this.clockState.fallbackStart = performance.now();
          this.clockState.fallbackLast = 0;
          const maxLead = Number.isFinite(this.latencyComp.maxLeadMs) ? this.latencyComp.maxLeadMs : 0;
          if (maxLead > 0) {
            this.latencyTimers.maxLead = window.setTimeout(() => {
              this.switchToAudioClock();
            }, maxLead);
          }
        }, threshold);
      }
      const sync = () => {
        if (this.clockState?.useFallback && audio.currentTime > 0.02) {
          this.switchToAudioClock();
        }
      };
      audio.addEventListener('playing', sync);
      audio.addEventListener('timeupdate', sync);
      this.latencyCleanup = () => {
        audio.removeEventListener('playing', sync);
        audio.removeEventListener('timeupdate', sync);
        this.clearLatencyTimers();
      };
    }
  }

  switchToAudioClock() {
    if (!this.clockState || !this.clockState.useFallback) {
      return;
    }
    const audio = this.clockState.audio;
    const fallbackElapsed = this.clockState.fallbackLast;
    const audioTime = audio?.currentTime;
    if (Number.isFinite(fallbackElapsed) && Number.isFinite(audioTime)) {
      const drift = Math.max(0, fallbackElapsed - audioTime);
      this.clockState.extraOffset = drift;
    }
    this.clockState.useFallback = false;
    this.clearLatencyTimers();
  }

  clearLatencyTimers() {
    if (this.latencyTimers.threshold !== null) {
      clearTimeout(this.latencyTimers.threshold);
      this.latencyTimers.threshold = null;
    }
    if (this.latencyTimers.maxLead !== null) {
      clearTimeout(this.latencyTimers.maxLead);
      this.latencyTimers.maxLead = null;
    }
  }

  armPrefetch(nextIndex, expectedDuration, audio) {
    if (nextIndex >= this.totalSegments || this.prefetchIndices.has(nextIndex)) {
      return;
    }
    const threshold = Math.min(0.95, Math.max(0.1, this.prefetchThreshold));
    const checkProgress = () => {
      if (this.finished || this.currentAudio !== audio) {
        return;
      }
      const fallbackDuration = Number.isFinite(expectedDuration) && expectedDuration > 0 ? expectedDuration : audio.duration;
      if (Number.isFinite(fallbackDuration) && fallbackDuration > 0) {
        const ratio = audio.currentTime / fallbackDuration;
        if (ratio >= threshold) {
          this.prefetchIndices.add(nextIndex);
          this.obtainSegmentPromise(nextIndex);
          this.reportDiagnostics({ stage: 'prefetch', statusText: '预取中', currentIndex: this.currentIndex });
          this.monitorId = null;
          return;
        }
      }
      this.monitorId = requestAnimationFrame(checkProgress);
    };
    if (this.monitorId !== null) {
      cancelAnimationFrame(this.monitorId);
      this.monitorId = null;
    }
    this.monitorId = requestAnimationFrame(checkProgress);
  }

  computeClock() {
    if (!this.clockState) {
      return 0;
    }
    if (this.clockState.useFallback) {
      const elapsed = (performance.now() - this.clockState.fallbackStart) / 1000;
      this.clockState.fallbackLast = elapsed;
      return this.clockState.offsetBase + elapsed;
    }
    const audio = this.clockState.audio;
    const audioTime = audio?.currentTime;
    if (!Number.isFinite(audioTime)) {
      return this.clockState.offsetBase + this.clockState.extraOffset;
    }
    return this.clockState.offsetBase + audioTime + this.clockState.extraOffset;
  }

  getCurrentTime() {
    return this.computeClock();
  }

  finish(status, error) {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.stopped = true;
    if (this.monitorId !== null) {
      cancelAnimationFrame(this.monitorId);
      this.monitorId = null;
    }
    this.clearLatencyTimers();
    if (this.latencyCleanup) {
      this.latencyCleanup();
      this.latencyCleanup = null;
    }
    if (this.currentAudio) {
      this.currentAudio.pause();
    }
    this.currentAudio = null;
    const statusText =
      status === 'error' ? '异常' : status === 'stopped' ? '已停止' : status === 'done' ? '已完成' : '空闲';
    this.reportDiagnostics({ stage: status, statusText, currentIndex: this.currentIndex });
    if (status === 'error') {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      if (typeof this.onPlaybackError === 'function') {
        this.onPlaybackError(errorObj);
      }
      if (this.rejectPlayback) {
        this.rejectPlayback(errorObj);
      }
    } else {
      if (typeof this.onPlaybackComplete === 'function') {
        this.onPlaybackComplete({ stopped: status === 'stopped' });
      }
      if (this.resolvePlayback) {
        this.resolvePlayback();
      }
    }
  }
}

const playWithTimelineSegments = async ({ initial, fetchers = [], wordCollector = null }) => {
  const timelinePlayer = new TimelinePlayer({
    mouthSignal,
    prefetchThreshold: TIMELINE_PREFS.prefetchThreshold,
    latencyCompensation: TIMELINE_PREFS.latencyCompensation,
    diagnosticsReporter: handleTimelineDiagnostics,
    onSegmentPrepared: (index, result, offset) => {
      if (wordCollector) {
        appendWordTimelineEntries(wordCollector, result?.wordTimeline || [], offset);
        setServerWordTimeline([...wordCollector]);
      }
    },
    onSegmentStart: (audio, index, clock) => {
      currentAudio = audio;
      currentAudioCleanup = () => timelinePlayer.stop();
      if (activeWordTimeline.length > 0) {
        startWordHighlight(() => getActivePlaybackClock());
      } else {
        stopWordHighlight();
      }
    },
    onSegmentEnd: () => {},
    onPlaybackComplete: () => {
      currentAudio = null;
      currentAudioCleanup = null;
      stopWordHighlight();
      mouthSignal.stop();
    },
    onPlaybackError: () => {
      currentAudio = null;
      currentAudioCleanup = null;
      stopWordHighlight();
      mouthSignal.stop();
    },
  });
  activeTimelinePlayer = timelinePlayer;
  try {
    await timelinePlayer.play(initial, fetchers);
  } finally {
    activeTimelinePlayer = null;
  }
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
  if (activeTimelinePlayer) {
    activeTimelinePlayer.stop();
    activeTimelinePlayer = null;
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
  updateDiagnosticsState({
    syncSource: mouthCaptureActive ? '摄像头捕捉' : '空闲',
    timeline: {
      total: 0,
      prepared: 0,
      prefetched: 0,
      current: -1,
      status: mouthCaptureActive ? '摄像头驱动' : '已停止',
    },
    extraInfo: mouthCaptureActive ? '摄像头帧直接驱动 mouth 值。' : '已停止播放。',
  });
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
      startWordHighlight(() => getActivePlaybackClock());
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
        startWordHighlight(() => getActivePlaybackClock());
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
        startWordHighlight(() => getActivePlaybackClock());
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
    updateDiagnosticsState({
      syncSource: '占位时间轴',
      extraInfo: '输入为空，播放默认占位节奏。',
      timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: '占位播放' },
    });
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
      if (diagnosticsState.timeline.status !== '异常') {
        updateDiagnosticsState({
          syncSource: mouthCaptureActive ? '摄像头捕捉' : '空闲',
          timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: mouthCaptureActive ? '摄像头驱动' : '空闲' },
          extraInfo: mouthCaptureActive ? '摄像头帧直接驱动 mouth 值。' : '等待音频或摄像头驱动。',
        });
      }
    }, (duration + 0.4) * 1000);
    return;
  }

  stopCurrentPlayback();
  prepareTimelineWithPlugins(text);
  playButton.disabled = true;
  overlayInfo('开始请求 TTS...');

  try {
    const provider = providerSelect.value;
    const speechRate = parseFloat(rateSlider.value);
    const espeakRate = Math.max(80, Math.round(170 * speechRate));
    currentAbort = new AbortController();
    updateDiagnosticsState({
      syncSource: '服务端 TTS 请求',
      extraInfo: '等待服务端返回音频与时间轴...',
      timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: '请求中' },
    });

    const segments = splitTextIntoSegments(text);
    let useSegmentedPlayback = TIMELINE_PREFS.segmentMode !== 'off' && segments.length > 1;
    let activeSegments = useSegmentedPlayback ? segments : [text];
    const baseRequestOptions = {
      provider,
      rate: espeakRate,
      voice: activeRole?.voice,
      abortSignal: currentAbort.signal,
    };

    let initialResult = null;

    if (useSegmentedPlayback) {
      try {
        initialResult = await requestServerTts(activeSegments[0], {
          ...baseRequestOptions,
          segmentIndex: 0,
          segmentCount: activeSegments.length,
          segmentId: `seg-1-of-${activeSegments.length}`,
        });
      } catch (error) {
        console.warn('首段分段请求失败，将尝试整段播放。', error);
      }
      if (
        !initialResult ||
        !Array.isArray(initialResult.mouthTimeline) ||
        initialResult.mouthTimeline.length === 0 ||
        !initialResult.audioUrl
      ) {
        overlayInfo('分段首段未返回时间轴，改为整段请求。');
        useSegmentedPlayback = false;
        activeSegments = [text];
        initialResult = null;
      }
    }

    if (!initialResult) {
      try {
        initialResult = await requestServerTts(text, baseRequestOptions);
      } catch (error) {
        console.warn('调用服务端 TTS 失败，将尝试 Web Speech 或回退。', error);
      }
      if (!initialResult) {
        useSegmentedPlayback = false;
        activeSegments = [text];
      }
    }

    if (
      initialResult &&
      Array.isArray(initialResult.mouthTimeline) &&
      initialResult.mouthTimeline.length > 0 &&
      initialResult.audioUrl
    ) {
      const aggregatedWordTimeline = [];
      setServerWordTimeline([]);
      const fetchers = useSegmentedPlayback
        ? activeSegments.slice(1).map((segmentText, index) => () =>
            requestServerTts(segmentText, {
              ...baseRequestOptions,
              segmentIndex: index + 1,
              segmentCount: activeSegments.length,
              segmentId: `seg-${index + 2}-of-${activeSegments.length}`,
            }),
          )
        : [];
      overlayInfo(useSegmentedPlayback ? '使用分段时间轴驱动口型。' : '使用服务端时间轴驱动口型。');
      updateDiagnosticsState({
        syncSource: useSegmentedPlayback ? '分段时间轴' : '服务端时间轴',
        extraInfo: useSegmentedPlayback ? '分段 mouthTimeline 播放中。' : '使用服务端 mouthTimeline 播放中。',
        timeline: {
          total: 1 + fetchers.length,
          prepared: 0,
          prefetched: 0,
          current: -1,
          status: '等待首段',
        },
      });
      audioDriving = true;
      try {
        await playWithTimelineSegments({
          initial: initialResult,
          fetchers,
          wordCollector: aggregatedWordTimeline,
        });
      } finally {
        audioDriving = false;
      }
    } else if (initialResult && initialResult.audioUrl) {
      overlayInfo('服务端未提供时间轴，改用音量包络分析。');
      stopWordHighlight();
      setServerWordTimeline([]);
      updateDiagnosticsState({
        syncSource: '音量包络',
        extraInfo: '通过 Web Audio analyser 驱动口型。',
        timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: '音频分析' },
      });
      audioDriving = true;
      try {
        await playWithAnalyserUrl(initialResult.audioUrl);
      } finally {
        audioDriving = false;
      }
    } else if (useWebSpeechCheckbox.checked && 'speechSynthesis' in window) {
      overlayInfo('使用 Web Speech API 作为兜底。');
      stopWordHighlight();
      setServerWordTimeline([]);
      updateDiagnosticsState({
        syncSource: 'Web Speech',
        extraInfo: '使用 SpeechSynthesis boundary 事件触发 mouth 脉冲。',
        timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: '实时脉冲' },
      });
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
      setServerWordTimeline([]);
      updateDiagnosticsState({
        syncSource: '占位时间轴',
        extraInfo: '根据文本长度生成占位口型曲线。',
        timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: '占位播放' },
      });
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
        if (diagnosticsState.timeline.status !== '异常') {
          updateDiagnosticsState({
            syncSource: mouthCaptureActive ? '摄像头捕捉' : '空闲',
            timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: mouthCaptureActive ? '摄像头驱动' : '空闲' },
            extraInfo: mouthCaptureActive ? '摄像头帧直接驱动 mouth 值。' : '等待音频或摄像头驱动。',
          });
        }
      }, (duration + 0.4) * 1000);
    }
  } catch (error) {
    console.error('播放失败：', error);
    const message = error instanceof Error ? error.message : String(error);
    overlayInfo(`播放失败：${message}`);
    updateDiagnosticsState({
      timeline: { status: '异常', current: -1 },
      extraInfo: `异常：${message}`,
    });
    mouthSignal.stop();
    audioDriving = false;
  } finally {
    playButton.disabled = false;
    currentAbort = null;
    overlayInfo('播放流程结束。');
    if (diagnosticsState.timeline.status === '异常') {
      return;
    }
    if (mouthCaptureActive) {
      updateDiagnosticsState({
        syncSource: '摄像头捕捉',
        timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: '摄像头驱动' },
        extraInfo: '摄像头帧直接驱动 mouth 值。',
      });
    } else {
      updateDiagnosticsState({
        syncSource: '空闲',
        timeline: { total: 0, prepared: 0, prefetched: 0, current: -1, status: '空闲' },
        extraInfo: '等待音频或摄像头驱动。',
      });
    }
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
    if (isPluginActive('mouth-capture')) {
      disablePlugin('mouth-capture');
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

