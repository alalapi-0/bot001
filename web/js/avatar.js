/**
 * @module avatar
 * @description 绘制 stickbot 火柴人，头部采用“大嘴巴”造型，可在矢量与 Sprite 两种模式之间切换。
 */

/**
 * @typedef {Object} AvatarConfig
 * @property {[number, number]} blinkIntervalRange - 眨眼间隔范围（秒）。
 * @property {number} blinkDuration - 单次眨眼时长（秒）。
 * @property {number} limbSwingAmplitude - 四肢摆动幅度（弧度）。
 * @property {number} limbSwingSpeed - 四肢摆动速度倍数。
 * @property {number} mouthSmoothing - mouth 数值平滑系数，0-1 越大越平滑。
 * @property {string} spriteBasePath - Sprite 模式资源根路径，默认 `./assets/mouth`。
 * @property {number} spriteMaxViseme - 预加载 Sprite 的最大口型编号。
 */

/**
 * 默认配置。
 * @type {AvatarConfig}
 */
export const DEFAULT_CONFIG = {
  blinkIntervalRange: [2.4, 5.2],
  blinkDuration: 0.18,
  limbSwingAmplitude: 0.22,
  limbSwingSpeed: 1.5,
  mouthSmoothing: 0.2,
  spriteBasePath: './assets/mouth',
  spriteMaxViseme: 12,
};

/**
 * @typedef {Object} AvatarTheme
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [bg]
 * @property {string} [stroke]
 * @property {string} [fill]
 * @property {number} [lineWidth]
 * @property {{ stroke?: string, lineWidth?: number }} [body]
 * @property {{ stroke?: string, fill?: string, lineWidth?: number }} [head]
 * @property {{ stroke?: string, lineWidth?: number, gap?: number, minHeight?: number }} [eye]
 * @property {{ stroke?: string, lineWidth?: number, fill?: string, innerFill?: string, toothFill?: string, toothCount?: number, toothScale?: number, widthScale?: number, heightScale?: number, cornerCurveBase?: number, highlightStroke?: string, highlightWidth?: number, roundedViseme?: number }} [mouth]
 */

/**
 * @typedef {Object} AvatarThemeResolved
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} bg
 * @property {{ stroke: string, lineWidth: number }} body
 * @property {{ stroke: string, fill: string, lineWidth: number }} head
 * @property {{ stroke: string, lineWidth: number, gap: number, minHeight: number }} eye
 * @property {{ stroke: string, lineWidth: number, fill: string, innerFill: string, toothFill: string, toothCount: number, toothScale: number, widthScale: number, heightScale: number, cornerCurveBase: number, highlightStroke: string, highlightWidth: number, roundedViseme: number }} mouth
 */

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

/** 默认主题。 */
export const DEFAULT_THEME = BASE_THEME;

