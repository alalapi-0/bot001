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

const THEME_CLASS_MAP = {
  classic: 'theme-classic',
  bright: 'theme-bright',
  pastel: 'theme-pastel',
  noir: 'theme-noir',
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
 * @returns {string} 展示文本。
 */
function buildRoleMeta(role) {
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
}

/**
 * 根据主题标识返回小程序容器类名。
 * @param {string} theme - 主题 ID。
 * @returns {string} 类名。
 */
function resolveThemeClass(theme) {
  const key = typeof theme === 'string' && theme ? theme : 'classic';
  return THEME_CLASS_MAP[key] || THEME_CLASS_MAP.classic;
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
    roleMeta: buildRoleMeta(DEFAULT_ROLE),
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
      this.setData({ roleMeta: buildRoleMeta(this.activeRole) });
    }
    this.drawAvatar();
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
    const themeClass = resolveThemeClass(sanitized.theme);
    const renderModeIndex = this.getRenderModeIndex(sanitized.renderMode);
    this.setData({
      themeClass,
      renderModeIndex,
      roleDescription: sanitized.description || DEFAULT_ROLE.description,
      roleMeta: buildRoleMeta(sanitized),
    });
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
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
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
    ctx.setStrokeStyle('#1f2937');
    ctx.setLineWidth(6);

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
    const expression = this.getExpression();
    const nodOffset = Math.sin(Date.now() / 1000 * 1.6) * (expression.headNodAmp ?? 0) * 14;
    const headY = -150 - mouth * 8 + nodOffset;
    const headRadius = 48;
    const mouthWidthBase = 70;
    const mouthScale = clamp(expression.mouthOpenScale ?? 1, 0.5, 2.5);
    const mouthHeight = (8 + mouth * 48) * mouthScale;
    const rounded = Math.round(visemeId) === 9;
    const tensionFactor = clamp(1 - (expression.lipTension ?? 0) * 0.35, 0.6, 1.4);
    const widthFactor = (rounded ? 0.65 : 1) * tensionFactor;

    ctx.setLineWidth(5);
    ctx.setStrokeStyle('#111827');
    ctx.setFillStyle('#f9fafb');
    ctx.beginPath();
    ctx.arc(0, headY, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const eyeGap = 20;
    const blinkBase = clamp(1 - Math.min(1, mouth * 1.4), 0, 1);
    const blinkAdjusted = clamp(blinkBase + (expression.eyeBlinkBias ?? 0) * 0.5, 0, 1);
    const eyeHeight = Math.max(2, 10 * blinkAdjusted);
    ctx.setLineWidth(4);
    ctx.beginPath();
    ctx.moveTo(-eyeGap, headY - 12);
    ctx.lineTo(-eyeGap, headY - 12 + eyeHeight);
    ctx.moveTo(eyeGap, headY - 12);
    ctx.lineTo(eyeGap, headY - 12 + eyeHeight);
    ctx.stroke();

    const mouthWidth = mouthWidthBase * widthFactor;
    const cornerCurve = expression.cornerCurve ?? 0;
    const lipTopY = headY + 18 - cornerCurve * 10;
    const lipBottomY = lipTopY + mouthHeight + cornerCurve * 16;
    const controlOffset = mouthHeight * 0.7 * (1 + cornerCurve * 0.4);

    ctx.setLineWidth(6);
    ctx.setStrokeStyle('#ef4444');
    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipTopY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth, lipTopY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipBottomY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth, lipBottomY);
    ctx.stroke();

    ctx.setFillStyle('#7f1d1d');
    ctx.beginPath();
    ctx.moveTo(-mouthWidth + 3, lipTopY + 3);
    ctx.bezierCurveTo(-mouthWidth * 0.3, lipTopY + 3 - controlOffset * 0.8, mouthWidth * 0.3, lipTopY + 3 - controlOffset * 0.8, mouthWidth - 3, lipTopY + 3);
    ctx.lineTo(mouthWidth - 3, lipBottomY - 3);
    ctx.bezierCurveTo(mouthWidth * 0.3, lipBottomY - 3 + controlOffset * 0.8, -mouthWidth * 0.3, lipBottomY - 3 + controlOffset * 0.8, -mouthWidth + 3, lipBottomY - 3);
    ctx.closePath();
    ctx.fill();

    if (mouthHeight > 12) {
      ctx.setFillStyle('#fefce8');
      const toothCount = Math.min(6, Math.max(3, Math.floor(mouthWidth / 14)));
      const toothWidth = (mouthWidth * 1.8) / toothCount / 2;
      const toothHeight = Math.min(12, mouthHeight * 0.4);
      for (let i = 0; i < toothCount; i += 1) {
        const ratio = (i / (toothCount - 1)) * 2 - 1;
        const x = ratio * mouthWidth * 0.7;
        ctx.fillRect(x - toothWidth / 2, lipTopY + 2, toothWidth, toothHeight);
      }
    }

    if (rounded) {
      ctx.setStrokeStyle('#fca5a5');
      ctx.setLineWidth(2);
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
