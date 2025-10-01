/**
 * @module avatar.bigmouth
 * BigMouthAvatar（大嘴巴火柴人）在 Canvas 上绘制可动画的火柴人头像。
 * 该版本为 TypeScript 实现，提供向量与 Sprite 两种绘制模式，并支持
 * 通过 {@link BigMouthAvatar#setExpression} 注入情绪表情参数。
 */

import type { AvatarExpressionParams } from './emotion/expression-mapping.js';

/**
 * BigMouthAvatar 的配置项。
 */
export interface AvatarConfig {
  /** 眨眼间隔范围（秒）。 */
  blinkIntervalRange: [number, number];
  /** 单次眨眼时长（秒）。 */
  blinkDuration: number;
  /** 四肢摆动幅度（弧度）。 */
  limbSwingAmplitude: number;
  /** 四肢摆动速度倍数。 */
  limbSwingSpeed: number;
  /** mouth 数值平滑系数（0-1）。 */
  mouthSmoothing: number;
  /** Sprite 模式资源根路径。 */
  spriteBasePath: string;
  /** 预加载 Sprite 的最大口型编号。 */
  spriteMaxViseme: number;
}

/** 默认配置。 */
export const DEFAULT_CONFIG: AvatarConfig = {
  blinkIntervalRange: [2.4, 5.2],
  blinkDuration: 0.18,
  limbSwingAmplitude: 0.22,
  limbSwingSpeed: 1.5,
  mouthSmoothing: 0.2,
  spriteBasePath: './assets/mouth',
  spriteMaxViseme: 12,
};

/** 主题配置。 */
export interface AvatarTheme {
  /** 主题标识。 */
  id?: string;
  /** 展示名称。 */
  name?: string;
  /** 画布背景色。 */
  bg?: string;
  /** 顶层描边颜色。 */
  stroke?: string;
  /** 顶层填充色。 */
  fill?: string;
  /** 默认线宽。 */
  lineWidth?: number;
  /** 身体样式。 */
  body?: { stroke?: string; lineWidth?: number };
  /** 头部样式。 */
  head?: { stroke?: string; fill?: string; lineWidth?: number };
  /** 眼睛样式。 */
  eye?: { stroke?: string; lineWidth?: number; gap?: number; minHeight?: number };
  /** 嘴部样式。 */
  mouth?: {
    stroke?: string;
    lineWidth?: number;
    fill?: string;
    innerFill?: string;
    toothFill?: string;
    toothCount?: number;
    toothScale?: number;
    widthScale?: number;
    heightScale?: number;
    cornerCurveBase?: number;
    highlightStroke?: string;
    highlightWidth?: number;
    roundedViseme?: number;
  };
}

/** 归一化后的主题。 */
export interface AvatarThemeResolved {
  id?: string;
  name?: string;
  bg: string;
  body: { stroke: string; lineWidth: number };
  head: { stroke: string; fill: string; lineWidth: number };
  eye: { stroke: string; lineWidth: number; gap: number; minHeight: number };
  mouth: {
    stroke: string;
    lineWidth: number;
    fill: string;
    innerFill: string;
    toothFill: string;
    toothCount: number;
    toothScale: number;
    widthScale: number;
    heightScale: number;
    cornerCurveBase: number;
    highlightStroke: string;
    highlightWidth: number;
    roundedViseme: number;
  };
}

const parseNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value : fallback;

const BASE_THEME: AvatarThemeResolved = {
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
export const DEFAULT_THEME: AvatarThemeResolved = BASE_THEME;

const resolveTheme = (theme: AvatarTheme | undefined): AvatarThemeResolved => {
  if (!theme) {
    return { ...BASE_THEME, body: { ...BASE_THEME.body }, head: { ...BASE_THEME.head }, eye: { ...BASE_THEME.eye }, mouth: { ...BASE_THEME.mouth } };
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

/** 初始化参数。 */
export interface AvatarInitOptions extends Partial<AvatarConfig> {
  /** 主题配置。 */
  theme?: AvatarTheme;
}

/** 渲染模式。 */
export type RenderMode = 'vector' | 'sprite';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const nowSeconds = (): number => nowMs() / 1000;

const randomBlinkTime = (
  range: [number, number],
  bias = 0,
): number => {
  const [min, max] = range;
  const span = max - min;
  const biasedSpan = span * clamp(1 - bias * 0.6, 0.3, 1.6);
  const offset = Math.random() * biasedSpan;
  return nowSeconds() + min * clamp(1 - bias * 0.5, 0.4, 1.6) + offset;
};

const defaultExpressionState = (): AvatarExpressionParams => ({
  mouthOpenScale: 1,
  lipTension: 0,
  cornerCurve: 0,
  eyeBlinkBias: 0,
  headNodAmp: 0,
  swayAmp: 0,
});

let fallbackRafId = 0;
const fallbackTimers = new Map<number, ReturnType<typeof setTimeout>>();

const requestFrame = (callback: FrameRequestCallback): number => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  fallbackRafId += 1;
  const handle = fallbackRafId;
  const timer = setTimeout(() => {
    fallbackTimers.delete(handle);
    callback(nowMs());
  }, 16);
  fallbackTimers.set(handle, timer);
  return handle;
};

const cancelFrame = (handle: number): void => {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle);
    return;
  }
  const timer = fallbackTimers.get(handle);
  if (timer) {
    clearTimeout(timer);
    fallbackTimers.delete(handle);
  }
};

