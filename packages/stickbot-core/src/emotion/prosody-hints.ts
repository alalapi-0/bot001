/**
 * @module emotion/prosody-hints
 * 根据文本标点生成表情时间线提示，用于强化语音节奏。
 */

import type { ExpressionTimelineKeyframe } from '../timeline-player.js';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const WORD_REGEX = /[\p{L}\p{N}'][\p{L}\p{N}'-]*/gu;
const WORD_TOKEN_REGEX = /^[\p{L}\p{N}'][\p{L}\p{N}'-]*$/u;
const TOKEN_REGEX = /[\p{L}\p{N}']+[\p{L}\p{N}'-]*|\.\.\.|[^\s]/gu;

const BASE_STATE: Record<string, number> = {
  mouthOpenScale: 1,
  lipTension: 0,
  cornerCurve: 0,
  eyeBlinkBias: 0,
  headNodAmp: 0,
  swayAmp: 0.12,
};

/**
 * `deriveProsodyHints` 的可选配置。
 */
export interface ProsodyHintOptions {
  /** 每个词语的平均时长（秒），默认 0.32。 */
  wordDuration?: number;
  /** 表情恢复到基线的缓冲时长（秒），默认 0.35。 */
  releaseDuration?: number;
}

const pushReturnKeyframe = (
  timeline: ExpressionTimelineKeyframe[],
  key: string,
  time: number,
  releaseDuration: number,
): void => {
  const targetTime = time + releaseDuration;
  timeline.push({ t: targetTime, k: key, v: BASE_STATE[key] ?? 0 });
};

const addEmphasis = (
  timeline: ExpressionTimelineKeyframe[],
  time: number,
  key: keyof typeof BASE_STATE,
  value: number,
  release: number,
): void => {
  timeline.push({ t: time, k: key, v: value });
  pushReturnKeyframe(timeline, key, time, release);
};

const handleSentenceEnd = (
  timeline: ExpressionTimelineKeyframe[],
  time: number,
  punctuation: string,
  release: number,
): void => {
  if (punctuation === '!') {
    addEmphasis(timeline, time, 'mouthOpenScale', 1.4, release + 0.1);
    addEmphasis(timeline, time, 'lipTension', 0.5, release + 0.1);
    addEmphasis(timeline, time, 'eyeBlinkBias', -0.2, release);
  } else if (punctuation === '?') {
    addEmphasis(timeline, time, 'mouthOpenScale', 1.25, release);
    addEmphasis(timeline, time, 'headNodAmp', 0.35, release + 0.1);
    addEmphasis(timeline, time, 'cornerCurve', -0.15, release);
  } else {
    addEmphasis(timeline, time, 'mouthOpenScale', 0.85, release);
    addEmphasis(timeline, time, 'headNodAmp', 0.22, release);
    addEmphasis(timeline, time, 'eyeBlinkBias', 0.25, release);
  }
};

const handlePause = (
  timeline: ExpressionTimelineKeyframe[],
  time: number,
  punctuation: string,
  release: number,
): void => {
  if (punctuation === ',') {
    addEmphasis(timeline, time, 'mouthOpenScale', 1.1, release);
    addEmphasis(timeline, time, 'headNodAmp', 0.18, release);
  } else if (punctuation === ';' || punctuation === ':') {
    addEmphasis(timeline, time, 'mouthOpenScale', 0.95, release);
    addEmphasis(timeline, time, 'lipTension', 0.25, release);
  } else if (punctuation === '…' || punctuation === '...') {
    addEmphasis(timeline, time, 'mouthOpenScale', 0.7, release + 0.2);
    addEmphasis(timeline, time, 'eyeBlinkBias', 0.3, release + 0.1);
  }
};

const addBaseline = (timeline: ExpressionTimelineKeyframe[]): void => {
  for (const [key, value] of Object.entries(BASE_STATE)) {
    timeline.push({ t: 0, k: key, v: value });
  }
};

const isWord = (token: string): boolean => WORD_TOKEN_REGEX.test(token);

const estimateWordDuration = (token: string, baseDuration: number): number => {
  if (!isWord(token)) return baseDuration;
  const extra = clamp(token.length - 3, 0, 10) * 0.02;
  return baseDuration + extra;
};

/**
 * 根据文本标点生成 expressionTimeline，用于在语音播放过程中驱动额外表情。
 *
 * 函数会对输入文本执行一次粗略的节奏估计：
 * - 每个词给予固定时间增量；
 * - 逗号/分号等作为短暂停顿；
 * - 句号/感叹号/问号作为句末强调；
 * - 省略号会触发更明显的眨眼与嘴部收拢。
 *
 * 返回的时间线仅包含关键点，后续可在 {@link TimelinePlayer} 中按需插值。
 *
 * @param text - 输入文本。
 * @param options - 可选配置，例如词时长与恢复时长。
 * @returns {@link ExpressionTimelineKeyframe[]} 表情关键帧序列。
 */
export function deriveProsodyHints(
  text: string,
  options: ProsodyHintOptions = {},
): ExpressionTimelineKeyframe[] {
  const releaseDuration = options.releaseDuration ?? 0.35;
  const wordDuration = options.wordDuration ?? 0.32;
  const timeline: ExpressionTimelineKeyframe[] = [];
  addBaseline(timeline);

  const tokens = text.match(TOKEN_REGEX) ?? [];
  let time = 0;

  for (const token of tokens) {
    if (isWord(token)) {
      time += estimateWordDuration(token, wordDuration);
      continue;
    }

    if (/^\s+$/.test(token)) {
      time += token.length * 0.05;
      continue;
    }

    const normalized = token === '...' ? '...' : token;
    if (normalized === '...' || normalized === '…') {
      handlePause(timeline, time, normalized, releaseDuration + 0.1);
      time += releaseDuration + 0.15;
      continue;
    }

    if (',;:'.includes(normalized)) {
      handlePause(timeline, time, normalized, releaseDuration);
      time += releaseDuration * 0.8;
      continue;
    }

    if ('.?!'.includes(normalized)) {
      handleSentenceEnd(timeline, time, normalized, releaseDuration + 0.05);
      time += releaseDuration + 0.2;
      continue;
    }
  }

  timeline.sort((a, b) => a.t - b.t);
  return timeline;
}
