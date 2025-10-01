/**
 * @module emotion/expression-mapping
 * 根据情绪维度映射出头像需要的表情参数。
 */

import type { SentimentEstimate } from './sentiment-heuristics.js';

/**
 * BigMouthAvatar 可识别的表情参数集合。
 */
export interface AvatarExpressionParams {
  /** 嘴巴张开倍数，1 为基准。 */
  mouthOpenScale: number;
  /** 嘴唇拉紧程度，0 表示放松，正值表示紧绷。 */
  lipTension: number;
  /** 嘴角弯曲程度，正值表示上扬。 */
  cornerCurve: number;
  /** 眨眼偏置，正值表示更频繁眨眼，负值表示保持睁眼。 */
  eyeBlinkBias: number;
  /** 轻点头幅度，数值越大动作越明显。 */
  headNodAmp: number;
  /** 身体轻微左右摇摆幅度。 */
  swayAmp: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const defaultExpression: AvatarExpressionParams = {
  mouthOpenScale: 1,
  lipTension: 0,
  cornerCurve: 0,
  eyeBlinkBias: 0,
  headNodAmp: 0,
  swayAmp: 0,
};

const computeLipTension = (valence: number, arousal: number, tags: string[]): number => {
  let tension = arousal * 0.4;
  if (valence < -0.3) {
    tension += Math.abs(valence) * 0.4;
  }
  if (tags.includes('shouting')) {
    tension += 0.2;
  }
  if (tags.includes('calm')) {
    tension *= 0.6;
  }
  return clamp(tension, 0, 1);
};

const computeCornerCurve = (valence: number, tags: string[]): number => {
  let curve = valence * 0.6;
  if (tags.includes('mixed')) {
    curve *= 0.5;
  }
  if (tags.includes('question')) {
    curve -= 0.1;
  }
  return clamp(curve, -1, 1);
};

const computeBlinkBias = (arousal: number, tags: string[]): number => {
  let bias = -arousal * 0.3;
  if (tags.includes('calm')) {
    bias += 0.2;
  }
  if (tags.includes('shouting') || tags.includes('excited')) {
    bias -= 0.2;
  }
  return clamp(bias, -0.6, 0.6);
};

const computeHeadNod = (valence: number, tags: string[]): number => {
  let nod = Math.max(0, valence) * 0.5;
  if (tags.includes('question')) {
    nod += 0.2;
  }
  if (tags.includes('negative')) {
    nod *= 0.4;
  }
  return clamp(nod, 0, 1);
};

const computeSway = (arousal: number, tags: string[]): number => {
  let sway = 0.1 + arousal * 0.2;
  if (tags.includes('calm')) {
    sway *= 0.6;
  }
  if (tags.includes('excited')) {
    sway += 0.1;
  }
  return clamp(sway, 0, 0.6);
};

/**
 * 将情绪估计结果映射为 BigMouthAvatar 的表情参数。
 *
 * 该映射遵循以下直觉：
 * - arousal 越高嘴巴张开越明显，同时身体摇摆幅度更大；
 * - valence 越高嘴角越上扬，越低嘴角越下压；
 * - 负向情绪与高激动会提升嘴唇紧绷；
 * - calm/question 等标签会微调眨眼与点头。
 *
 * @param emotion - 情绪估计结果，可以只提供 valence 与 arousal。
 * @returns {@link AvatarExpressionParams} 可直接应用于 {@link BigMouthAvatar#setExpression} 的表情参数。
 */
export function mapEmotionToExpression(emotion: Partial<SentimentEstimate>): AvatarExpressionParams {
  const valence = clamp(emotion.valence ?? 0, -1, 1);
  const arousal = clamp(emotion.arousal ?? 0.4, 0, 1);
  const tags = emotion.tags ?? [];

  const mouthOpenScale = clamp(0.9 + arousal * 0.6 + valence * 0.1, 0.6, 1.8);
  const lipTension = computeLipTension(valence, arousal, tags);
  const cornerCurve = computeCornerCurve(valence, tags);
  const eyeBlinkBias = computeBlinkBias(arousal, tags);
  const headNodAmp = computeHeadNod(valence, tags);
  const swayAmp = computeSway(arousal, tags);

  return {
    ...defaultExpression,
    mouthOpenScale,
    lipTension,
    cornerCurve,
    eyeBlinkBias,
    headNodAmp,
    swayAmp,
  };
}
