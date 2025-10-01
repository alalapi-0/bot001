/**
 * @module timeline-player
 * 提供用于驱动嘴型与表情的时间线播放器。
 */

import type { AvatarExpressionParams } from './emotion/expression-mapping.js';

/**
 * 单个 mouth 关键帧。
 */
export interface MouthTimelineFrame {
  /** 时间戳（秒）。 */
  t: number;
  /** mouth 数值，0-1。 */
  value: number;
  /** 可选的 viseme 标识，用于 Sprite 口型切换。 */
  visemeId?: number;
  /** 可选的音素标签，仅用于调试或日志。 */
  phoneme?: string;
}

/**
 * 表情时间线关键帧。
 */
export interface ExpressionTimelineKeyframe {
  /** 时间戳（秒）。 */
  t: number;
  /** 表情键，例如 `mouthOpenScale`、`headNodAmp`。 */
  k: keyof AvatarExpressionParams | string;
  /** 目标值。 */
  v: number;
}

/**
 * {@link TimelinePlayer} 配置项。
 */
export interface TimelinePlayerOptions {
  /**
   * mouth 数值的平滑系数，0 表示无平滑，1 表示完全跟随上一帧。
   * 默认 0.22。
   */
  smoothing?: number;
  /** 额外的表情关键帧列表。 */
  expressionTimeline?: ExpressionTimelineKeyframe[];
  /** 表情整体强度缩放，默认 1。 */
  expressionScale?: number;
  /** 自动增益配置。传入 true 启用默认参数，或指定配置覆盖。 */
  autoGain?: boolean | Partial<TimelinePlayerAutoGainOptions>;
}

/** 自动增益参数。 */
export interface TimelinePlayerAutoGainOptions {
  /** 是否启用。 */
  enabled: boolean;
  /** 计算窗口（秒）。 */
  windowSec: number;
  /** 目标 RMS。 */
  targetRMS: number;
  /** 增益下限。 */
  floor: number;
  /** 增益上限。 */
  ceil: number;
  /** 可选的平滑系数，0-1，数值越大增益变化越平滑。 */
  smoothing?: number;
}

/**
 * {@link TimelinePlayer#getFrameAt} 返回的结果。
 */
export interface TimelinePlayerFrame {
  /** mouth 数值，包含 expressionTimeline 的影响。 */
  value: number;
  /** 线性插值后的 viseme，便于做渐变。 */
  visemeId: number;
  /** 可选的音素标签。 */
  phoneme?: string;
  /** 当前表情参数。 */
  expression: AvatarExpressionParams;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const DEFAULT_EXPRESSION: AvatarExpressionParams = {
  mouthOpenScale: 1,
  lipTension: 0,
  cornerCurve: 0,
  eyeBlinkBias: 0,
  headNodAmp: 0,
  swayAmp: 0,
};

const clampExpressionState = (
  expression: AvatarExpressionParams,
): AvatarExpressionParams => ({
  mouthOpenScale: clamp(expression.mouthOpenScale, 0.2, 3),
  lipTension: clamp(expression.lipTension, -1, 1),
  cornerCurve: clamp(expression.cornerCurve, -1, 1),
  eyeBlinkBias: clamp(expression.eyeBlinkBias, -1, 1),
  headNodAmp: clamp(expression.headNodAmp, 0, 2),
  swayAmp: clamp(expression.swayAmp, 0, 2),
});

const scaleExpression = (
  expression: AvatarExpressionParams,
  scale: number,
): AvatarExpressionParams =>
  clampExpressionState({
    mouthOpenScale: 1 + (expression.mouthOpenScale - 1) * scale,
    lipTension: expression.lipTension * scale,
    cornerCurve: expression.cornerCurve * scale,
    eyeBlinkBias: expression.eyeBlinkBias * scale,
    headNodAmp: expression.headNodAmp * scale,
    swayAmp: expression.swayAmp * scale,
  });

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const clamp01 = (value: number): number => clamp(value, 0, 1);

const groupExpressionKeyframes = (
  keyframes: ExpressionTimelineKeyframe[],
): Map<string, ExpressionTimelineKeyframe[]> => {
  const result = new Map<string, ExpressionTimelineKeyframe[]>();
  for (const frame of keyframes) {
    const list = result.get(frame.k) ?? [];
    list.push(frame);
    result.set(frame.k, list);
  }
  for (const [, list] of result) {
    list.sort((a, b) => a.t - b.t);
  }
  return result;
};

const sampleKeyframes = (
  frames: ExpressionTimelineKeyframe[],
  time: number,
  defaultValue: number,
): number => {
  if (!frames || frames.length === 0) return defaultValue;
  if (time <= frames[0].t) {
    return frames[0].v;
  }
  if (time >= frames[frames.length - 1].t) {
    return frames[frames.length - 1].v;
  }
  for (let i = 0; i < frames.length - 1; i += 1) {
    const current = frames[i];
    const next = frames[i + 1];
    if (time >= current.t && time <= next.t) {
      const span = next.t - current.t || 1;
      const factor = clamp((time - current.t) / span, 0, 1);
      return lerp(current.v, next.v, factor);
    }
  }
  return defaultValue;
};

const sampleMouthFrame = (
  timeline: MouthTimelineFrame[],
  time: number,
): { value: number; visemeId: number; phoneme?: string } => {
  if (timeline.length === 0) {
    return { value: 0, visemeId: 0 };
  }
  if (time <= timeline[0].t) {
    const first = timeline[0];
    return {
      value: first.value,
      visemeId: first.visemeId ?? 0,
      phoneme: first.phoneme,
    };
  }
  if (time >= timeline[timeline.length - 1].t) {
    const last = timeline[timeline.length - 1];
    return {
      value: last.value,
      visemeId: last.visemeId ?? 0,
      phoneme: last.phoneme,
    };
  }
  for (let i = 0; i < timeline.length - 1; i += 1) {
    const current = timeline[i];
    const next = timeline[i + 1];
    if (time >= current.t && time <= next.t) {
      const span = next.t - current.t || 1;
      const factor = clamp((time - current.t) / span, 0, 1);
      const value = lerp(current.value, next.value, factor);
      const viseme = lerp(current.visemeId ?? 0, next.visemeId ?? 0, factor);
      const phoneme = factor > 0.5 ? next.phoneme ?? current.phoneme : current.phoneme;
      return { value, visemeId: viseme, phoneme };
    }
  }
  const fallback = timeline[timeline.length - 1];
  return {
    value: fallback.value,
    visemeId: fallback.visemeId ?? 0,
    phoneme: fallback.phoneme,
  };
};

/**
 * mouth 与表情时间线播放器。
 *
 * 使用方式：
 * ```ts
 * const player = new TimelinePlayer(mouthFrames, {
 *   expressionTimeline: deriveProsodyHints(text),
 * });
 * const state = player.getFrameAt(1.2);
 * avatar.setMouthFrame(state);
 * avatar.setExpression(state.expression);
 * ```
 */
export class TimelinePlayer {
  private readonly mouthTimeline: MouthTimelineFrame[];

