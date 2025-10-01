const STORAGE_KEY = 'stickbot:tuner:preset';

/**
 * 参数元数据，用于生成 UI 与限定取值范围。
 */
export const PARAM_DEFINITIONS = [
  {
    key: 'mouthOpenScale',
    label: 'mouthOpenScale',
    min: 0.4,
    max: 2,
    step: 0.01,
    defaultValue: 1,
    description: '嘴巴张开倍数，用于放大/缩小整体口型幅度。',
  },
  {
    key: 'lipTension',
    label: 'lipTension',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.2,
    description: '嘴唇收紧程度，越大越紧绷。',
  },
  {
    key: 'cornerCurve',
    label: 'cornerCurve',
    min: -1,
    max: 1,
    step: 0.01,
    defaultValue: 0.1,
    description: '嘴角弯曲程度，正值上扬，负值下压。',
  },
  {
    key: 'eyeBlinkBias',
    label: 'eyeBlinkBias',
    min: -0.6,
    max: 0.6,
    step: 0.01,
    defaultValue: 0,
    description: '眨眼偏置，影响 blink 节奏。',
  },
  {
    key: 'headNodAmp',
    label: 'headNodAmp',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.15,
    description: '点头幅度，越大越明显。',
  },
  {
    key: 'swayAmp',
    label: 'swayAmp',
    min: 0,
    max: 0.8,
    step: 0.01,
    defaultValue: 0.18,
    description: '身体左右摆动幅度。',
  },
  {
    key: 'emaAlpha',
    label: 'emaAlpha',
    min: 0.02,
    max: 0.6,
    step: 0.01,
    defaultValue: 0.24,
    description: '口型平滑系数（指数滑动平均 alpha）。',
  },
  {
    key: 'tickHz',
    label: 'tickHz',
    min: 10,
    max: 120,
    step: 1,
    defaultValue: 60,
    description: '时间轴刷新频率（Hz）。',
  },
  {
    key: 'roundLipCompress',
    label: 'roundLipCompress',
    min: 0,
    max: 0.9,
    step: 0.01,
    defaultValue: 0.32,
    description: '圆唇收紧强度，用于压缩高口型。',
  },
];

const DEFAULT_STATE = PARAM_DEFINITIONS.reduce((acc, item) => {
  acc[item.key] = item.defaultValue;
  return acc;
}, {});

const clampValue = (value, definition) => {
  if (Number.isNaN(value)) {
    return definition.defaultValue;
  }
  const min = definition.min;
  const max = definition.max;
  const clamped = Math.min(max, Math.max(min, value));
  const fixed = Math.round(clamped / definition.step) * definition.step;
  return Number.parseFloat(fixed.toFixed(4));
};

const safeParse = (text) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

/**
 * 管理调参状态与本地持久化。
 */
export class TunerModel {
  constructor(storage = window.localStorage) {
    this.storage = storage;
    this.subscribers = new Set();
    this.state = { ...DEFAULT_STATE };
    this.loadFromStorage();
  }

  loadFromStorage() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = safeParse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      this.state = this.normalizeState(parsed);
    } catch (error) {
      console.warn('[tuner] 读取本地参数失败，将使用默认值。', error);
    }
  }

  saveToStorage() {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.warn('[tuner] 保存参数到本地失败。', error);
    }
  }

  normalizeState(patch = {}) {
    const nextState = { ...DEFAULT_STATE };
    for (const def of PARAM_DEFINITIONS) {
      const value = Number.parseFloat(patch[def.key]);
      nextState[def.key] = clampValue(value, def);
    }
    return nextState;
  }

  getState() {
    return { ...this.state };
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.getState());
    return () => this.subscribers.delete(callback);
  }

  notify() {
    const snapshot = this.getState();
    for (const listener of this.subscribers) {
      listener(snapshot);
    }
  }

  update(key, rawValue) {
    const definition = PARAM_DEFINITIONS.find((item) => item.key === key);
    if (!definition) return;
    const numericValue = Number.parseFloat(rawValue);
    const next = clampValue(numericValue, definition);
    if (this.state[key] === next) return;
    this.state = { ...this.state, [key]: next };
    this.saveToStorage();
    this.notify();
  }

  replaceAll(preset) {
    this.state = this.normalizeState(preset);
    this.saveToStorage();
    this.notify();
  }

  toJSON() {
    return this.getState();
  }
}

export const createDownloadBlob = (text) => {
  return new Blob([text], { type: 'application/json' });
};