/**
 * mouth 帧数据。
 */
export interface MouthFrame {
  /** mouth 数值，0-1。 */
  value: number;
  /** 口型 viseme 标识。 */
  visemeId?: number;
  /** 可选音素描述。 */
  phoneme?: string;
}

/** Sprite 配置。 */
export interface SpriteOptions {
  /** 图片基路径。 */
  basePath?: string;
  /** 最大口型编号。 */
  maxViseme?: number;
}

/**
 * 可在 Canvas 上绘制火柴人大嘴巴头像的类。
 */
export class BigMouthAvatar {
  private readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D | null;

  private readonly config: AvatarConfig;

  private theme: AvatarThemeResolved;

  private currentMouth = 0.1;

  private targetMouth = 0.1;

  private currentViseme = 0;

  private targetViseme = 0;

  private currentPhoneme = 'idle';

  private rafId: number | null = null;

  private lastTimestamp = 0;

  private nextBlinkTime = 0;

  private blinkProgress = 0;

  private renderMode: RenderMode = 'vector';

  private spriteFrames: (HTMLImageElement | undefined)[] = [];

  private spriteLoaded = false;

  private expression: AvatarExpressionParams = defaultExpressionState();

  private headNodPhase = Math.random() * Math.PI * 2;

  private swayPhase = Math.random() * Math.PI * 2;

  /**
   * @param canvas - 目标画布。
   * @param options - 可选配置覆盖与主题。
   */
  constructor(canvas: HTMLCanvasElement, options: AvatarInitOptions = {}) {
    const { theme, ...configOverrides } = options;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    this.theme = resolveTheme(theme);
    this.nextBlinkTime = randomBlinkTime(this.config.blinkIntervalRange);
  }

  /** 启动动画循环。 */
  start(): void {
    if (this.rafId !== null) return;
    const loop = (timestamp: number) => {
      this.update(timestamp);
      this.draw();
      this.rafId = requestFrame(loop);
    };
    this.rafId = requestFrame(loop);
  }