  private readonly expressionTimeline: Map<string, ExpressionTimelineKeyframe[]>;

  private readonly smoothing: number;

  private readonly expressionScale: number;

  private readonly autoGainState: AutoGainState | null;

  private smoothedValue: number | null = null;

  private lastSampleTime: number | null = null;

  constructor(
    mouthTimeline: MouthTimelineFrame[],
    options: TimelinePlayerOptions = {},
  ) {
    this.mouthTimeline = [...mouthTimeline].sort((a, b) => a.t - b.t);
    this.expressionTimeline = groupExpressionKeyframes(options.expressionTimeline ?? []);
    this.smoothing = clamp(options.smoothing ?? 0.22, 0, 0.95);
    this.expressionScale = clamp(options.expressionScale ?? 1, 0, 3);
    this.autoGainState = this.createAutoGainState(options.autoGain);
  }

  /**
   * 重置内部平滑状态，适用于跳播或重新开始播放。
   */
  reset(): void {
    this.smoothedValue = null;
    this.lastSampleTime = null;
    if (this.autoGainState) {
      this.autoGainState.lastGain = 1;
      this.autoGainState.lastTime = null;
    }
  }

  /**
   * 计算给定时间点的嘴型与表情状态。
   *
   * @param time - 目标时间（秒）。
   * @returns {@link TimelinePlayerFrame} 包含口型、viseme 与表情的状态。
   */
  getFrameAt(time: number): TimelinePlayerFrame {
    const { value: rawValue, visemeId, phoneme } = sampleMouthFrame(this.mouthTimeline, time);
    const smoothed = this.applySmoothing(rawValue, time);
    const expression = this.sampleExpression(time);
    const scaledExpression = scaleExpression(expression, this.expressionScale);
    const autoGain = this.autoGainState ? this.computeAutoGain(time) : 1;
    const adjustedExpression = this.autoGainState
      ? {
          ...scaledExpression,
          mouthOpenScale: clamp(
            scaledExpression.mouthOpenScale * autoGain,
            0.2,
            3,
          ),
        }
      : scaledExpression;
    const finalValue = clamp(smoothed * adjustedExpression.mouthOpenScale, 0, 1);

    return {
      value: finalValue,
      visemeId,
      phoneme,
      expression: adjustedExpression,
    };
  }