const resolveTheme = (theme) => {
  if (!theme) {
    return JSON.parse(JSON.stringify(BASE_THEME));
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
  const toothScale = Math.min(2.2, Math.max(0.2, parseNumber(theme.mouth?.toothScale, BASE_THEME.mouth.toothScale)));
  const widthScale = Math.min(2.2, Math.max(0.4, parseNumber(theme.mouth?.widthScale, BASE_THEME.mouth.widthScale)));
  const heightScale = Math.min(2.2, Math.max(0.4, parseNumber(theme.mouth?.heightScale, BASE_THEME.mouth.heightScale)));
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

/**
 * 对数值进行夹紧。
 * @param {number} value - 原始数值。
 * @param {number} min - 最小值。
 * @param {number} max - 最大值。
 * @returns {number} 夹紧后的数值。
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * 解析数值，若非法则返回回退值。
 * @param {unknown} candidate - 原始输入。
 * @param {number} fallback - 回退值。
 * @returns {number} 数字结果。
 */
const pickNumber = (candidate, fallback) => {
  const num = Number(candidate);
  return Number.isFinite(num) ? num : fallback;
};

/**
 * 随机生成下一次眨眼的时间戳。
 * @param {[number, number]} range - 眨眼间隔范围。
 * @returns {number} 下一次眨眼的绝对时间（秒）。
 */
const randomBlinkTime = (range) => {
  const [min, max] = range;
  const now = performance.now() / 1000;
  const interval = min + Math.random() * (max - min);
  return now + interval;
};

/**
 * @typedef {'vector' | 'sprite'} RenderMode
 */

/**
 * @typedef {Partial<AvatarConfig> & { theme?: AvatarTheme }} AvatarInitOptions
 */

/**
 * BigMouthAvatar 负责根据 mouth 值绘制火柴人，支持矢量与 Sprite 模式。
 */
export class BigMouthAvatar {
  /**
   * @param {HTMLCanvasElement} canvas - 渲染目标画布。
   * @param {AvatarInitOptions} [options] - 覆盖默认配置与主题。
   */
  constructor(canvas, options = {}) {
    const { theme, ...configOverrides } = options;
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = canvas.getContext('2d');
    /** @type {AvatarConfig} */
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    /** @type {AvatarThemeResolved} */
    this.theme = resolveTheme(theme);

    /** @type {number} */
    this.currentMouth = 0.1;
    /** @type {number} */
    this.targetMouth = 0.1;
    /** @type {number} */
    this.currentViseme = 0;
    /** @type {number} */
    this.targetViseme = 0;
    /** @type {string} */
    this.currentPhoneme = 'idle';

    /** @type {number|null} */
    this.rafId = null;
    /** @type {number} */
    this.lastTimestamp = 0;
    /** @type {number} */
    this.nextBlinkTime = randomBlinkTime(this.config.blinkIntervalRange);
    /** @type {number} */
    this.blinkProgress = 0;

    /** @type {RenderMode} */
    this.renderMode = 'vector';
    /** @type {HTMLImageElement[]} */
    this.spriteFrames = [];
    /** @type {boolean} */
    this.spriteLoaded = false;

    /** @type {{ mouthOpenScale: number, lipTension: number, cornerCurve: number, eyeBlinkBias: number, headNodAmp: number, swayAmp: number }} */
    this.expression = {
      mouthOpenScale: 1,
      lipTension: 0,
      cornerCurve: 0,
      eyeBlinkBias: 0,
      headNodAmp: 0.2,
      swayAmp: 0.2,
    };
  }

  /**
   * 启动动画循环。
   */
  start() {
    if (this.rafId !== null) return;
    const loop = (timestamp) => {
      this.update(timestamp);
      this.draw();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * 停止动画循环。
   */
  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 更新目标 mouth 帧。
   * @param {{ value: number, visemeId: number, phoneme?: string }} frame - mouth 帧数据。
   */
  setMouthFrame(frame) {
    this.targetMouth = Math.min(1, Math.max(0, frame.value));
    this.targetViseme = frame.visemeId ?? 0;
    this.currentPhoneme = frame.phoneme || 'unknown';
  }

  /**
   * 手动切换渲染模式。当 Sprite 模式未成功加载资源时自动回退。
   * @param {RenderMode} mode - 目标渲染模式。
   * @returns {Promise<boolean>} 是否切换成功。
   */
  async setRenderMode(mode) {
    if (mode === 'sprite') {
      const ok = await this.ensureSprites();
      if (!ok) {
        this.renderMode = 'vector';
        return false;
      }
    }
    this.renderMode = mode;
    return true;
  }

  /**
   * 自定义 Sprite 资源目录。
   * @param {{ basePath?: string, maxViseme?: number }} options - Sprite 配置。
   */
  configureSprite(options) {
    if (options.basePath) {
      this.config.spriteBasePath = options.basePath;
      this.spriteLoaded = false;
      this.spriteFrames = [];
    }
    if (options.maxViseme) {
      this.config.spriteMaxViseme = options.maxViseme;
      this.spriteLoaded = false;
      this.spriteFrames = [];
    }
  }

  /**
   * 确保 Sprite 资源已加载。若目录为空将返回 false。
   * @returns {Promise<boolean>} 是否存在可用 Sprite。
   */
  async ensureSprites() {
    if (this.spriteLoaded) {
      return this.spriteFrames.length > 0;
    }
    this.spriteFrames = [];
    for (let i = 0; i <= this.config.spriteMaxViseme; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- 顺序加载便于提前中断
      const image = await this.loadSpriteImage(`${this.config.spriteBasePath}/v${i}.png`);
      if (image) {
        this.spriteFrames[i] = image;
      } else if (i === 0) {
        break;
      }
    }
    this.spriteLoaded = true;
    return this.spriteFrames.length > 0;
  }

  /**
   * 加载单张 Sprite。若资源不存在会返回 null。
   * @param {string} url - 图片路径。
   * @returns {Promise<HTMLImageElement|null>} 加载结果。
   */
  loadSpriteImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /**
   * 注入表情覆盖参数，控制嘴角、眨眼等细节。
   * @param {Partial<{ mouthOpenScale: number, lipTension: number, cornerCurve: number, eyeBlinkBias: number, headNodAmp: number, swayAmp: number }>} preset - 表情预设。
   */
  setExpressionOverride(preset = {}) {
    this.expression = {
      mouthOpenScale: clamp(pickNumber(preset.mouthOpenScale, this.expression.mouthOpenScale), 0.5, 2.5),
      lipTension: clamp(pickNumber(preset.lipTension, this.expression.lipTension), -1, 1),
      cornerCurve: clamp(pickNumber(preset.cornerCurve, this.expression.cornerCurve), -1, 1),
      eyeBlinkBias: clamp(pickNumber(preset.eyeBlinkBias, this.expression.eyeBlinkBias), -0.9, 0.9),
      headNodAmp: clamp(pickNumber(preset.headNodAmp, this.expression.headNodAmp), 0, 1.2),
      swayAmp: clamp(pickNumber(preset.swayAmp, this.expression.swayAmp), 0, 1),
    };
  }

  /**
   * 应用主题颜色与嘴部样式。
   * @param {AvatarTheme} theme - 主题配置。
   */
  setTheme(theme) {
    this.theme = resolveTheme(theme);
    this.draw();
  }

  /**
   * 动画更新：mouth 平滑、眨眼节奏与肢体摇摆。
   * @param {number} timestamp - RAF 时间戳（毫秒）。
   */
  update(timestamp) {
    if (!this.lastTimestamp) {
      this.lastTimestamp = timestamp;
    }
    const delta = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;

    const smoothing = this.config.mouthSmoothing;
    const blendFactor = 1 - Math.pow(1 - smoothing, delta * 60);
    this.currentMouth += (this.targetMouth - this.currentMouth) * blendFactor;
    this.currentViseme += (this.targetViseme - this.currentViseme) * blendFactor;

    const now = timestamp / 1000;
    if (now >= this.nextBlinkTime) {
      this.blinkProgress = Math.min(1, this.blinkProgress + delta / (this.config.blinkDuration / 2));
      if (this.blinkProgress >= 1) {
        this.nextBlinkTime = now + 0.12;
      }
    } else if (this.blinkProgress > 0) {
      this.blinkProgress = Math.max(0, this.blinkProgress - delta / (this.config.blinkDuration / 2));
      if (this.blinkProgress === 0) {
        this.nextBlinkTime = randomBlinkTime(this.config.blinkIntervalRange);
      }
    }
  }

  /**
   * 根据当前渲染模式绘制画面。
   */
  draw() {
    const ctx = this.ctx;
    if (!ctx) return;

    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2 + 40);
    ctx.lineCap = 'round';

    this.drawBody(ctx);

    if (this.renderMode === 'sprite' && this.spriteFrames.length > 0) {
      this.drawSpriteHead(ctx);
    } else {
      this.drawVectorHead(ctx);
    }

    ctx.restore();
  }

  /**
   * 绘制火柴人身体部分。
   * @param {CanvasRenderingContext2D} ctx - 画布上下文。
   */
  drawBody(ctx) {
    const time = performance.now() / 1000;
    const swayFactor = clamp(1 + this.expression.swayAmp * 0.8, 0.5, 2);
    const swing = Math.sin(time * this.config.limbSwingSpeed * clamp(1 + this.expression.swayAmp * 0.3, 0.5, 2)) * this.config.limbSwingAmplitude * swayFactor;
    const jitter = (Math.random() - 0.5) * 0.06 * (0.2 + this.currentMouth) * clamp(1 + this.expression.headNodAmp * 0.6, 0.6, 1.8);

    const bodyTheme = this.theme.body;
    ctx.strokeStyle = bodyTheme.stroke;
    ctx.lineWidth = bodyTheme.lineWidth;

    // 躯干
    ctx.beginPath();
    ctx.moveTo(0, -120);
    ctx.lineTo(0, 40);
    ctx.stroke();

    // 手臂
    ctx.beginPath();
    ctx.moveTo(0, -80);
    ctx.lineTo(-70, -80 + Math.sin(time * this.config.limbSwingSpeed + Math.PI / 4) * 32);
    ctx.moveTo(0, -80);
    ctx.lineTo(70, -80 + Math.sin(time * this.config.limbSwingSpeed + Math.PI + jitter) * 32);
    ctx.stroke();

    // 腿部
    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.lineTo(-50, 140 + swing * 40);
    ctx.moveTo(0, 40);
    ctx.lineTo(50, 140 - swing * 40);
    ctx.stroke();
  }

  /**
   * 绘制矢量大嘴巴头部。
   * @param {CanvasRenderingContext2D} ctx - 画布上下文。
   */
  drawVectorHead(ctx) {
    ctx.save();
    const theme = this.theme;
    const mouthTheme = theme.mouth;
    const headTheme = theme.head;
    const eyeTheme = theme.eye;

    const nodOffset = Math.sin(performance.now() / 1000 * (1.2 + this.expression.headNodAmp * 2.4)) * (6 + this.expression.headNodAmp * 12);
    const headY = -150 - this.currentMouth * 8 + nodOffset;
    const headRadius = 48;
    const mouthWidthBase = 70 * mouthTheme.widthScale;
    const mouthScale = clamp(this.expression.mouthOpenScale, 0.5, 2.5);
    const mouthHeight = (8 + this.currentMouth * 48) * mouthTheme.heightScale * mouthScale;
    const visemeRounded = Math.round(this.currentViseme);
    const roundedLip = visemeRounded === mouthTheme.roundedViseme;
    const tensionFactor = clamp(1 - this.expression.lipTension * 0.35, 0.6, 1.4);
    const mouthWidth = mouthWidthBase * (roundedLip ? 0.65 : 1) * tensionFactor;

    ctx.lineWidth = headTheme.lineWidth;
    ctx.strokeStyle = headTheme.stroke;
    ctx.fillStyle = headTheme.fill;
    ctx.beginPath();
    ctx.arc(0, headY, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const blinkAmount = clamp(this.blinkProgress + this.expression.eyeBlinkBias * 0.4, 0, 1);
    const eyeGap = eyeTheme.gap;
    const eyeHeight = Math.max(eyeTheme.minHeight, 10 * (1 - blinkAmount));
    ctx.lineWidth = eyeTheme.lineWidth;
    ctx.strokeStyle = eyeTheme.stroke;
    ctx.beginPath();
    ctx.moveTo(-eyeGap, headY - 12);
    ctx.lineTo(-eyeGap, headY - 12 + eyeHeight);
    ctx.moveTo(eyeGap, headY - 12);
    ctx.lineTo(eyeGap, headY - 12 + eyeHeight);
    ctx.stroke();

    const cornerBias = clamp(mouthTheme.cornerCurveBase + this.expression.cornerCurve, -1.2, 1.2);
    const lipTopY = headY + 18 - cornerBias * 10;
    const lipBottomY = lipTopY + mouthHeight + cornerBias * 16;
    const controlOffset = mouthHeight * 0.7 * (1 + cornerBias * 0.4);

    ctx.lineWidth = mouthTheme.lineWidth;
    ctx.strokeStyle = mouthTheme.stroke;
    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipTopY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth, lipTopY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipBottomY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth, lipBottomY);
    ctx.stroke();

    ctx.fillStyle = mouthTheme.fill;
    ctx.beginPath();
    ctx.moveTo(-mouthWidth + 3, lipTopY + 3);
    ctx.bezierCurveTo(
      -mouthWidth * 0.3,
      lipTopY + 3 - controlOffset * 0.8,
      mouthWidth * 0.3,
      lipTopY + 3 - controlOffset * 0.8,
      mouthWidth - 3,
      lipTopY + 3,
    );
    ctx.lineTo(mouthWidth - 3, lipBottomY - 3);
    ctx.bezierCurveTo(
      mouthWidth * 0.3,
      lipBottomY - 3 + controlOffset * 0.8,
      -mouthWidth * 0.3,
      lipBottomY - 3 + controlOffset * 0.8,
      -mouthWidth + 3,
      lipBottomY - 3,
    );
    ctx.closePath();
    ctx.fill();

    if (mouthHeight > 12 * mouthTheme.heightScale) {
      ctx.fillStyle = mouthTheme.toothFill;
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

    if (roundedLip && mouthTheme.highlightWidth > 0) {
      ctx.strokeStyle = mouthTheme.highlightStroke;
      ctx.lineWidth = mouthTheme.highlightWidth;
      ctx.beginPath();
      ctx.ellipse(0, (lipTopY + lipBottomY) / 2, mouthWidth * 0.7, mouthHeight * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制 Sprite 头部，按 visemeId 选择贴图。
   * @param {CanvasRenderingContext2D} ctx - 画布上下文。
   */
  drawSpriteHead(ctx) {
    const nodOffset = Math.sin(performance.now() / 1000 * 1.6) * this.expression.headNodAmp * 18;
    const headY = -180 + nodOffset;
    const image = this.spriteFrames[Math.round(this.currentViseme)] || this.spriteFrames[0];
    if (!image) {
      this.drawVectorHead(ctx);
      return;
    }
    const scale = 1 + this.currentMouth * 0.1 * clamp(this.expression.mouthOpenScale, 0.5, 2.5);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, -width / 2, headY - height / 2, width, height);
  }
}

