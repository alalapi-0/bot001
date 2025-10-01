/**
 * @file index.js
 * @description 微信小程序首页，调用服务端 TTS 并根据 mouth 时间轴驱动“大嘴巴头”。
 */

const { AutoGainProcessor, DEFAULT_AUTO_GAIN_CONFIG } = require('../../utils/auto-gain');

const DEFAULT_SERVER_ORIGIN = 'http://localhost:8787';
const RENDER_MODES = ['Vector', 'Sprite'];
const PROVIDER_LABELS = ['espeak', 'azure'];
const TIMER_INTERVAL = 66; // 约 15 FPS，对应 60~80Hz 插值节奏
const AUTO_GAIN_STORAGE_KEY = 'stickbot:auto-gain';
const ROLE_STORAGE_KEY = 'stickbot:role-profile';
const THEME_STORAGE_KEY = 'stickbot:manual-theme';

const THEME_CLASS_MAP = {
  classic: 'theme-classic',
  bright: 'theme-bright',
  dark: 'theme-dark',
  minimal: 'theme-minimal',
};

const THEME_ALIASES = {
  noir: 'dark',
  pastel: 'minimal',
  default: 'classic',
};

const cloneTheme = (theme) => {
  try {
    return JSON.parse(JSON.stringify(theme || {}));
  } catch (error) {
    console.warn('克隆主题失败，使用空对象回退', error);
    return {};
  }
};

const parseNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseColor = (value, fallback) => (typeof value === 'string' && value.trim() ? value : fallback);

const BASE_THEME = {
  id: 'classic',
  name: '经典紫调',
  bg: '#f5f5f5',
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
};

