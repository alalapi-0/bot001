import { PARAM_DEFINITIONS, TunerModel, createDownloadBlob } from './tuner.model.js';
import { BigMouthAvatar } from './avatar.js';
import { AutoGainProcessor, DEFAULT_AUTO_GAIN_CONFIG } from './auto-gain.js';

const statusEl = /** @type {HTMLDivElement} */ (document.getElementById('status'));
const paramListEl = document.getElementById('param-list');
const jsonTextarea = /** @type {HTMLTextAreaElement} */ (document.getElementById('preset-json'));
const exportBtn = /** @type {HTMLButtonElement} */ (document.getElementById('export-btn'));
const importBtn = /** @type {HTMLButtonElement} */ (document.getElementById('import-btn'));
const copyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('copy-btn'));
const downloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById('download-btn'));
const avatarCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('avatar-preview'));
const curveCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('curve-canvas'));
const autoGainCheckbox = /** @type {HTMLInputElement | null} */ (document.getElementById('auto-gain-toggle'));

const model = new TunerModel();

/** @type {Map<string, { slider: HTMLInputElement; number: HTMLInputElement }>} */
const inputRefs = new Map();

const AUTO_GAIN_STORAGE_KEY = 'stickbot:auto-gain';

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const hostStickBot = document.querySelector('stick-bot');
let localAvatar = null;
let previewLoop = null;

const ensureAvatar = () => {
  if (!avatarCanvas) return null;
  if (localAvatar) return localAvatar;
  localAvatar = new BigMouthAvatar(avatarCanvas, { mouthSmoothing: 0.18 });
  localAvatar.start();
  return localAvatar;
};

const sampleBaseWave = (timeSeconds) => {
  const phrases = [
    { start: 0, duration: 0.7, frequency: 1.1, strength: 1 },
    { start: 0.65, duration: 0.6, frequency: 1.6, strength: 0.75 },
    { start: 1.35, duration: 0.8, frequency: 1.2, strength: 0.9 },
    { start: 2.1, duration: 0.9, frequency: 1.8, strength: 0.95 },
  ];
  let value = 0;
  for (const phrase of phrases) {
    if (timeSeconds < phrase.start || timeSeconds > phrase.start + phrase.duration) {
      continue;
    }
    const local = (timeSeconds - phrase.start) / phrase.duration;
    const envelope = Math.sin(Math.PI * clamp01(local));
    const wave = Math.abs(Math.sin(Math.PI * (timeSeconds - phrase.start) * phrase.frequency));
    value = Math.max(value, envelope * wave * phrase.strength);
  }
  return value;
};

const applyExpressionModifiers = (base, params) => {
  let value = base * (params.mouthOpenScale ?? 1);
  value += (params.cornerCurve ?? 0) * 0.05;
  value *= 1 + (params.lipTension ?? 0) * 0.15;
  if ((params.eyeBlinkBias ?? 0) > 0.3) {
    value *= 0.95 - Math.min(params.eyeBlinkBias, 0.6) * 0.2;
  }
  if (params.roundLipCompress ?? 0) {
    const compress = clamp01(params.roundLipCompress);
    const exponent = 1 + compress * 1.6;
    value = Math.pow(clamp01(value), exponent);
  }
  return clamp01(value);
};

const generateTimeline = (params) => {
  const tickHz = Math.max(10, Math.min(120, Math.round(params.tickHz ?? 60)));
  const alpha = Math.min(0.98, Math.max(0.02, params.emaAlpha ?? 0.24));
  const duration = 3.6; // seconds
  const step = 1 / tickHz;
  const raw = [];
  const smooth = [];
  let ema = 0;
  for (let t = 0, i = 0; t <= duration + 1e-6; t += step, i += 1) {
    const base = sampleBaseWave(t % duration);
    const modified = applyExpressionModifiers(base, params);
    const viseme = Math.round(clamp01(modified) * 9);
    raw.push({ t, v: modified, viseme });
    if (i === 0) {
      ema = modified;
    } else {
      ema = ema + alpha * (modified - ema);
    }
    smooth.push({ t, v: ema, viseme: Math.round(clamp01(ema) * 9) });
  }
  return { raw, smooth, duration, tickHz };
};