  /** 停止动画循环。 */
  stop(): void {
    if (this.rafId !== null) {
      cancelFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 更新目标 mouth 帧。
   *
   * @param frame - mouth 帧数据。
   */
  setMouthFrame(frame: MouthFrame): void {
    this.targetMouth = clamp(frame.value, 0, 1);
    this.targetViseme = frame.visemeId ?? 0;
    this.currentPhoneme = frame.phoneme ?? 'unknown';
  }

  /**
   * 调整当前的表情参数。
   *
   * @param params - 需要覆盖的表情字段。
   */
  setExpression(params: Partial<AvatarExpressionParams> = {}): void {
    this.expression = {
      ...this.expression,
      ...params,
    };
    this.expression.mouthOpenScale = clamp(this.expression.mouthOpenScale, 0.5, 2.5);
    this.expression.lipTension = clamp(this.expression.lipTension, -1, 1);
    this.expression.cornerCurve = clamp(this.expression.cornerCurve, -1, 1);
    this.expression.eyeBlinkBias = clamp(this.expression.eyeBlinkBias, -1, 1);
    this.expression.headNodAmp = clamp(this.expression.headNodAmp, 0, 1.2);
    this.expression.swayAmp = clamp(this.expression.swayAmp, 0, 1);
  }

  /**
   * 应用新的主题样式。
   *
   * @param theme - 主题配置。
   */
  setTheme(theme: AvatarTheme): void {
    this.theme = resolveTheme(theme);
    this.draw();
  }

  /**
   * 手动切换渲染模式。
   *
   * @param mode - 目标渲染模式。
   * @returns 是否切换成功。
   */
  async setRenderMode(mode: RenderMode): Promise<boolean> {
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
   * 自定义 Sprite 资源目录与数量。
   */
  configureSprite(options: SpriteOptions): void {
    if (options.basePath) {
      this.config.spriteBasePath = options.basePath;
      this.spriteLoaded = false;
      this.spriteFrames = [];
    }
    if (typeof options.maxViseme === 'number') {
      this.config.spriteMaxViseme = options.maxViseme;
      this.spriteLoaded = false;
      this.spriteFrames = [];
    }
  }

  private async ensureSprites(): Promise<boolean> {
    if (this.spriteLoaded) {
      return this.spriteFrames.length > 0;
    }
    this.spriteFrames = [];
    for (let i = 0; i <= this.config.spriteMaxViseme; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- 顺序加载便于失败时提前中断
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

  private loadSpriteImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  private update(timestamp: number): void {
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
    const blinkBias = this.expression.eyeBlinkBias;
    if (now >= this.nextBlinkTime) {
      this.blinkProgress = Math.min(1, this.blinkProgress + delta / (this.config.blinkDuration / 2));
      if (this.blinkProgress >= 1) {
        this.nextBlinkTime = now + 0.12;
      }
    } else if (this.blinkProgress > 0) {
      this.blinkProgress = Math.max(0, this.blinkProgress - delta / (this.config.blinkDuration / 2));
      if (this.blinkProgress === 0) {
        const intervalRange: [number, number] = [
          this.config.blinkIntervalRange[0] * clamp(1 - blinkBias * 0.5, 0.4, 1.6),
          this.config.blinkIntervalRange[1] * clamp(1 - blinkBias * 0.5, 0.4, 1.6),
        ];
        this.nextBlinkTime = randomBlinkTime(intervalRange, blinkBias);
      }
    }

    this.headNodPhase += delta * (1.2 + this.expression.headNodAmp * 2.4);
    this.swayPhase += delta * (1 + this.expression.swayAmp * 1.5);
  }

  private draw(): void {
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

  private drawBody(ctx: CanvasRenderingContext2D): void {
    const time = nowSeconds();
    const swayExtra = this.expression.swayAmp * 0.4;
    const swing = Math.sin(time * this.config.limbSwingSpeed + this.swayPhase) * (this.config.limbSwingAmplitude + swayExtra);
    const jitter = (Math.random() - 0.5) * 0.06 * (0.2 + this.currentMouth);

    const bodyTheme = this.theme.body;
    ctx.strokeStyle = bodyTheme.stroke;
    ctx.lineWidth = bodyTheme.lineWidth;

    ctx.beginPath();
    ctx.moveTo(0, -120);
    ctx.lineTo(0, 40);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -80);
    ctx.lineTo(-70, -80 + Math.sin(time * this.config.limbSwingSpeed + Math.PI / 4) * 32);
    ctx.moveTo(0, -80);
    ctx.lineTo(70, -80 + Math.sin(time * this.config.limbSwingSpeed + Math.PI + jitter) * 32);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.lineTo(-50, 140 + swing * 40);
    ctx.moveTo(0, 40);
    ctx.lineTo(50, 140 - swing * 40);
    ctx.stroke();
  }

  private drawVectorHead(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    const theme = this.theme;
    const mouthTheme = theme.mouth;
    const headTheme = theme.head;
    const eyeTheme = theme.eye;

    const nodOffset = Math.sin(this.headNodPhase) * (6 + this.expression.headNodAmp * 12);
    const headY = -150 - this.currentMouth * 8 + nodOffset;
    const headRadius = 48;

    const mouthWidthBase = 70 * mouthTheme.widthScale;
    const mouthHeightBase = (8 + this.currentMouth * 48) * mouthTheme.heightScale;
    const mouthHeight = mouthHeightBase * this.expression.mouthOpenScale;
    const visemeRounded = Math.round(this.currentViseme);
    const roundedLip = visemeRounded === mouthTheme.roundedViseme;
    const widthFactor = roundedLip ? 0.65 : 1;
    const lipTensionFactor = clamp(1 - this.expression.lipTension * 0.35, 0.5, 1.4);
    const mouthWidth = mouthWidthBase * widthFactor * lipTensionFactor;

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
    const controlOffsetBase = mouthHeight * 0.7;
    const controlOffset = controlOffsetBase * (1 + cornerBias * 0.4);

    ctx.lineWidth = mouthTheme.lineWidth;
    ctx.strokeStyle = mouthTheme.stroke;

    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipTopY);
    ctx.bezierCurveTo(
      -mouthWidth * 0.4,
      lipTopY - controlOffset,
      mouthWidth * 0.4,
      lipTopY - controlOffset,
      mouthWidth,
      lipTopY,
    );
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipBottomY);
    ctx.bezierCurveTo(
      -mouthWidth * 0.4,
      lipBottomY + controlOffset,
      mouthWidth * 0.4,
      lipBottomY + controlOffset,
      mouthWidth,
      lipBottomY,
    );
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

  private drawSpriteHead(ctx: CanvasRenderingContext2D): void {
    const headY = -180;
    const image = this.spriteFrames[Math.round(this.currentViseme)] || this.spriteFrames[0];
    if (!image) {
      this.drawVectorHead(ctx);
      return;
    }
    const scale = 1 + this.currentMouth * 0.1 * this.expression.mouthOpenScale;
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, -width / 2, headY - height / 2, width, height);
  }
}
