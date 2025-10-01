/**
 * @file ITtsProvider.js
 * @description 约定 TTS 适配器统一接口，便于在路由层做策略分发。
 */

/**
 * @typedef {Object} TtsSynthesizeOptions
 * @property {string} [voice] - 发音人配置，具体取值与供应商相关。
 * @property {number} [rate] - 语速，通常与供应商 CLI 或 SDK 参数一致。
 */

/**
 * @typedef {Object} TtsSynthesizeResult
 * @property {string} id - 本次生成的临时资源 ID，可由服务端拼接下载 URL。
 * @property {string} audioPath - 音频文件绝对路径。
 * @property {string} audioType - 音频 MIME 类型，如 `audio/wav`。
 * @property {{ t: number, v: number, visemeId: number, phoneme?: string }[]} mouthTimeline - mouth 时间轴采样点。
 * @property {{ tStart: number, tEnd: number, text: string }[]} [wordTimeline] - 逐词时间轴，可用于字幕高亮。
 * @property {number} duration - 音频总时长（秒）。
 */

/**
 * @interface ITtsProvider
 * @description 统一的 TTS 供应商接口规范，所有适配器都应实现 `synthesize` 方法。
 */
export class ITtsProvider {
  // eslint-disable-next-line class-methods-use-this
  /**
   * 执行语音合成。
   * @param {string} _text - 输入文本。
   * @param {TtsSynthesizeOptions} [_options] - 可选参数。
   * @returns {Promise<TtsSynthesizeResult>} 合成结果。
   */
  async synthesize(_text, _options) {
    throw new Error('ITtsProvider 为抽象接口，请使用具体适配器实现。');
  }
}