class LocalTimelinePreview {
  constructor(avatar, canvas, autoGainEnabled = true) {
    this.avatar = avatar;
    this.canvas = canvas;
    this.timeline = generateTimeline(model.getState());
    this.startTime = performance.now();
    this.rafId = null;
    this.drawCurves();
    this.loop = this.loop.bind(this);
    this.autoGainEnabled = Boolean(autoGainEnabled);
    this.autoGain = this.autoGainEnabled
      ? new AutoGainProcessor(this.timeline.smooth, DEFAULT_AUTO_GAIN_CONFIG)
      : null;
    this.start();
  }

  setParams(params) {
    this.timeline = generateTimeline(params);
    this.drawCurves();
    if (this.autoGain) {
      this.autoGain.setTimeline(this.timeline.smooth);
    } else if (this.autoGainEnabled) {
      this.autoGain = new AutoGainProcessor(this.timeline.smooth, DEFAULT_AUTO_GAIN_CONFIG);
    }
  }

  start() {
    if (this.rafId !== null) return;
    this.startTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  loop(timestamp) {
    if (!this.avatar || !this.timeline) {
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }
    const elapsed = (timestamp - this.startTime) / 1000;
    const duration = this.timeline.duration || 1;
    const tickHz = this.timeline.tickHz || 60;
    const time = elapsed % duration;
    const index = Math.min(this.timeline.smooth.length - 1, Math.floor(time * tickHz));
    const frame = this.timeline.smooth[index];
    if (frame) {
      let value = frame.v;
      if (this.autoGain) {
        value = this.autoGain.apply(time, value).value;
      }
      this.avatar.setMouthFrame({ value, visemeId: frame.viseme ?? 0, phoneme: 'preview' });
    }
    this.rafId = requestAnimationFrame(this.loop);
  }

  drawCurves() {
    if (!this.canvas || !this.timeline) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);

    const padding = 20;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;

    const drawCurve = (points, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach((point, idx) => {
        const x = padding + (point.t / this.timeline.duration) * innerWidth;
        const y = padding + (1 - point.v) * innerHeight;
        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    };

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (let i = 0; i <= 4; i += 1) {
      const y = padding + (innerHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + innerWidth, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    drawCurve(this.timeline.raw, '#6366f1');
    drawCurve(this.timeline.smooth, '#f97316');
  }

  setAutoGain(enabled) {
    this.autoGainEnabled = Boolean(enabled);
    if (this.autoGainEnabled) {
      if (!this.autoGain) {
        this.autoGain = new AutoGainProcessor(this.timeline.smooth, DEFAULT_AUTO_GAIN_CONFIG);
      } else {
        this.autoGain.reset();
      }
    } else {
      this.autoGain = null;
    }
  }
}

const initParamInputs = () => {
  if (!paramListEl) return;
  paramListEl.innerHTML = '';
  for (const definition of PARAM_DEFINITIONS) {
    const item = document.createElement('div');
    item.className = 'param-item';

    const label = document.createElement('label');
    label.textContent = `${definition.label}`;
    label.title = definition.description;
    item.appendChild(label);

    const controls = document.createElement('div');
    controls.className = 'param-controls';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(definition.min);
    slider.max = String(definition.max);
    slider.step = String(definition.step);
    slider.value = String(model.getState()[definition.key]);
    controls.appendChild(slider);

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = String(definition.min);
    numberInput.max = String(definition.max);
    numberInput.step = String(definition.step);
    numberInput.value = String(model.getState()[definition.key]);
    controls.appendChild(numberInput);

    item.appendChild(controls);
    paramListEl.appendChild(item);

    slider.addEventListener('input', () => {
      numberInput.value = slider.value;
      model.update(definition.key, slider.value);
    });
    numberInput.addEventListener('change', () => {
      slider.value = numberInput.value;
      model.update(definition.key, numberInput.value);
    });
    inputRefs.set(definition.key, { slider, number: numberInput });
  }
};

const updateInputs = (state) => {
  for (const [key, refs] of inputRefs.entries()) {
    const value = state[key];
    if (refs.slider.value !== String(value)) {
      refs.slider.value = String(value);
    }
    if (refs.number.value !== String(value)) {
      refs.number.value = String(value);
    }
  }
};

const applyPreset = (preset) => {
  if (hostStickBot && typeof hostStickBot.setExpressionOverride === 'function') {
    hostStickBot.setExpressionOverride(preset);
  }
  if (!previewLoop) {
    const avatar = ensureAvatar();
    if (avatar) {
      const autoGainEnabled = autoGainCheckbox ? autoGainCheckbox.checked : true;
      previewLoop = new LocalTimelinePreview(avatar, curveCanvas, autoGainEnabled);
    }
  }
  if (previewLoop) {
    previewLoop.setParams(preset);
    if (autoGainCheckbox) {
      previewLoop.setAutoGain(autoGainCheckbox.checked);
    }
  }
};

const setStatus = (message) => {
  if (statusEl) {
    statusEl.textContent = message;
  }
};

exportBtn?.addEventListener('click', () => {
  const preset = model.toJSON();
  const json = JSON.stringify(preset, null, 2);
  jsonTextarea.value = json;
  setStatus('已生成 JSON，可复制或下载。');
});

copyBtn?.addEventListener('click', async () => {
  const text = jsonTextarea.value.trim() || JSON.stringify(model.toJSON(), null, 2);
  try {
    if (navigator.clipboard && text) {
      await navigator.clipboard.writeText(text);
      setStatus('JSON 已复制到剪贴板。');
    } else {
      setStatus('浏览器不支持剪贴板 API，请手动复制。');
    }
  } catch (error) {
    console.warn('[tuner] 复制失败', error);
    setStatus('复制失败，请检查浏览器权限。');
  }
});

downloadBtn?.addEventListener('click', () => {
  const text = jsonTextarea.value.trim() || JSON.stringify(model.toJSON(), null, 2);
  const blob = createDownloadBlob(text);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'stickbot-tuner.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus('已下载 JSON 文件。');
});

importBtn?.addEventListener('click', () => {
  const text = jsonTextarea.value.trim();
  if (!text) {
    setStatus('请先粘贴 JSON 文本。');
    return;
  }
  try {
    const parsed = JSON.parse(text);
    model.replaceAll(parsed);
    setStatus('已从 JSON 导入并更新参数。');
  } catch (error) {
    console.error('[tuner] 导入失败：', error);
    setStatus('导入失败，请确认 JSON 格式正确。');
  }
});

model.subscribe((state) => {
  updateInputs(state);
  applyPreset(state);
});

const applyAutoGainPreference = (enabled) => {
  if (previewLoop) {
    previewLoop.setAutoGain(enabled);
  }
  try {
    window.localStorage?.setItem(
      AUTO_GAIN_STORAGE_KEY,
      JSON.stringify({ enabled, config: DEFAULT_AUTO_GAIN_CONFIG }),
    );
  } catch (error) {
    console.warn('[tuner] 保存自动增益偏好失败', error);
  }
};

const initAutoGain = () => {
  let enabled = true;
  try {
    const raw = window.localStorage?.getItem(AUTO_GAIN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.enabled === 'boolean') {
        enabled = parsed.enabled;
      }
    }
  } catch (error) {
    console.warn('[tuner] 读取自动增益偏好失败', error);
  }
  if (autoGainCheckbox) {
    autoGainCheckbox.checked = enabled;
    autoGainCheckbox.addEventListener('change', () => {
      applyAutoGainPreference(autoGainCheckbox.checked);
    });
  }
  return enabled;
};

initParamInputs();
const initialAutoGain = initAutoGain();
applyPreset(model.getState());
setStatus('参数已就绪，调整后自动保存到浏览器。');
if (previewLoop) {
  previewLoop.setAutoGain(initialAutoGain);
}

