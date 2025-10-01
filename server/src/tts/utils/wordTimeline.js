/**
 * @file wordTimeline.js
 * @description 根据文本与语音总时长生成逐词时间轴，按语言特性拆分词块并按时长比例分配。
 */

/**
 * 判断字符是否为空白。
 * @param {string} char - 单个字符。
 * @returns {boolean} 是否为空白字符。
 */
const isWhitespace = (char) => /\s/.test(char);

/**
 * 判断字符是否属于 CJK（中日韩统一表意文字、假名、韩文等）。
 * @param {string} char - 单个字符。
 * @returns {boolean} 是否为 CJK 字符。
 */
const isCjkCharacter = (char) => {
  if (!char) return false;
  const code = char.codePointAt(0);
  if (!code) return false;
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0x2ceb0 && code <= 0x2ebe0) ||
    (code >= 0x3000 && code <= 0x303f) || // CJK Symbols and Punctuation
    (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
    (code >= 0xac00 && code <= 0xd7af) // Hangul Syllables
  );
};

/**
 * 判断字符是否为拉丁字母或数字。
 * @param {string} char - 单个字符。
 * @returns {boolean} 是否为拉丁字符或数字。
 */
const isLatinTokenChar = (char) => /[A-Za-z0-9]/.test(char);

/**
 * 判断字符是否可作为拉丁词的连接符（如 `'` 或 `-`）。
 * @param {string} char - 单个字符。
 * @returns {boolean} 是否为连接符。
 */
const isLatinConnector = (char) => char === "'" || char === '-';

/**
 * 将文本拆分为词块，CJK 字符按字切分，拉丁字母按单词切分，忽略标点。
 * @param {string} text - 输入文本。
 * @returns {Array<{ text: string, weight: number }>} 词块数组。
 */
export const splitTextIntoWordChunks = (text) => {
  if (!text) return [];
  const chunks = [];
  let buffer = '';

  const flushBuffer = () => {
    if (buffer) {
      chunks.push({ text: buffer, weight: buffer.length });
      buffer = '';
    }
  };

  for (const char of text) {
    if (isWhitespace(char)) {
      flushBuffer();
      continue;
    }
    if (isCjkCharacter(char)) {
      flushBuffer();
      if (/\p{P}/u.test(char)) {
        // CJK 标点直接跳过
        continue;
      }
      chunks.push({ text: char, weight: 1 });
      continue;
    }
    if (isLatinTokenChar(char) || (isLatinConnector(char) && buffer)) {
      buffer += char;
      continue;
    }
    flushBuffer();
    // 其他符号按独立块处理但不计权重
    if (!/\p{P}/u.test(char)) {
      chunks.push({ text: char, weight: Math.max(1, char.length) });
    }
  }
  flushBuffer();

  return chunks.filter((chunk) => chunk.text && chunk.weight > 0);
};

/**
 * 根据文本与总时长生成逐词时间轴。
 * @param {string} text - 原始文本。
 * @param {number} totalDuration - 语音总时长（秒）。
 * @returns {Array<{ tStart: number, tEnd: number, text: string }>} 逐词时间轴。
 */
export const generateWordTimeline = (text, totalDuration) => {
  if (!text || !Number.isFinite(totalDuration) || totalDuration <= 0) {
    return [];
  }
  const chunks = splitTextIntoWordChunks(text);
  if (chunks.length === 0) {
    return [];
  }
  const totalWeight = chunks.reduce((sum, chunk) => sum + chunk.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return [];
  }

  const result = [];
  let cursor = 0;
  let consumedWeight = 0;

  chunks.forEach((chunk, index) => {
    consumedWeight += chunk.weight;
    const ratio = consumedWeight / totalWeight;
    let end = index === chunks.length - 1 ? totalDuration : totalDuration * ratio;
    end = Math.min(totalDuration, Math.max(cursor, end));
    result.push({
      text: chunk.text,
      tStart: cursor,
      tEnd: end,
    });
    cursor = end;
  });

  if (result.length > 0) {
    result[result.length - 1].tEnd = totalDuration;
  }

  return result;
};

/**
 * 根据已累积的音素片段生成逐词时间轴。
 * @param {string} text - 原始文本。
 * @param {Array<{ start: number, end: number }>} cumulative - 带起止时间的音素片段。
 * @returns {Array<{ tStart: number, tEnd: number, text: string }>} 逐词时间轴。
 */
export const generateWordTimelineFromSegments = (text, cumulative) => {
  if (!Array.isArray(cumulative) || cumulative.length === 0) {
    return [];
  }
  const totalDuration = cumulative[cumulative.length - 1]?.end ?? 0;
  return generateWordTimeline(text, totalDuration);
};

export default generateWordTimeline;
