/**
 * @module emotion/sentiment-heuristics
 * 提供基于启发式规则的文本情绪估计。
 */

/**
 * 情绪估计结果。
 */
export interface SentimentEstimate {
  /**
   * 感情极性（valence），-1 表示非常负面，1 表示非常正面。
   */
  valence: number;
  /**
   * 激动程度（arousal），0 表示非常平静，1 表示高度激动。
   */
  arousal: number;
  /**
   * 与输入文本相关的标签集合，例如 `positive`、`question`。
   */
  tags: string[];
}

const POSITIVE_WORDS = [
  'good',
  'great',
  'love',
  'nice',
  'happy',
  'awesome',
  'amazing',
  'cool',
  'yay',
  'thanks',
  'thank you',
  'bravo',
  'fantastic',
  'wonderful',
];

const NEGATIVE_WORDS = [
  'bad',
  'sad',
  'angry',
  'upset',
  'hate',
  'terrible',
  'awful',
  'no',
  'never',
  'wtf',
  'mad',
  'annoyed',
  'tired',
  'worried',
];

const INTENSIFIERS = ['very', 'super', 'really', 'extremely', 'so', 'too'];
const CALM_WORDS = ['calm', 'gentle', 'relax', 'quiet', 'slow'];
const EXCITED_WORDS = ['excited', 'hype', 'wow', '!!!', 'whoa'];

const WORD_REGEX = /[\p{L}\p{N}'][\p{L}\p{N}'-]*/gu;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const countMatches = (text: string, dictionary: string[]): number => {
  let count = 0;
  for (const word of dictionary) {
    if (text.includes(word)) {
      count += 1;
    }
  }
  return count;
};

const wordScore = (word: string, dictionary: string[]): number =>
  dictionary.some((entry) => word.includes(entry)) ? 1 : 0;

const applyIntensity = (baseScore: number, intensifierCount: number): number => {
  if (!intensifierCount) return baseScore;
  const boost = 1 + intensifierCount * 0.35;
  return baseScore * boost;
};

const detectTags = (text: string, valence: number, arousal: number, polarityScore: number): string[] => {
  const tags = new Set<string>();
  if (valence > 0.25) {
    tags.add('positive');
  } else if (valence < -0.25) {
    tags.add('negative');
  }
  if (polarityScore > 1.5 && Math.abs(valence) < 0.35) {
    tags.add('mixed');
  }
  if (text.includes('?')) {
    tags.add('question');
  }
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations >= 2 || /([A-Z]{3,}\b)/.test(text)) {
    tags.add('shouting');
  }
  if (arousal > 0.7) {
    tags.add('excited');
  } else if (arousal < 0.3) {
    tags.add('calm');
  }
  return [...tags];
};

/**
 * 基于启发式规则估计输入文本的情绪状态。
 *
 * 该函数会结合积极/消极词汇、感叹号数量、大小写与强化词汇等信息，
 * 返回一个简单的情绪估计结果。虽然无法覆盖所有语境，但在无模型依赖
 * 的场景下能够提供可用的基线值。
 *
 * @param text - 待分析的文本内容。
 * @returns {@link SentimentEstimate} 情绪估计结果。
 */
export function estimateSentiment(text: string): SentimentEstimate {
  const normalized = text.toLowerCase();
  const tokens = normalized.match(WORD_REGEX) || [];

  let positive = 0;
  let negative = 0;
  let intensifiers = 0;
  let calmHints = 0;
  let excitedHints = 0;

  for (const token of tokens) {
    positive += wordScore(token, POSITIVE_WORDS);
    negative += wordScore(token, NEGATIVE_WORDS);
    intensifiers += wordScore(token, INTENSIFIERS);
    calmHints += wordScore(token, CALM_WORDS);
    excitedHints += wordScore(token, EXCITED_WORDS);
  }

  const punctuationExcitement = (text.match(/[!¡❗]/g) || []).length * 0.25;
  const questionMarks = (text.match(/\?/g) || []).length;
  const uppercaseIntensity = countMatches(text, ['LOL', 'OMG', 'WOW']);

  const polarityRaw = positive - negative;
  const polarityMagnitude = Math.abs(positive) + Math.abs(negative);
  const polarityAdjusted = applyIntensity(polarityRaw, intensifiers);
  const valence = clamp(
    polarityMagnitude === 0 ? 0 : polarityAdjusted / (polarityMagnitude + 0.5),
    -1,
    1,
  );

  const calmFactor = calmHints * 0.15;
  const excitedFactor = excitedHints * 0.15 + punctuationExcitement + uppercaseIntensity * 0.2;
  const baseArousal = 0.25 + Math.abs(valence) * 0.3 + excitedFactor;
  const arousal = clamp(baseArousal - calmFactor + questionMarks * 0.05, 0, 1);

  const tags = detectTags(text, valence, arousal, Math.abs(polarityRaw));

  return {
    valence,
    arousal,
    tags,
  };
}
