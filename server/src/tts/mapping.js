/**
 * @file mapping.js
 * @description 定义音素（phoneme）到口型（viseme）的默认映射，并提供加载外部 JSON 配置的工具函数。
 *              eSpeak NG 在输出 `.pho` 文件时会包含大量类似 `a 120 90` 的行，这些音素需要归一化为有限个口型类别。
 */

import fs from 'fs';
import path from 'path';

/**
 * @typedef {Object} VisemeConfig
 * @property {Record<string, number>} phonemeToViseme - 音素到口型编号的映射表。
 * @property {Record<string, number>} visemeToMouth - 口型编号到张嘴幅度（0-1）的映射。
 * @property {Record<string, { description: string }>} [visemeMeta] - 口型额外描述，便于文档化。
 */

/**
 * 默认口型配置，覆盖常见的中英文音素。
 * 数值越大嘴巴越张开，部分圆唇音会带有额外的 UI 提示以收紧嘴角。
 */
export const DEFAULT_VISEME_CONFIG = {
  phonemeToViseme: {
    // 完全闭合类：双唇音，适合 /p b m/ 等。eSpeak 中文音素 b\", p\" 亦归此类。
    p: 0,
    b: 0,
    m: 0,
    'b\u02bc': 0,
    'p\u02bc': 0,
    'm\u02bc': 0,
    'b\u02b0': 0,
    'p\u02b0': 0,
    'm\u02b0': 0,
    'b=': 0,
    'p=': 0,
    'm=': 0,
    // 半开类：唇齿音、舌尖音。
    f: 1,
    v: 1,
    'f\u02bc': 1,
    'f\u02b0': 1,
    'v\u02bc': 1,
    'v\u02b0': 1,
    s: 2,
    z: 2,
    t: 2,
    d: 2,
    n: 2,
    l: 2,
    'ts': 2,
    'dz': 2,
    't\u0361s': 2,
    'd\u0361z': 2,
    r: 3,
    'r\u02bc': 3,
    'r=': 3,
    'zh': 3,
    'ch': 3,
    'sh': 3,
    'zh\u02bc': 3,
    'ch\u02bc': 3,
    'sh\u02bc': 3,
    // 中度张口：央元音或开口度适中元音。
    e: 4,
    '\u0259': 4,
    '\u025a': 4,
    '\u0254': 5,
    o: 5,
    '\u0251': 8,
    a: 8,
    '\u00e6': 7,
    '\u028c': 6,
    '\u028a': 9,
    u: 9,
    '\u0289': 9,
    '\u026f': 9,
    i: 6,
    j: 6,
    y: 6,
    'i\u02bc': 6,
    'j\u02bc': 6,
    'y\u02bc': 6,
    // 鼻化或儿化音：与上文同一类，保持嘴巴半开并在前端可加上鼻腔震动特效。
    '\u026b': 3,
    '\u0272': 6,
    '\u014b': 5,
    'er': 3,
    // 默认兜底：未知音素统一归为轻微张口，避免时间轴断裂。
    default: 2,
  },
  visemeToMouth: {
    0: 0.05,
    1: 0.22,
    2: 0.32,
    3: 0.4,
    4: 0.52,
    5: 0.6,
    6: 0.45,
    7: 0.7,
    8: 0.92,
    9: 0.62,
  },
  visemeMeta: {
    0: { description: '闭唇 /p b m/' },
    1: { description: '唇齿半开 /f v/' },
    2: { description: '齿龈轻触 /t d s z/' },
    3: { description: '卷舌或儿化 /r ɚ/' },
    4: { description: '中开央元音 /ə e/' },
    5: { description: '中开圆唇 /o ɔ/' },
    6: { description: '扁唇高元音 /i j y/' },
    7: { description: '大幅开口前元音 /æ/' },
    8: { description: '最大开口 /a ɑ/' },
    9: { description: '圆唇高元音 /u ʊ/' },
  },
};

/**
 * 根据音素查找口型编号。
 * @param {string} phoneme - eSpeak `.pho` 行中的音素字符串。
 * @param {VisemeConfig} config - 当前使用的映射配置。
 * @returns {{ visemeId: number, mouth: number }} 口型编号及对应张嘴幅度。
 */
export const mapPhonemeToViseme = (phoneme, config) => {
  const normalized = phoneme.trim();
  const { phonemeToViseme, visemeToMouth } = config;
  const visemeId = Object.prototype.hasOwnProperty.call(phonemeToViseme, normalized)
    ? phonemeToViseme[normalized]
    : phonemeToViseme.default;
  const mouth = visemeToMouth[String(visemeId)] ?? visemeToMouth[visemeId] ?? 0.3;
  return { visemeId: Number(visemeId), mouth };
};

/**
 * 从 JSON 文件加载自定义口型映射。文件需包含 `phonemeToViseme` 与 `visemeToMouth` 两个字段。
 * 若路径为空或解析失败，将返回 fallback 配置。
 * @param {string|undefined} filePath - JSON 文件路径，可以是相对路径。
 * @param {VisemeConfig} fallback - 默认配置。
 * @returns {VisemeConfig} 合并后的配置。
 */
export const loadVisemeConfig = (filePath, fallback) => {
  if (!filePath) {
    return fallback;
  }
  try {
    const absolute = path.resolve(process.cwd(), filePath);
    const content = fs.readFileSync(absolute, 'utf-8');
    const parsed = JSON.parse(content);
    return {
      phonemeToViseme: { ...fallback.phonemeToViseme, ...(parsed.phonemeToViseme || {}) },
      visemeToMouth: { ...fallback.visemeToMouth, ...(parsed.visemeToMouth || {}) },
      visemeMeta: { ...fallback.visemeMeta, ...(parsed.visemeMeta || {}) },
    };
  } catch (error) {
    // eslint-disable-next-line no-console -- 配置解析失败时打印提醒即可
    console.warn('[stickbot] 自定义口型映射解析失败，使用默认配置。', error);
    return fallback;
  }
};

