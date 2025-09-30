/**
 * @file timeline.js
 * @description 提供音素时长到 mouth 时间轴的转换工具，包括积分、线性插值与稀疏化。
 */

/**
 * @typedef {Object} PhonemeSegment
 * @property {string} phoneme - 音素原始字符串。
 * @property {number} durationMs - 持续时长（毫秒）。
 * @property {number} visemeId - 映射后的口型编号。
 * @property {number} mouth - 口型张合程度（0-1）。
 */

/**
 * @typedef {Object} MouthKeyframe
 * @property {number} t - 绝对时间（秒）。
 * @property {number} v - mouth 值。
 * @property {number} visemeId - 口型编号。
 * @property {string} phoneme - 来源音素，便于调试。
 */

/**
 * 根据音素片段生成累计时间轴。
 * @param {PhonemeSegment[]} segments - 解析 `.pho` 后得到的音素片段。
 * @returns {{ totalDuration: number, cumulative: Array<PhonemeSegment & { start: number, end: number }> }} 包含起止时间的片段数组。
 */
export const accumulateSegments = (segments) => {
  const cumulative = [];
  let cursor = 0;
  for (const segment of segments) {
    const start = cursor;
    const end = cursor + segment.durationMs / 1000;
    cumulative.push({ ...segment, start, end });
    cursor = end;
  }
  return { totalDuration: cursor, cumulative };
};

/**
 * 在固定采样率下生成 mouth 时间轴关键帧。
 * @param {Array<PhonemeSegment & { start: number, end: number }>} cumulative - 带起止时间的音素片段。
 * @param {number} totalDuration - 总时长（秒）。
 * @param {number} sampleRate - 希望生成的时间轴频率（Hz），建议 60-100 之间。
 * @returns {MouthKeyframe[]} mouth 关键帧数组。
 */
export const generateTimeline = (cumulative, totalDuration, sampleRate) => {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    return [];
  }
  const frames = [];
  const step = 1 / sampleRate;
  const frameCount = Math.ceil(totalDuration / step);
  let pointer = 0;
  for (let i = 0; i <= frameCount; i += 1) {
    const time = Math.min(i * step, totalDuration);
    while (pointer < cumulative.length - 1 && time > cumulative[pointer].end) {
      pointer += 1;
    }
    const segment = cumulative[pointer] || cumulative[cumulative.length - 1];
    frames.push({
      t: time,
      v: segment.mouth,
      visemeId: segment.visemeId,
      phoneme: segment.phoneme,
    });
  }
  return frames;
};

/**
 * 针对临界场景（如 `.pho` 为短促爆破音导致时间轴为空）进行兜底处理。
 * @param {MouthKeyframe[]} frames - 生成的 mouth 时间轴。
 * @returns {MouthKeyframe[]} 若无帧则返回最小占位关键帧。
 */
export const ensureTimelineFallback = (frames) => {
  if (frames.length > 0) {
    return frames;
  }
  return [
    { t: 0, v: 0.1, visemeId: 0, phoneme: 'sil' },
    { t: 0.2, v: 0.4, visemeId: 2, phoneme: 'sil' },
    { t: 0.4, v: 0.1, visemeId: 0, phoneme: 'sil' },
  ];
};

