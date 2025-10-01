/**
 * @module emotion/semantic-triggers
 * 根据文本语义触发表情与手势时间轴，可与 mouthTimeline 融合驱动头像。
 */

import type { SentimentEstimate } from './sentiment-heuristics.js';

/**
 * 逐词时间轴条目。
 */
export interface WordTimelineEntry {
  /** 词语文本。 */
  text: string;
  /** 起始时间（秒）。 */
  tStart: number;
  /** 结束时间（秒）。 */
  tEnd: number;
}

/**
 * 语义时间轴关键帧。
 */
export interface SemanticTimelineKeyframe {
  /** 时间戳（秒）。 */
  t: number;
  /** 键名称，例如 `smileBoost`、`headNod`。 */
  k: string;
  /** 数值强度，范围建议在 [0, 1]。 */
  v: number;
}

/**
 * 自定义词典条目，支持扩展触发词与对应动作。
 */
export interface SemanticDictionaryEntry {
  /** 触发后写入时间轴的键。 */
  key: string;
  /** 时间轴类型：表情（emote）或手势（gesture）。 */
  timeline: 'emote' | 'gesture';
  /** 匹配的词或符号，大小写不敏感。 */
  terms: string[];
  /** 可选：默认强度，未指定时默认为 0.6。 */
  intensity?: number;
  /** 可选：触发后持续时间（秒），用于维持动作。 */
  sustain?: number;
}

/**
 * 语义词典集合。
 */
export type SemanticDictionary = SemanticDictionaryEntry[];

/**
 * 默认语义词典，覆盖常见的笑、问号、感叹号等触发词。
 */
export const DEFAULT_SEMANTIC_DICTIONARY: SemanticDictionary = [
  {
    key: 'smileBoost',
    timeline: 'emote',
    terms: ['哈哈', '呵呵', '笑', 'lol', 'lmao', 'xd'],
    intensity: 0.75,
    sustain: 0.8,
  },
  {
    key: 'browLift',
    timeline: 'emote',
    terms: ['?', '？'],
    intensity: 0.65,
    sustain: 0.6,
  },
  {
    key: 'headNod',
    timeline: 'gesture',
    terms: ['!', '！'],
    intensity: 0.7,
    sustain: 0.7,
  },
];

/**
 * 触发结果，分别返回表情与手势时间轴。
 */