  private applySmoothing(value: number, time: number): number {
    if (this.smoothedValue === null || this.lastSampleTime === null || time < this.lastSampleTime) {
      this.smoothedValue = value;
      this.lastSampleTime = time;
      return value;
    }
    const delta = Math.max(time - this.lastSampleTime, 0);
    this.lastSampleTime = time;
    if (this.smoothing <= 0 || delta === 0) {
      this.smoothedValue = value;
      return value;
    }
    const factor = 1 - Math.pow(1 - this.smoothing, delta * 60);
    this.smoothedValue += (value - this.smoothedValue) * factor;
    return this.smoothedValue;
  }

  private sampleExpression(time: number): AvatarExpressionParams {
    if (this.expressionTimeline.size === 0) {
      return { ...DEFAULT_EXPRESSION };
    }
    const result: AvatarExpressionParams = { ...DEFAULT_EXPRESSION };
    const defaultExpressionRecord = DEFAULT_EXPRESSION as unknown as Record<string, number>;
    const expressionRecord = result as unknown as Record<string, number>;
    for (const [key, frames] of this.expressionTimeline) {
      const defaultValue = defaultExpressionRecord[key] ?? 0;
      const value = sampleKeyframes(frames, time, defaultValue);
      expressionRecord[key] = value;
    }
    return clampExpressionState(result);
  }

  private createAutoGainState(
    option: TimelinePlayerOptions['autoGain'],
  ): AutoGainState | null {
    if (!option) {
      return null;
    }
    const defaultConfig: TimelinePlayerAutoGainOptions = {
      enabled: true,
      windowSec: 5,
      targetRMS: 0.5,
      floor: 0.6,
      ceil: 1.5,
      smoothing: 0.3,
    };
    const config: TimelinePlayerAutoGainOptions = {
      ...defaultConfig,
      ...(typeof option === 'boolean'
        ? { enabled: option }
        : option ?? {}),
    };
    if (!config.enabled || this.mouthTimeline.length === 0) {
      return null;
    }
    const step = 1 / 60;
    const duration = this.mouthTimeline[this.mouthTimeline.length - 1]?.t ?? 0;
    const sampleCount = Math.max(
      2,
      Math.ceil((duration + config.windowSec) / step) + 1,
    );
    const samples = new Array<number>(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      const t = i * step;
      const { value } = sampleMouthFrame(this.mouthTimeline, t);
      samples[i] = clamp01(value);
    }
    const prefixSquares = new Array<number>(sampleCount + 1).fill(0);
    for (let i = 0; i < sampleCount; i += 1) {
      const value = samples[i];
      prefixSquares[i + 1] = prefixSquares[i] + value * value;
    }
    return {
      config,
      step,
      samples,
      prefixSquares,
      lastGain: 1,
      lastTime: null,
    };
  }

  private computeAutoGain(time: number): number {
    const state = this.autoGainState;
    if (!state) {
      return 1;
    }
    if (!Number.isFinite(time) || time <= 0) {
      state.lastTime = time;
      state.lastGain = 1;
      return 1;
    }
    if (state.lastTime !== null && time < state.lastTime) {
      state.lastGain = 1;
    }
    state.lastTime = time;
    const { config, step, samples, prefixSquares } = state;
    const currentIndex = clamp(
      Math.floor(time / step),
      0,
      samples.length - 1,
    );
    const windowSamples = Math.max(1, Math.round(config.windowSec / step));
    const startIndex = Math.max(0, currentIndex - windowSamples + 1);
    const sumSquares =
      prefixSquares[currentIndex + 1] - prefixSquares[startIndex];
    const sampleCount = currentIndex + 1 - startIndex;
    if (sampleCount <= 0) {
      state.lastGain = 1;
      return 1;
    }
    const rms = Math.sqrt(sumSquares / sampleCount);
    if (!Number.isFinite(rms) || rms < 1e-4) {
      state.lastGain = 1;
      return 1;
    }
    const rawGain = clamp(config.targetRMS / rms, config.floor, config.ceil);
    const smoothing = clamp(config.smoothing ?? 0, 0, 0.95);
    const nextGain = smoothing > 0
      ? state.lastGain + (rawGain - state.lastGain) * smoothing
      : rawGain;
    state.lastGain = clamp(nextGain, config.floor, config.ceil);
    return state.lastGain;
  }
}

export type { ExpressionTimelineKeyframe as ExpressionTimelinePoint };

interface AutoGainState {
  config: TimelinePlayerAutoGainOptions;
  step: number;
  samples: number[];
  prefixSquares: number[];
  lastGain: number;
  lastTime: number | null;
}