const FALLBACK_THEME_ENTRIES = [
  {
    id: 'classic',
    name: '经典紫调',
    data: cloneTheme(BASE_THEME),
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

/** @type {Map<string, { id: string, name: string, data: any }>} */
const themeRegistry = new Map();
/** @type {{ id: string, name: string, data: any }[]} */
let themeList = [];
/** @type {Map<string, string>} */
const themeDisplayMap = new Map();
let defaultThemeId = 'classic';

const normalizeThemeId = (value, options = {}) => {
  const allowEmpty = Boolean(options.allowEmpty);
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) {
    return allowEmpty ? '' : 'classic';
  }
  return THEME_ALIASES[raw] || raw;
};

const resolveThemeClass = (theme) => {
  const id = normalizeThemeId(theme || 'classic');
  return THEME_CLASS_MAP[id] || THEME_CLASS_MAP.classic;
};

const resolveThemeData = (theme) => {
  if (!theme) {
    return cloneTheme(BASE_THEME);
  }

  const bodyStroke = parseColor(theme.body?.stroke ?? theme.stroke, BASE_THEME.body.stroke);
  const bodyWidth = Math.max(1, parseNumber(theme.body?.lineWidth ?? theme.lineWidth, BASE_THEME.body.lineWidth));

  const headStroke = parseColor(theme.head?.stroke ?? theme.stroke, BASE_THEME.head.stroke);
  const headFill = parseColor(theme.head?.fill ?? theme.fill, BASE_THEME.head.fill);
  const headWidth = Math.max(1, parseNumber(theme.head?.lineWidth ?? theme.lineWidth, BASE_THEME.head.lineWidth));

  const eyeStroke = parseColor(theme.eye?.stroke ?? theme.stroke, BASE_THEME.eye.stroke);
  const eyeWidth = Math.max(1, parseNumber(theme.eye?.lineWidth, BASE_THEME.eye.lineWidth));
  const eyeGap = Math.max(10, parseNumber(theme.eye?.gap, BASE_THEME.eye.gap));
  const eyeMinHeight = Math.max(1, parseNumber(theme.eye?.minHeight, BASE_THEME.eye.minHeight));

  const mouthStroke = parseColor(theme.mouth?.stroke ?? theme.stroke, BASE_THEME.mouth.stroke);
  const mouthLineWidth = Math.max(1, parseNumber(theme.mouth?.lineWidth ?? theme.lineWidth, BASE_THEME.mouth.lineWidth));
  const mouthFill = parseColor(theme.mouth?.fill ?? theme.fill, BASE_THEME.mouth.fill);
  const mouthInner = parseColor(theme.mouth?.innerFill ?? theme.mouth?.fill ?? theme.fill, BASE_THEME.mouth.innerFill);
  const toothFill = parseColor(theme.mouth?.toothFill, BASE_THEME.mouth.toothFill);
  const toothCount = Math.max(1, Math.round(parseNumber(theme.mouth?.toothCount, BASE_THEME.mouth.toothCount)));
  const toothScale = clamp(parseNumber(theme.mouth?.toothScale, BASE_THEME.mouth.toothScale), 0.2, 2.2);
  const widthScale = clamp(parseNumber(theme.mouth?.widthScale, BASE_THEME.mouth.widthScale), 0.4, 2.2);
  const heightScale = clamp(parseNumber(theme.mouth?.heightScale, BASE_THEME.mouth.heightScale), 0.4, 2.2);
  const cornerBase = clamp(parseNumber(theme.mouth?.cornerCurveBase, BASE_THEME.mouth.cornerCurveBase), -1, 1);
  const highlightStroke = parseColor(
    theme.mouth?.highlightStroke ?? theme.mouth?.stroke ?? theme.stroke,
    BASE_THEME.mouth.highlightStroke,
  );
  const highlightWidth = Math.max(0, parseNumber(theme.mouth?.highlightWidth, BASE_THEME.mouth.highlightWidth));
  const roundedViseme = Math.max(0, Math.round(parseNumber(theme.mouth?.roundedViseme, BASE_THEME.mouth.roundedViseme)));

  return {
    id: typeof theme.id === 'string' ? theme.id : BASE_THEME.id,
    name: typeof theme.name === 'string' ? theme.name : BASE_THEME.name,
    bg: parseColor(theme.bg, BASE_THEME.bg),
    body: { stroke: bodyStroke, lineWidth: bodyWidth },
    head: { stroke: headStroke, fill: headFill, lineWidth: headWidth },
    eye: { stroke: eyeStroke, lineWidth: eyeWidth, gap: eyeGap, minHeight: eyeMinHeight },
    mouth: {
      stroke: mouthStroke,
      lineWidth: mouthLineWidth,
      fill: mouthFill,
      innerFill: mouthInner,
      toothFill,
      toothCount,
      toothScale,
      widthScale,
      heightScale,
      cornerCurveBase: cornerBase,
      highlightStroke,
      highlightWidth,
      roundedViseme,
    },
  };
};

const initializeThemes = (entries, defaultId) => {
  themeRegistry.clear();
  themeDisplayMap.clear();
  themeList = [];
  const seen = new Set();
  entries.forEach((entry) => {
    const normalizedId = normalizeThemeId(entry?.id);
    if (seen.has(normalizedId)) {
      return;
    }
    seen.add(normalizedId);
    const name = typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : normalizedId;
    const data = cloneTheme(entry?.data || {});
    if (!data.id) {
      data.id = normalizedId;
    }
    if (!data.name) {
      data.name = name;
    }
    const prepared = { id: normalizedId, name, data };
    themeRegistry.set(normalizedId, prepared);
    themeDisplayMap.set(normalizedId, name);
    themeList.push(prepared);
  });
  const normalizedDefault = normalizeThemeId(defaultId);
  if (themeRegistry.has(normalizedDefault)) {
    defaultThemeId = normalizedDefault;
  } else if (themeList.length > 0 && !themeRegistry.has(defaultThemeId)) {
    defaultThemeId = themeList[0].id;
  }
};

const hasTheme = (themeId) => themeRegistry.has(normalizeThemeId(themeId));

const getThemeDisplayName = (themeId) => themeDisplayMap.get(normalizeThemeId(themeId)) || normalizeThemeId(themeId);

const getThemeByIndex = (index) => {
  if (index <= 0) {
    return null;
  }
  return themeList[index - 1] || null;
};

const getThemePickerNames = () => ['跟随角色', ...themeList.map((item) => item.name || item.id)];

const getThemePickerIndex = (themeId) => {
  const normalized = normalizeThemeId(themeId, { allowEmpty: true });
  if (!normalized) {
    return 0;
  }
  const idx = themeList.findIndex((item) => item.id === normalized);
  return idx >= 0 ? idx + 1 : 0;
};

const resolveThemeFromRegistry = (themeId) => {
  const normalized = normalizeThemeId(themeId);
  const entry = themeRegistry.get(normalized) || themeRegistry.get(defaultThemeId) || themeList[0];
  const resolved = resolveThemeData(entry ? entry.data : BASE_THEME);
  if (!resolved.id) {
    resolved.id = entry?.id || normalized;
  }
  if (!resolved.name) {
    resolved.name = entry?.name || resolved.id;
  }
  return resolved;
};

const resolveThemeUrl = (origin, themePath) => {
  if (!themePath) {
    return '';
  }
  if (/^https?:/i.test(themePath)) {
    return themePath;
  }
  const cleanOrigin = (origin || DEFAULT_SERVER_ORIGIN).replace(/\/+$/, '');
  if (themePath.startsWith('/')) {
    return `${cleanOrigin}${themePath}`;
  }
  let normalized = themePath.replace(/^\.\//, '');
  if (!normalized.startsWith('themes/')) {
    normalized = `themes/${normalized}`;
  }
  return `${cleanOrigin}/${normalized}`;
};

initializeThemes(FALLBACK_THEME_ENTRIES, 'classic');

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

const DEFAULT_EXPRESSION = {
  mouthOpenScale: 1,
  lipTension: 0,
  cornerCurve: 0,
  eyeBlinkBias: 0,
  headNodAmp: 0.2,
  swayAmp: 0.25,
};

/**
 * 对数值进行夹紧。
 * @param {number} value - 原始值。
 * @param {number} min - 最小值。
 * @param {number} max - 最大值。
 * @returns {number} 夹紧后的结果。
 */
function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.min(max, Math.max(min, num));
}

/**
 * 规范化角色档案。
 * @param {any} role - 原始角色对象。
 * @param {string} fallbackId - 回退 ID。
 * @returns {{ id: string, name: string, description: string, voice: string, preset: Record<string, number>, theme: string, renderMode: string }} 规范化结果。
 */
function sanitizeRole(role, fallbackId) {
  const id = typeof role?.id === 'string' && role.id.trim() ? role.id.trim() : fallbackId;
  const preset = role && typeof role.preset === 'object' && role.preset ? role.preset : {};
  return {
    id,
    name: typeof role?.name === 'string' && role.name.trim() ? role.name.trim() : id,
    description: typeof role?.description === 'string' ? role.description : '',
    voice: typeof role?.voice === 'string' && role.voice ? role.voice : '',
    preset,
    theme: typeof role?.theme === 'string' && role.theme ? role.theme : 'classic',
    renderMode: typeof role?.renderMode === 'string' && role.renderMode ? role.renderMode : 'vector',
  };
}

/**
 * 构建角色元信息展示文案。
 * @param {{ voice?: string, renderMode?: string, theme?: string }} role - 角色档案。
 * @param {{ themeId?: string }} [options] - 附加选项。
 * @returns {string} 展示文本。
 */
function buildRoleMeta(role, options = {}) {
  const parts = [];
  if (role?.voice) {
    parts.push(`voice: ${role.voice}`);
  }
  if (role?.renderMode) {
    parts.push(`渲染: ${role.renderMode}`);
  }
  const resolvedTheme = normalizeThemeId(options.themeId || role?.theme, { allowEmpty: true });
  if (resolvedTheme) {
    parts.push(`主题: ${getThemeDisplayName(resolvedTheme)}`);
  }
  return parts.join(' · ');
}

/**
 * 线性插值 mouth 时间轴。
 * @param {{ t: number, v: number, visemeId: number }[]} timeline - mouth 时间轴。
 * @param {number} time - 当前播放进度（秒）。
 * @returns {{ value: number, visemeId: number }} mouth 帧。
 */
function interpolateTimeline(timeline, time) {
  if (!timeline || timeline.length === 0) {
    return { value: 0.1, visemeId: 0 };
  }
  if (time <= timeline[0].t) {
    return { value: timeline[0].v, visemeId: timeline[0].visemeId };
  }
  for (let i = 1; i < timeline.length; i += 1) {
    const prev = timeline[i - 1];
    const next = timeline[i];
    if (time <= next.t) {
      const span = Math.max(next.t - prev.t, 1e-6);
      const ratio = (time - prev.t) / span;
      const value = prev.v + (next.v - prev.v) * ratio;
      const visemeId = ratio > 0.5 ? next.visemeId : prev.visemeId;
      return { value, visemeId };
    }
  }
  const last = timeline[timeline.length - 1];
  return { value: last.v, visemeId: last.visemeId };
}

/**
 * 规范化逐词字幕时间轴。
 * @param {Array<{ text?: string, tStart?: number, tEnd?: number, start?: number, end?: number, t?: number }>} timeline - 原始
数据。
 * @returns {{ text: string, tStart: number, tEnd: number }[]} 规范化结果。
 */
function normalizeWordTimeline(timeline) {
  if (!Array.isArray(timeline)) {
    return [];
  }
  return timeline
    .map((item) => {
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      if (!text) {
        return null;
      }
      const startCandidate = [item?.tStart, item?.start, item?.t].find((value) => Number.isFinite(Number(value)));
      const endCandidate = [item?.tEnd, item?.end, item?.t].find((value) => Number.isFinite(Number(value)));
      const start = Math.max(0, Number(startCandidate ?? 0));
      let end = Number(endCandidate ?? start);
      if (!Number.isFinite(end)) {
        end = start;
      }
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
}

/**
 * 根据时间获取当前字幕词块。
 * @param {{ text: string, tStart: number, tEnd: number }[]} timeline - 字幕时间轴。
 * @param {number} time - 当前播放进度（秒）。
 * @returns {{ index: number, text: string }} 字幕索引与文本。
 */
function getWordAtTime(timeline, time) {
  if (!timeline || timeline.length === 0) {
    return { index: -1, text: '' };
  }
  for (let i = 0; i < timeline.length; i += 1) {
    const segment = timeline[i];
    if (time >= segment.tStart && time < segment.tEnd) {
      return { index: i, text: segment.text };
    }
  }
  const last = timeline[timeline.length - 1];
  if (time >= last.tEnd) {
    return { index: timeline.length - 1, text: last.text };
  }
  return { index: -1, text: '' };
}

Page({
  data: {
    text: '你好，我是 stickbot，大嘴巴头准备就绪！',
    providers: PROVIDER_LABELS,
    providerIndex: 0,
    renderModes: RENDER_MODES,
    renderModeIndex: 0,
    themeNames: getThemePickerNames(),
    themeIndex: 0,
    mouth: 0.1,
    mouthDisplay: '0.10',
    visemeId: 0,
    serverOrigin: '',
    spriteBasePath: '/assets/mouth',
    autoGainEnabled: true,
    currentWord: '',
    roleNames: [DEFAULT_ROLE.name],
    roleIndex: 0,
    themeClass: resolveThemeClass(DEFAULT_ROLE.theme),
    roleDescription: DEFAULT_ROLE.description,
    roleMeta: buildRoleMeta(DEFAULT_ROLE, { themeId: DEFAULT_ROLE.theme }),
  },
  /**
   * 生命周期函数：初始化画布、音频与服务端信息。
   */
  onLoad() {
    this.canvasCtx = wx.createCanvasContext('avatar');
    this.canvasWidth = 320;
    this.canvasHeight = 420;
    this.spriteCache = {};
    this.pendingSprites = {};
    this.timeline = [];
    this.timelineTimer = null;
    this.timelineStart = 0;
    this.autoGainProcessor = null;
    this.wordTimeline = [];
    this.wordIndex = -1;
    this.roles = [];
    this.activeRole = sanitizeRole(DEFAULT_ROLE, 'default');
    this.expressionPreset = { ...DEFAULT_EXPRESSION };
    this.themeResolved = resolveThemeFromRegistry(defaultThemeId);
    this.activeThemeId = this.themeResolved.id || defaultThemeId;
    this.manualThemeId = '';
    try {
      const storedTheme = wx.getStorageSync(THEME_STORAGE_KEY) || '';
      this.manualThemeId = normalizeThemeId(storedTheme, { allowEmpty: true });
    } catch (error) {
      console.warn('读取主题偏好失败', error);
      this.manualThemeId = '';
    }
    if (this.manualThemeId && !hasTheme(this.manualThemeId)) {
      this.manualThemeId = '';
      try {
        wx.removeStorageSync(THEME_STORAGE_KEY);
      } catch (error) {
        console.warn('清除主题偏好失败', error);
      }
    }
    this.updateThemeOptions();
    this.applyActiveTheme({ roleThemeId: this.activeRole.theme, deferDraw: true });

    this.innerAudio = wx.createInnerAudioContext();
    this.innerAudio.obeyMuteSwitch = false;
    this.innerAudio.onPlay(() => {
      this.startTimelineLoop();
    });
    this.innerAudio.onStop(() => {
      this.stopTimelineLoop();
    });
    this.innerAudio.onEnded(() => {
      this.stopTimelineLoop();
      this.resetMouth();
    });
    this.innerAudio.onError((err) => {
      console.error('播放失败', err);
      this.stopTimelineLoop();
      this.resetMouth();
    });

    this.drawAvatar();
    this.fetchProviders();

    let storedRoleId = '';
    try {
      storedRoleId = wx.getStorageSync(ROLE_STORAGE_KEY) || '';
    } catch (error) {
      console.warn('读取角色档案失败', error);
    }
    this.fetchRoles(storedRoleId);

    const stored = wx.getStorageSync(AUTO_GAIN_STORAGE_KEY);
    if (stored && typeof stored === 'object' && typeof stored.enabled === 'boolean') {
      this.setData({ autoGainEnabled: stored.enabled });
    }

    this.loadThemeManifest();
  },
  /**
   * 页面卸载时清理资源。
   */
  onUnload() {
    this.stopPlayback();
    if (this.innerAudio) {
      this.innerAudio.destroy();
    }
  },
  /**
   * 更新主题选择器选项。
   */
  updateThemeOptions() {
    const names = getThemePickerNames();
    const index = getThemePickerIndex(this.manualThemeId);
    this.setData({ themeNames: names, themeIndex: index });
  },
  /**
   * 若手动主题已失效则回退并清除缓存。
   */
  ensureManualThemeValid() {
    if (this.manualThemeId && !hasTheme(this.manualThemeId)) {
      this.manualThemeId = '';
      try {
        wx.removeStorageSync(THEME_STORAGE_KEY);
      } catch (error) {
        console.warn('清除主题偏好失败', error);
      }
    }
  },
  /**
   * 应用当前有效主题（页面选择 > 角色默认 > 全局默认）。
   * @param {{ roleThemeId?: string, deferDraw?: boolean }} [options] - 可选项。
   * @returns {string} 实际生效的主题 ID。
   */
  applyActiveTheme(options = {}) {
    const { roleThemeId = '', deferDraw = false } = options;
    const manualId = normalizeThemeId(this.manualThemeId, { allowEmpty: true });
    const roleId = normalizeThemeId(roleThemeId, { allowEmpty: true });
    const fallbackId = defaultThemeId;
    const candidates = [manualId, roleId, fallbackId];
    let targetId = '';
    for (const candidate of candidates) {
      if (candidate && hasTheme(candidate)) {
        targetId = candidate;
        break;
      }
    }
    if (!targetId) {
      targetId = themeList[0]?.id || fallbackId;
    }
    this.activeThemeId = targetId;
    this.themeResolved = resolveThemeFromRegistry(targetId);
    const themeClass = resolveThemeClass(targetId);
    const pickerIndex = getThemePickerIndex(this.manualThemeId);
    const patch = { themeClass };
    if (this.data.themeNames && this.data.themeNames.length > 0) {
      patch.themeIndex = pickerIndex;
    }
    this.setData(patch);
    this.updateRoleMeta();
    if (!deferDraw) {
      this.drawAvatar();
    }
    return this.activeThemeId;
  },
  /**
   * 根据当前角色与主题刷新元信息。
   */
  updateRoleMeta() {
    if (!this.activeRole) {
      this.setData({ roleMeta: '' });
      return;
    }
    const themeId = this.activeThemeId || this.activeRole.theme || defaultThemeId;
    this.setData({ roleMeta: buildRoleMeta(this.activeRole, { themeId }) });
  },
  /**
   * 拉取主题清单并按需更新注册表。
   */
  loadThemeManifest() {
    const origin = this.getServerOrigin();
    const manifestUrl = resolveThemeUrl(origin, 'themes/manifest.json');
    wx.request({
      url: manifestUrl,
      method: 'GET',
      success: (res) => {
        if (!res || res.statusCode < 200 || res.statusCode >= 300 || !res.data) {
          return;
        }
        const manifest = res.data;
        const themes = Array.isArray(manifest?.themes) ? manifest.themes : [];
        if (!themes || themes.length === 0) {
          if (manifest?.default) {
            const normalizedDefault = normalizeThemeId(manifest.default, { allowEmpty: false });
            if (normalizedDefault && hasTheme(normalizedDefault)) {
              defaultThemeId = normalizedDefault;
              this.applyActiveTheme({ roleThemeId: this.activeRole?.theme, deferDraw: true });
              this.drawAvatar();
            }
          }
          return;
        }
        const loaded = [];
        let remaining = themes.length;
        const finalize = () => {
          if (loaded.length > 0) {
            initializeThemes(loaded, manifest?.default || defaultThemeId);
            this.ensureManualThemeValid();
            this.updateThemeOptions();
            this.applyActiveTheme({ roleThemeId: this.activeRole?.theme, deferDraw: true });
            this.drawAvatar();
          }
        };
        themes.forEach((item) => {
          const rawId = normalizeThemeId(item?.id, { allowEmpty: false });
          const path = typeof item?.path === 'string' ? item.path : '';
          if (!rawId || !path) {
            remaining -= 1;
            if (remaining === 0) {
              finalize();
            }
            return;
          }
          const themeUrl = resolveThemeUrl(origin, path);
          wx.request({
            url: themeUrl,
            method: 'GET',
            success: (themeRes) => {
              if (themeRes && themeRes.statusCode >= 200 && themeRes.statusCode < 300 && themeRes.data) {
                loaded.push({
                  id: rawId,
                  name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : rawId,
                  data: themeRes.data,
                });
              }
            },
            fail: (error) => {
              console.warn('加载主题失败', rawId, error);
            },
            complete: () => {
              remaining -= 1;
              if (remaining === 0) {
                finalize();
              }
            },
          });
        });
      },
      fail: (error) => {
        console.warn('拉取主题清单失败', error);
      },
    });
  },
  /**
   * 文本输入事件。
   * @param {WechatMiniprogram.TextareaInput} event - 输入事件对象。
   */
  onTextInput(event) {
    this.setData({ text: event.detail.value });
  },
  /**
   * 切换角色档案。
   * @param {WechatMiniprogram.PickerChange} event - 选择事件。
   */
  onRoleChange(event) {
    const index = Number(event.detail.value);
    const safeIndex = Number.isFinite(index) ? index : 0;
    this.setData({ roleIndex: safeIndex });
    const role = Array.isArray(this.roles) ? this.roles[safeIndex] : null;
    if (role) {
      this.applyRole(role);
    }
  },
  /**
   * 切换 TTS 供应器。
   * @param {WechatMiniprogram.PickerChange} event - 选择事件。
   */
  onProviderChange(event) {
    this.setData({ providerIndex: Number(event.detail.value) });
  },
  /**
   * 切换渲染模式。
   * @param {WechatMiniprogram.PickerChange} event - 选择事件。
   */
  onRenderModeChange(event) {
    const index = Number(event.detail.value);
    this.setData({ renderModeIndex: index });
    if (this.activeRole) {
      const modes = this.data.renderModes || [];
      const modeValue = modes[index] ? String(modes[index]).toLowerCase() : 'vector';
      this.activeRole.renderMode = modeValue;
      this.updateRoleMeta();
    }
    this.drawAvatar();
  },
  /**
   * 切换主题。
   * @param {WechatMiniprogram.PickerChange} event - 选择事件。
   */
  onThemeChange(event) {
    const rawIndex = Number(event.detail.value);
    const index = Number.isFinite(rawIndex) ? rawIndex : 0;
    if (index <= 0) {
      this.manualThemeId = '';
      try {
        wx.removeStorageSync(THEME_STORAGE_KEY);
      } catch (error) {
        console.warn('清除主题偏好失败', error);
      }
    } else {
      const entry = getThemeByIndex(index);
      if (entry) {
        this.manualThemeId = entry.id;
        try {
          wx.setStorageSync(THEME_STORAGE_KEY, this.manualThemeId);
        } catch (error) {
          console.warn('保存主题偏好失败', error);
        }
      }
    }
    this.applyActiveTheme({ roleThemeId: this.activeRole?.theme, deferDraw: false });
  },
  /**
   * 点击“开始合成”。
   */
  onSynthesize() {
    const text = this.data.text.trim();
    if (!text) {
      wx.showToast({ title: '请输入文本', icon: 'none' });
      return;
    }
    this.stopPlayback();
    wx.showLoading({ title: '合成中...' });
    this.requestTts(text)
      .then((result) => {
        if (!result.audioUrl) {
          wx.showToast({ title: '未返回音频', icon: 'none' });
          return;
        }
        this.timeline = result.mouthTimeline || [];
        this.wordTimeline = normalizeWordTimeline(result.wordTimeline || []);
        this.wordIndex = -1;
        this.setData({ currentWord: '' });
        this.prepareAutoGain();
        this.innerAudio.src = this.resolveServerUrl(result.audioUrl);
        this.innerAudio.play();
      })
      .catch((error) => {
        console.error('请求 TTS 失败', error);
        wx.showToast({ title: 'TTS 请求失败', icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
  /**
   * 点击“停止”。
   */
  onStop() {
    this.stopPlayback();
  },
  /**
   * 停止音频与时间轴。
   */
  stopPlayback() {
    this.stopTimelineLoop();
    if (this.innerAudio && !this.innerAudio.paused) {
      this.innerAudio.stop();
    }
    this.resetMouth();
  },
  /**
   * 重置 mouth 状态并重绘。
   */
  resetMouth() {
    this.setData({ mouth: 0.1, mouthDisplay: '0.10', visemeId: 0, currentWord: '' });
    this.wordTimeline = [];
    this.wordIndex = -1;
    this.drawAvatar();
    if (this.autoGainProcessor) {
      this.autoGainProcessor.reset();
    }
  },
  /**
   * 拉取角色档案列表。
   * @param {string} storedRoleId - 本地存储的角色 ID。
   */
  fetchRoles(storedRoleId = '') {
    const origin = this.getServerOrigin();
    wx.request({
      url: `${origin}/roles`,
      method: 'GET',
      success: (res) => {
        let list = [];
        if (Array.isArray(res.data?.roles)) {
          list = res.data.roles;
        } else if (Array.isArray(res.data)) {
          list = res.data;
        }
        if (!Array.isArray(list) || list.length === 0) {
          list = [DEFAULT_ROLE];
        }
        this.roles = list.map((item, index) => sanitizeRole(item, `role-${index}`));
        if (!this.roles || this.roles.length === 0) {
          this.roles = [sanitizeRole(DEFAULT_ROLE, 'default')];
        }
        const roleNames = this.roles.map((item) => item.name || item.id);
        let roleIndex = 0;
        if (storedRoleId) {
          const found = this.roles.findIndex((item) => item.id === storedRoleId);
          if (found >= 0) {
            roleIndex = found;
          }
        }
        this.setData({ roleNames, roleIndex });
        const target = this.roles[roleIndex] || this.roles[0];
        if (target) {
          this.applyRole(target, { persist: false });
        }
      },
      fail: (error) => {
        console.warn('获取角色失败', error);
        if (!this.roles || this.roles.length === 0) {
          this.roles = [sanitizeRole(DEFAULT_ROLE, 'default')];
          this.setData({
            roleNames: this.roles.map((item) => item.name || item.id),
            roleIndex: 0,
          });
          this.applyRole(this.roles[0], { persist: false });
        }
      },
    });
  },
  /**
   * 应用角色设置并刷新 UI。
   * @param {ReturnType<typeof sanitizeRole>} role - 角色档案。
   * @param {{ persist?: boolean }} [options] - 控制是否写入本地缓存。
   */
  applyRole(role, options = {}) {
    if (!role) {
      return;
    }
    const persist = options.persist !== false;
    const sanitized = sanitizeRole(role, role.id || 'role');
    sanitized.renderMode = String(sanitized.renderMode || 'vector').toLowerCase();
    sanitized.theme = String(sanitized.theme || 'classic');
    this.activeRole = sanitized;
    this.expressionPreset = {
      ...DEFAULT_EXPRESSION,
      ...(sanitized.preset || {}),
    };
    const renderModeIndex = this.getRenderModeIndex(sanitized.renderMode);
    this.setData({
      renderModeIndex,
      roleDescription: sanitized.description || DEFAULT_ROLE.description,
    });
    this.applyActiveTheme({ roleThemeId: sanitized.theme, deferDraw: true });
    this.drawAvatar();
    if (persist) {
      try {
        wx.setStorageSync(ROLE_STORAGE_KEY, sanitized.id);
      } catch (error) {
        console.warn('保存角色失败', error);
      }
    }
  },
  /**
   * 根据渲染模式字符串返回下拉框索引。
   * @param {string} mode - 渲染模式。
   * @returns {number} 下标。
   */
  getRenderModeIndex(mode) {
    const target = String(mode || '').toLowerCase();
    const modes = this.data.renderModes || [];
    const index = modes.findIndex((item) => String(item).toLowerCase() === target);
    return index >= 0 ? index : 0;
  },
  /**
   * 获取当前表情预设。
   * @returns {{ mouthOpenScale: number, lipTension: number, cornerCurve: number, eyeBlinkBias: number, headNodAmp: number, swayAmp: number }} 表情参数。
   */
  getExpression() {
    return this.expressionPreset || DEFAULT_EXPRESSION;
  },
  /**
   * 调用服务端 `/tts`。
   * @param {string} text - 待合成文本。
   * @returns {Promise<{ audioUrl: string, mouthTimeline: { t: number, v: number, visemeId: number }[] }>} 结果。
   */
  requestTts(text) {
    const provider = this.data.providers[this.data.providerIndex];
    const origin = this.getServerOrigin();
    const payload = {
      text,
      provider,
    };
    if (this.activeRole?.voice) {
      payload.voice = this.activeRole.voice;
    }
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${origin}/tts`,
        method: 'GET',
        data: payload,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        },
        fail: reject,
      });
    });
  },
  /**
   * 获取服务端地址，可在 data.serverOrigin 中覆盖。
   * @returns {string} 服务端基础 URL。
   */
  getServerOrigin() {
    return this.data.serverOrigin || DEFAULT_SERVER_ORIGIN;
  },
  /**
   * 将相对路径转换为绝对 URL。
   * @param {string} path - 相对路径。
   * @returns {string} 完整 URL。
   */
  resolveServerUrl(path) {
    if (!path) return this.getServerOrigin();
    if (/^https?:/i.test(path)) {
      return path;
    }
    return `${this.getServerOrigin()}${path}`;
  },
  /**
   * 启动时间轴定时器，每 50~80ms 更新一次口型。
   */
  startTimelineLoop() {
    this.stopTimelineLoop();
    const hasMouthTimeline = Array.isArray(this.timeline) && this.timeline.length > 0;
    const hasWordTimeline = Array.isArray(this.wordTimeline) && this.wordTimeline.length > 0;
    if (!hasMouthTimeline && !hasWordTimeline) {
      return;
    }
    this.timelineStart = Date.now();
    this.timelineTimer = setInterval(() => {
      const elapsed = (Date.now() - this.timelineStart) / 1000;
      if (hasMouthTimeline) {
        const frame = interpolateTimeline(this.timeline, elapsed);
        let value = frame.value;
        if (this.autoGainProcessor) {
          value = this.autoGainProcessor.apply(elapsed, value).value;
        }
        this.updateMouthFrame(value, frame.visemeId);
      }
      if (hasWordTimeline) {
        const currentWord = getWordAtTime(this.wordTimeline, elapsed);
        if (currentWord.index !== this.wordIndex) {
          this.wordIndex = currentWord.index;
          this.setData({ currentWord: currentWord.text });
        }
      }
      const lastMouthTime = hasMouthTimeline ? this.timeline[this.timeline.length - 1]?.t || 0 : 0;
      const lastWordTime = hasWordTimeline ? this.wordTimeline[this.wordTimeline.length - 1]?.tEnd || 0 : 0;
      const lastTime = Math.max(lastMouthTime, lastWordTime);
      if (lastTime > 0 && elapsed >= lastTime) {
        this.stopTimelineLoop();
      }
    }, TIMER_INTERVAL);
  },
  /**
   * 停止时间轴定时器。
   */
  stopTimelineLoop() {
    if (this.timelineTimer) {
      clearInterval(this.timelineTimer);
      this.timelineTimer = null;
    }
  },
  /**
   * 根据当前时间轴初始化自动增益处理器。
   */
  prepareAutoGain() {
    if (!this.data.autoGainEnabled || !this.timeline || this.timeline.length === 0) {
      this.autoGainProcessor = null;
      return;
    }
    this.autoGainProcessor = new AutoGainProcessor(this.timeline, DEFAULT_AUTO_GAIN_CONFIG);
  },
  /**
   * 更新 mouth 并重绘。
   * @param {number} value - mouth 值。
   * @param {number} visemeId - 口型编号。
   */
  updateMouthFrame(value, visemeId) {
    const clamped = Math.max(0, Math.min(1, value));
    this.setData({
      mouth: clamped,
      mouthDisplay: clamped.toFixed(2),
      visemeId,
    });
    this.drawAvatar();
  },
  /**
   * 自动增益开关。
   * @param {WechatMiniprogram.SwitchChange} event - 事件对象。
   */
  onAutoGainToggle(event) {
    const enabled = !!event.detail.value;
    this.setData({ autoGainEnabled: enabled });
    if (enabled) {
      this.prepareAutoGain();
    } else {
      this.autoGainProcessor = null;
    }
    try {
      wx.setStorageSync(AUTO_GAIN_STORAGE_KEY, { enabled, config: DEFAULT_AUTO_GAIN_CONFIG });
    } catch (error) {
      console.warn('保存自动增益状态失败', error);
    }
  },
  /**
   * 绘制火柴人 + 大嘴巴头。
   */
  drawAvatar() {
    const ctx = this.canvasCtx;
    if (!ctx) return;
    const mouth = this.data.mouth;
    const visemeId = this.data.visemeId;
    const theme = this.themeResolved || resolveThemeFromRegistry(this.activeThemeId || defaultThemeId);
    this.themeResolved = theme;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    ctx.setFillStyle(theme.bg);
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    ctx.save();
    ctx.translate(this.canvasWidth / 2, this.canvasHeight / 2 + 40);
    ctx.setLineCap('round');
    this.drawBody(ctx);
    if (this.data.renderModes[this.data.renderModeIndex] === 'Sprite') {
      this.drawSpriteHead(ctx, mouth, visemeId);
    } else {
      this.drawVectorHead(ctx, mouth, visemeId);
    }
    ctx.restore();
    ctx.draw();
  },
  /**
   * 绘制身体。
   * @param {WechatMiniprogram.CanvasContext} ctx - 画布上下文。
   */
  drawBody(ctx) {
    const time = Date.now() / 1000;
    const expression = this.getExpression();
    const swayFactor = clamp(1 + (expression.swayAmp ?? 0) * 0.8, 0.5, 2);
    const swing = Math.sin(time * 1.5 * clamp(1 + (expression.swayAmp ?? 0) * 0.3, 0.5, 2)) * 0.22 * swayFactor;
    const jitter = (Math.random() - 0.5) * 0.05 * (0.2 + this.data.mouth) * clamp(1 + (expression.headNodAmp ?? 0) * 0.6, 0.6, 1.8);
    const theme = this.themeResolved || resolveThemeFromRegistry(this.activeThemeId || defaultThemeId);
    const bodyTheme = theme.body;
    ctx.setStrokeStyle(bodyTheme.stroke);
    ctx.setLineWidth(bodyTheme.lineWidth);

    ctx.beginPath();
    ctx.moveTo(0, -120);
    ctx.lineTo(0, 40);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -80);
    ctx.lineTo(-70, -80 + Math.sin(time * 1.5 + Math.PI / 4) * 32);
    ctx.moveTo(0, -80);
    ctx.lineTo(70, -80 + Math.sin(time * 1.5 + Math.PI + jitter) * 32);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.lineTo(-50, 140 + swing * 40);
    ctx.moveTo(0, 40);
    ctx.lineTo(50, 140 - swing * 40);
    ctx.stroke();
  },
  /**
   * 绘制矢量大嘴巴头。
   * @param {WechatMiniprogram.CanvasContext} ctx - 画布上下文。
   * @param {number} mouth - mouth 值。
   * @param {number} visemeId - 口型编号。
   */
  drawVectorHead(ctx, mouth, visemeId) {
    const theme = this.themeResolved || resolveThemeFromRegistry(this.activeThemeId || defaultThemeId);
    const mouthTheme = theme.mouth;
    const headTheme = theme.head;
    const eyeTheme = theme.eye;
    const expression = this.getExpression();
    const nodOffset = Math.sin(Date.now() / 1000 * 1.6) * (expression.headNodAmp ?? 0) * 14;
    const headY = -150 - mouth * 8 + nodOffset;
    const headRadius = 48;

    const mouthWidthBase = 70 * mouthTheme.widthScale;
    const mouthScale = clamp(expression.mouthOpenScale ?? 1, 0.5, 2.5);
    const mouthHeightBase = (8 + mouth * 48) * mouthTheme.heightScale;
    const mouthHeight = mouthHeightBase * mouthScale;
    const roundedViseme = mouthTheme.roundedViseme;
    const rounded = Math.round(visemeId) === roundedViseme;
    const tensionFactor = clamp(1 - (expression.lipTension ?? 0) * 0.35, 0.5, 1.4);
    const widthFactor = (rounded ? 0.65 : 1) * tensionFactor;
    const mouthWidth = mouthWidthBase * widthFactor;

    ctx.setLineWidth(headTheme.lineWidth);
    ctx.setStrokeStyle(headTheme.stroke);
    ctx.setFillStyle(headTheme.fill);
    ctx.beginPath();
    ctx.arc(0, headY, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const eyeGap = eyeTheme.gap;
    const blinkBase = clamp(1 - Math.min(1, mouth * 1.4), 0, 1);
    const blinkAdjusted = clamp(blinkBase + (expression.eyeBlinkBias ?? 0) * 0.5, 0, 1);
    const eyeHeight = Math.max(eyeTheme.minHeight, 10 * (1 - blinkAdjusted));
    ctx.setLineWidth(eyeTheme.lineWidth);
    ctx.setStrokeStyle(eyeTheme.stroke);
    ctx.beginPath();
    ctx.moveTo(-eyeGap, headY - 12);
    ctx.lineTo(-eyeGap, headY - 12 + eyeHeight);
    ctx.moveTo(eyeGap, headY - 12);
    ctx.lineTo(eyeGap, headY - 12 + eyeHeight);
    ctx.stroke();

    const cornerCurve = clamp((mouthTheme.cornerCurveBase ?? 0) + (expression.cornerCurve ?? 0), -1.2, 1.2);
    const lipTopY = headY + 18 - cornerCurve * 10;
    const lipBottomY = lipTopY + mouthHeight + cornerCurve * 16;
    const controlOffset = mouthHeight * 0.7 * (1 + cornerCurve * 0.4);

    ctx.setLineWidth(mouthTheme.lineWidth);
    ctx.setStrokeStyle(mouthTheme.stroke);
    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipTopY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth, lipTopY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipBottomY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth, lipBottomY);
    ctx.stroke();

    ctx.setFillStyle(mouthTheme.innerFill || mouthTheme.fill);
    ctx.beginPath();
    ctx.moveTo(-mouthWidth + 3, lipTopY + 3);
    ctx.bezierCurveTo(-mouthWidth * 0.3, lipTopY + 3 - controlOffset * 0.8, mouthWidth * 0.3, lipTopY + 3 - controlOffset * 0.8, mouthWidth - 3, lipTopY + 3);
    ctx.lineTo(mouthWidth - 3, lipBottomY - 3);
    ctx.bezierCurveTo(mouthWidth * 0.3, lipBottomY - 3 + controlOffset * 0.8, -mouthWidth * 0.3, lipBottomY - 3 + controlOffset * 0.8, -mouthWidth + 3, lipBottomY - 3);
    ctx.closePath();
    ctx.fill();

    if (mouthHeight > 12 * mouthTheme.heightScale) {
      ctx.setFillStyle(mouthTheme.toothFill);
      const widthRatio = mouthWidthBase === 0 ? 1 : clamp(mouthWidth / mouthWidthBase, 0.6, 1.6);
      const estimatedCount = Math.max(1, Math.round(mouthTheme.toothCount * mouthTheme.toothScale * widthRatio));
      const toothCount = Math.max(1, estimatedCount);
      const toothWidth = (mouthWidth * 1.8) / toothCount / 2;
      const toothHeight = Math.min(12 * mouthTheme.heightScale, mouthHeight * 0.4);
      for (let i = 0; i < toothCount; i += 1) {
        const ratio = toothCount === 1 ? 0 : (i / (toothCount - 1)) * 2 - 1;
        const x = toothCount === 1 ? 0 : ratio * mouthWidth * 0.7;
        ctx.fillRect(x - toothWidth / 2, lipTopY + 2, toothWidth, toothHeight);
      }
    }

    if (rounded && mouthTheme.highlightWidth > 0) {
      ctx.setStrokeStyle(mouthTheme.highlightStroke);
      ctx.setLineWidth(mouthTheme.highlightWidth);
      ctx.beginPath();
      ctx.ellipse(0, (lipTopY + lipBottomY) / 2, mouthWidth * 0.7, mouthHeight * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  /**
   * 绘制 Sprite 头部，如无资源则回退至矢量模式。
   * @param {WechatMiniprogram.CanvasContext} ctx - 画布上下文。
   * @param {number} mouth - mouth 值。
   * @param {number} visemeId - 口型编号。
   */
  drawSpriteHead(ctx, mouth, visemeId) {
    const expression = this.getExpression();
    const nodOffset = Math.sin(Date.now() / 1000 * 1.6) * (expression.headNodAmp ?? 0) * 14;
    const key = Math.round(visemeId);
    const cached = this.spriteCache[key];
    if (cached) {
      const headY = -180 + nodOffset;
      const scale = 1 + mouth * 0.1 * clamp(expression.mouthOpenScale ?? 1, 0.5, 2.5);
      const width = cached.width * scale;
      const height = cached.height * scale;
      ctx.drawImage(cached.path, -width / 2, headY - height / 2, width, height);
      return;
    }
    if (!this.pendingSprites[key]) {
      this.pendingSprites[key] = true;
      const src = `${this.data.spriteBasePath}/v${key}.png`;
      wx.getImageInfo({
        src,
        success: (res) => {
          this.spriteCache[key] = { path: res.path, width: res.width, height: res.height };
          this.drawAvatar();
        },
        fail: () => {
          console.warn('未找到 Sprite 资源：', src);
        },
        complete: () => {
          this.pendingSprites[key] = false;
        },
      });
    }
    this.drawVectorHead(ctx, mouth, visemeId);
  },
  /**
   * 拉取服务端可用 provider。
   */
  fetchProviders() {
    const origin = this.getServerOrigin();
    wx.request({
      url: `${origin}/`,
      success: (res) => {
        const list = Array.isArray(res.data?.providers) ? res.data.providers : PROVIDER_LABELS;
        this.setData({ providers: list, providerIndex: 0 });
      },
      fail: () => {
        console.warn('获取 provider 列表失败');
      },
    });
  },
});