export interface SemanticTimelineResult {
  /** 表情时间轴。 */
  emoteTimeline: SemanticTimelineKeyframe[];
  /** 手势时间轴。 */
  gestureTimeline: SemanticTimelineKeyframe[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const pickNumber = (candidate: unknown, fallback: number): number => {
  const num = Number(candidate);
  return Number.isFinite(num) ? num : fallback;
};

const sanitizeWordTimeline = (timeline: WordTimelineEntry[]): WordTimelineEntry[] =>
  timeline
    .map((item) => {
      const text = String(item?.text ?? '').trim();
      if (!text) {
        return null;
      }
      const start = pickNumber(item?.tStart ?? item?.tEnd ?? 0, 0);
      const end = pickNumber(item?.tEnd ?? item?.tStart ?? start, start);
      const safeStart = Math.max(0, start);
      const safeEnd = Math.max(safeStart, end);
      return {
        text,
        tStart: safeStart,
        tEnd: safeEnd <= safeStart ? safeStart + 0.001 : safeEnd,
      } satisfies WordTimelineEntry;
    })
    .filter(Boolean)
    .sort((a, b) => a.tStart - b.tStart) as WordTimelineEntry[];

const toLower = (value: string): string => value.toLowerCase();

const createAccumulator = () =>
  new Map<string, SemanticTimelineKeyframe[]>([
    ['emote', []],
    ['gesture', []],
  ]);

const ensureBaseline = (
  store: Map<string, SemanticTimelineKeyframe[]>,
  key: string,
  timeline: 'emote' | 'gesture',
): void => {
  const mapKey = timeline;
  const list = store.get(mapKey);
  if (!list) {
    return;
  }
  if (!list.some((frame) => frame.k === key && frame.t === 0)) {
    list.push({ t: 0, k: key, v: 0 });
  }
};

const addKeyframe = (
  store: Map<string, SemanticTimelineKeyframe[]>,
  key: string,
  timeline: 'emote' | 'gesture',
  time: number,
  value: number,
): void => {
  const list = store.get(timeline);
  if (!list) {
    return;
  }
  ensureBaseline(store, key, timeline);
  list.push({
    t: Math.max(0, time),
    k: key,
    v: clamp01(value),
  });
};

const addPulse = (
  store: Map<string, SemanticTimelineKeyframe[]>,
  key: string,
  timeline: 'emote' | 'gesture',
  time: number,
  intensity: number,
  sustain: number,
): void => {
  const startTime = Math.max(0, time);
  const hold = Math.max(0.2, sustain);
  addKeyframe(store, key, timeline, startTime, clamp01(intensity));
  addKeyframe(store, key, timeline, startTime + hold, 0);
};

const computeFallbackDuration = (
  timeline: WordTimelineEntry[],
  text: string,
): number => {
  if (timeline.length > 0) {
    const last = timeline[timeline.length - 1];
    return Math.max(last.tEnd, 0.8);
  }
  const charCount = Array.from(text ?? '').length;
  return Math.max(0.8, charCount * 0.06 + 0.5);
};

const estimateTimeByIndex = (
  index: number,
  total: number,
  duration: number,
): number => {
  if (total <= 0) {
    return 0;
  }
  const ratio = clamp01(index / total);
  return ratio * duration;
};

const collectTermTimes = (
  term: string,
  text: string,
  words: WordTimelineEntry[],
  fallbackDuration: number,
): number[] => {
  const normalizedTerm = toLower(term);
  const matches = new Set<number>();
  const isSingleChar = normalizedTerm.length === 1;

  for (const entry of words) {
    const wordLower = toLower(entry.text);
    if (wordLower.includes(normalizedTerm)) {
      const time = (entry.tStart + entry.tEnd) / 2;
      matches.add(time);
    }
  }

  if (matches.size === 0 || isSingleChar) {
    const raw = Array.from(text);
    const lowerRaw = Array.from(toLower(text));
    for (let i = 0; i < lowerRaw.length; i += 1) {
      const slice = lowerRaw.slice(i, i + normalizedTerm.length).join('');
      if (slice === normalizedTerm) {
        const approximate = estimateTimeByIndex(i, raw.length, fallbackDuration);
        matches.add(approximate);
      }
    }
  }

  return [...matches].sort((a, b) => a - b);
};

const flattenTimeline = (
  store: Map<string, SemanticTimelineKeyframe[]>,
  timeline: 'emote' | 'gesture',
): SemanticTimelineKeyframe[] => {
  const list = store.get(timeline) ?? [];
  list.sort((a, b) => {
    if (a.t === b.t) {
      return a.k.localeCompare(b.k);
    }
    return a.t - b.t;
  });
  return list;
};

const applySentimentBaseline = (
  store: Map<string, SemanticTimelineKeyframe[]>,
  sentiment: SentimentEstimate | null | undefined,
  duration: number,
): void => {
  if (!sentiment) {
    return;
  }
  if (sentiment.valence > 0.25) {
    const boost = clamp01((sentiment.valence - 0.25) * 0.9);
    addPulse(store, 'smileBoost', 'emote', 0, 0.4 + boost * 0.4, Math.max(0.6, duration * 0.4));
  }
  if (sentiment.tags?.includes('question')) {
    addPulse(store, 'browLift', 'emote', duration * 0.4, 0.4, 0.8);
  }
  if (sentiment.tags?.includes('excited')) {
    addPulse(store, 'headNod', 'gesture', duration * 0.3, 0.5, 0.9);
  }
};

/**
 * 根据文本语义触发表情与手势时间轴。
 *
 * @param text - 原始文本。
 * @param sentiment - 由 {@link estimateSentiment} 获得的情绪估计，可选。
 * @param wordTimeline - 逐词时间轴，用于精确对齐触发时间，可为空数组。
 * @param dictionary - 自定义词典，未提供时会 fallback 到 {@link DEFAULT_SEMANTIC_DICTIONARY}。
 * @returns {@link SemanticTimelineResult} 表情与手势时间轴。
 */
export function deriveSemanticTimelines(
  text: string,
  sentiment: SentimentEstimate | null | undefined,
  wordTimeline: WordTimelineEntry[] = [],
  dictionary: SemanticDictionary = DEFAULT_SEMANTIC_DICTIONARY,
): SemanticTimelineResult {
  const sanitizedText = text ?? '';
  const sanitizedDictionary = Array.isArray(dictionary) && dictionary.length > 0
    ? dictionary
    : DEFAULT_SEMANTIC_DICTIONARY;
  const words = sanitizeWordTimeline(wordTimeline);
  const duration = computeFallbackDuration(words, sanitizedText);
  const store = createAccumulator();

  applySentimentBaseline(store, sentiment, duration);

  for (const entry of sanitizedDictionary) {
    const { key, timeline, terms } = entry;
    if (!key || !timeline || !Array.isArray(terms) || terms.length === 0) {
      continue;
    }
    const intensity = clamp01(entry.intensity ?? 0.6);
    const sustain = Math.max(0.3, entry.sustain ?? 0.6);
    for (const term of terms) {
      if (!term) continue;
      const times = collectTermTimes(term, sanitizedText, words, duration);
      for (const time of times) {
        addPulse(store, key, timeline, time, intensity, sustain);
      }
    }
  }

  return {
    emoteTimeline: flattenTimeline(store, 'emote'),
    gestureTimeline: flattenTimeline(store, 'gesture'),
  };
}
