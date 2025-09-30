/**
 * @module avatar
 * @description 负责在 <canvas> 元素上绘制火柴人、驱动动画循环，并暴露口型与姿态控制接口。
 * 设计要点：
 * 1. 所有动画都在 requestAnimationFrame 循环中运行，避免阻塞主线程；
 * 2. 通过配置项调整眨眼周期、肢体摆动幅度等参数，便于后续调优；
 * 3. mouthValue 由 lipsync 模块提供，通过平滑滤波避免跳变。
 */

/**
 * @typedef {Object} StickbotConfig
 * @property {[number, number]} blinkIntervalRange 眨眼间隔范围（秒），将在此区间随机取值。
 * @property {number} blinkDuration 一次眨眼持续时间（秒），决定眼睛闭合的时间长度。
 * @property {number} limbSwingAmplitude 四肢摆动幅度（弧度），建议 0.1-0.4 之间。
 * @property {number} limbSwingSpeed 四肢摆动速度倍数，决定摆动快慢。
 * @property {number} mouthSmoothing 口型平滑系数，0-1 之间，数值越大越平滑但响应越慢。
 */

/** @type {StickbotConfig} */
export const DEFAULT_CONFIG = {
  blinkIntervalRange: [2.5, 5],
  blinkDuration: 0.18,
  limbSwingAmplitude: 0.22,
  limbSwingSpeed: 1.6,
  mouthSmoothing: 0.18,
};

/**
 * 生成下一次眨眼时间戳。
 * @param {[number, number]} range - 眨眼间隔范围（秒）。
 * @returns {number} 下一次眨眼应触发的绝对时间（秒）。
 */
const randomBlinkTime = (range) => {
  const [min, max] = range;
  const now = performance.now() / 1000;
  const interval = min + Math.random() * (max - min);
  return now + interval;
};

/**
 * StickbotAvatar 负责维护动画状态与渲染。
 */
export class StickbotAvatar {
  /**
   * @param {HTMLCanvasElement} canvas - 用于绘制的画布元素。
   * @param {Partial<StickbotConfig>} [config] - 可选配置，用于覆盖默认值。
   */
  constructor(canvas, config = {}) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = canvas.getContext('2d');
    /** @type {StickbotConfig} */
    this.config = { ...DEFAULT_CONFIG, ...config };

    /** @type {number} */
    this.currentMouth = 0; // 当前口型开合度，范围 0-1
    /** @type {number} */
    this.targetMouth = 0; // lipsync 模块传入的目标值
    /** @type {number} */
    this.lastTimestamp = 0; // 上一帧时间戳
    /** @type {number|null} */
    this.rafId = null; // requestAnimationFrame 的 ID
    /** @type {number} */
    this.nextBlinkTime = randomBlinkTime(this.config.blinkIntervalRange);
    /** @type {number} */
    this.blinkProgress = 0; // 0-1，0 为睁眼，1 为完全闭眼
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
   * 设置口型目标值。
   * @param {number} value - 口型开合度，范围 0（闭口）到 1（大幅张口）。
   */
  setMouthValue(value) {
    this.targetMouth = Math.min(1, Math.max(0, value));
  }

  /**
   * 帧更新逻辑：处理口型平滑、肢体摆动节奏与眨眼。
   * @param {number} timestamp - 当前帧的时间戳（毫秒）。
   */
  update(timestamp) {
    if (!this.lastTimestamp) {
      this.lastTimestamp = timestamp;
    }
    const delta = (timestamp - this.lastTimestamp) / 1000; // 换算为秒
    this.lastTimestamp = timestamp;

    // 采用指数平滑避免口型闪烁
    const smoothing = this.config.mouthSmoothing;
    this.currentMouth = this.currentMouth + (this.targetMouth - this.currentMouth) * (1 - Math.pow(1 - smoothing, delta * 60));

    // 眨眼进度更新：当到达下一次眨眼时间时，启动一个短暂的闭眼动画
    const now = timestamp / 1000;
    if (now >= this.nextBlinkTime) {
      this.blinkProgress = Math.min(1, this.blinkProgress + delta / (this.config.blinkDuration / 2));
      if (this.blinkProgress >= 1) {
        // 完成闭眼后，立即开始睁眼过程
        this.nextBlinkTime = now + 0.1; // 0.1 秒后开始睁眼
      }
    } else if (this.blinkProgress > 0) {
      this.blinkProgress = Math.max(0, this.blinkProgress - delta / (this.config.blinkDuration / 2));
      if (this.blinkProgress === 0) {
        this.nextBlinkTime = randomBlinkTime(this.config.blinkIntervalRange);
      }
    }
  }

  /**
   * 绘制火柴人及动态部位。
   */
  draw() {
    const ctx = this.ctx;
    if (!ctx) return;

    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);

    // 计算身体中心
    const centerX = width / 2;
    const centerY = height / 2;

    // 肢体摆动使用正弦函数，mouth 值叠加轻微抖动让角色更生动
    const time = performance.now() / 1000;
    const swing = Math.sin(time * this.config.limbSwingSpeed) * this.config.limbSwingAmplitude;
    const jitter = (Math.random() - 0.5) * 0.05 * (0.2 + this.currentMouth);

    ctx.save();
    ctx.translate(centerX, centerY + 40);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';

    // 躯干
    ctx.beginPath();
    ctx.moveTo(0, -120);
    ctx.lineTo(0, 40);
    ctx.stroke();

    // 头部（根据 mouth 值轻微上下浮动）
    const headOffset = -140 - this.currentMouth * 6;
    ctx.beginPath();
    ctx.arc(0, headOffset, 32 + this.currentMouth * 2, 0, Math.PI * 2);
    ctx.stroke();

    // 眼睛：根据 blinkProgress 调整高度实现闭合效果
    const eyeY = headOffset - 6;
    const eyeGap = 16;
    const eyeOpenHeight = Math.max(2, 8 * (1 - this.blinkProgress));
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-eyeGap, eyeY);
    ctx.lineTo(-eyeGap, eyeY + eyeOpenHeight);
    ctx.moveTo(eyeGap, eyeY);
    ctx.lineTo(eyeGap, eyeY + eyeOpenHeight);
    ctx.stroke();

    // 嘴巴：使用椭圆表示，根据 currentMouth 调整高度与宽度
    const mouthWidth = 28 + this.currentMouth * 20;
    const mouthHeight = 6 + this.currentMouth * 22;
    ctx.beginPath();
    ctx.ellipse(0, headOffset + 16, mouthWidth, mouthHeight, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 手臂
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, -80);
    ctx.lineTo(-70, -80 + Math.sin(time * this.config.limbSwingSpeed + Math.PI / 4) * 30);
    ctx.moveTo(0, -80);
    ctx.lineTo(70, -80 + Math.sin(time * this.config.limbSwingSpeed + Math.PI + jitter) * 30);
    ctx.stroke();

    // 腿部
    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.lineTo(-50, 140 + swing * 40);
    ctx.moveTo(0, 40);
    ctx.lineTo(50, 140 - swing * 40);
    ctx.stroke();

    ctx.restore();
  }
}
