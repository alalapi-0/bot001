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
 * BigMouthAvatar 负责根据 mouth 值绘制火柴人，支持矢量与 Sprite 模式。
 */
export class BigMouthAvatar {
  /**
   * @param {HTMLCanvasElement} canvas - 渲染目标画布。
   * @param {Partial<AvatarConfig>} [config] - 覆盖默认配置。
   */
  constructor(canvas, config = {}) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = canvas.getContext('2d');
    /** @type {AvatarConfig} */
    this.config = { ...DEFAULT_CONFIG, ...config };

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

    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 6;

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
    const nodOffset = Math.sin(performance.now() / 1000 * 1.6) * this.expression.headNodAmp * 18;
    const headY = -150 - this.currentMouth * 8 + nodOffset;
    const headRadius = 48;
    const mouthWidthBase = 70;
    const mouthScale = clamp(this.expression.mouthOpenScale, 0.5, 2.5);
    const mouthHeight = (8 + this.currentMouth * 48) * mouthScale;
    const visemeRounded = Math.round(this.currentViseme);
    const roundedLip = visemeRounded === 9;
    const tensionFactor = clamp(1 - this.expression.lipTension * 0.35, 0.6, 1.4);
    const widthFactor = (roundedLip ? 0.65 : 1) * tensionFactor;

    // 头部轮廓
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#f9fafb';
    ctx.beginPath();
    ctx.arc(0, headY, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 眼睛
    const eyeGap = 20;
    const blinkBase = clamp(1 - this.blinkProgress, 0, 1);
    const blinkAdjusted = clamp(blinkBase + this.expression.eyeBlinkBias * 0.5, 0, 1);
    const eyeHeight = Math.max(2, 10 * blinkAdjusted);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-eyeGap, headY - 12);
    ctx.lineTo(-eyeGap, headY - 12 + eyeHeight);
    ctx.moveTo(eyeGap, headY - 12);
    ctx.lineTo(eyeGap, headY - 12 + eyeHeight);
    ctx.stroke();

    // 嘴唇：上唇和下唇使用贝塞尔曲线
    const mouthWidth = mouthWidthBase * widthFactor;
    const lipTopY = headY + 18 - this.expression.cornerCurve * 10;
    const lipBottomY = lipTopY + mouthHeight + this.expression.cornerCurve * 16;
    const controlOffset = mouthHeight * 0.7 * (1 + this.expression.cornerCurve * 0.4);

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ef4444';

    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipTopY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth, lipTopY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipBottomY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth, lipBottomY);
    ctx.stroke();

    // 口腔填充
    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath();
    ctx.moveTo(-mouthWidth + 3, lipTopY + 3);
    ctx.bezierCurveTo(-mouthWidth * 0.3, lipTopY + 3 - controlOffset * 0.8, mouthWidth * 0.3, lipTopY + 3 - controlOffset * 0.8, mouthWidth - 3, lipTopY + 3);
    ctx.lineTo(mouthWidth - 3, lipBottomY - 3);
    ctx.bezierCurveTo(mouthWidth * 0.3, lipBottomY - 3 + controlOffset * 0.8, -mouthWidth * 0.3, lipBottomY - 3 + controlOffset * 0.8, -mouthWidth + 3, lipBottomY - 3);
    ctx.closePath();
    ctx.fill();

    // 牙齿
    if (mouthHeight > 12) {
      ctx.fillStyle = '#fefce8';
      const toothCount = Math.min(6, Math.max(3, Math.floor(mouthWidth / 14)));
      const toothWidth = (mouthWidth * 1.8) / toothCount / 2;
      const toothHeight = Math.min(12, mouthHeight * 0.4);
      for (let i = 0; i < toothCount; i += 1) {
        const ratio = (i / (toothCount - 1)) * 2 - 1;
        const x = ratio * mouthWidth * 0.7;
        ctx.fillRect(x - toothWidth / 2, lipTopY + 2, toothWidth, toothHeight);
      }
    }

    // 圆唇时增加高光
    if (roundedLip) {
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 2;
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

