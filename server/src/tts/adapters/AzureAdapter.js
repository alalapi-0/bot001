/**
 * @file AzureAdapter.js
 * @description 演示如何接入 Azure Cognitive Services 的语音合成 SDK，包含 VisemeReceived 事件处理逻辑。
 *              本文件不会在默认流程中执行，仅作为示例。启用前请确保安装 `microsoft-cognitiveservices-speech-sdk` 并配置密钥。
 */

import path from 'path';
import { randomUUID } from 'crypto';
import { ensureTimelineFallback } from '../utils/timeline.js';
import { generateWordTimeline } from '../utils/wordTimeline.js';

/**
 * @typedef {import('../mapping.js').VisemeConfig} VisemeConfig
 */

/**
 * AzureAdapter 构造参数。
 * @typedef {Object} AzureOptions
 * @property {string} region - Azure 语音服务区域，例如 `eastasia`。
 * @property {string} key - Azure 语音服务密钥。
 * @property {string} tmpDir - 临时目录，用于写入生成的 WAV 文件。
 * @property {VisemeConfig} visemeConfig - 音素映射配置，用于将 viseme ID 转换为 mouth 值。
 */

/**
 * AzureAdapter 主要用于示例如何监听 VisemeReceived 事件以生成口型时间轴。
 */
export class AzureAdapter {
  /**
   * @param {AzureOptions} options - 构造参数。
   */
  constructor(options) {
    this.region = options.region;
    this.key = options.key;
    this.tmpDir = options.tmpDir;
    this.visemeConfig = options.visemeConfig;
  }

  /**
   * 语音合成。实际项目需处理 SSML、语速等参数，这里仅给出示例。
   * @param {string} text - 输入文本。
   * @returns {Promise<import('../ITtsProvider.js').TtsSynthesizeResult>} 结果。
   */
  async synthesize(text) {
    if (!this.region || !this.key) {
      throw new Error('未配置 Azure 区域或密钥，无法启用 AzureAdapter。');
    }

    // 动态引入 SDK，避免在未安装依赖时打包失败。
    let sdk;
    try {
      sdk = await import('microsoft-cognitiveservices-speech-sdk');
    } catch (error) {
      throw new Error('请先安装 `microsoft-cognitiveservices-speech-sdk` 依赖后再启用 Azure TTS。');
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(this.key, this.region);
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm;

    const audioId = randomUUID();
    const audioPath = path.join(this.tmpDir, `${audioId}.wav`);
    const audioConfig = sdk.AudioConfig.fromAudioFileOutput(audioPath);
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

    const timeline = [];
    const start = Date.now();

    /**
     * Azure SDK 在 VisemeReceived 事件中提供 `animation` 字段，表示 viseme ID；
     * `audioOffset` 为纳秒，需要转换为秒后再与 mouth 映射表匹配。
     */
    synthesizer.visemeReceived = (_s, event) => {
      const seconds = Number(event.audioOffset) / 1e7; // 纳秒 -> 秒
      const visemeId = Number(event.visemeId ?? event.viseme ?? 0);
      const mouth = this.resolveMouthFromViseme(visemeId);
      timeline.push({ t: seconds, v: mouth, visemeId, phoneme: `viseme-${visemeId}` });
    };

    await new Promise((resolve, reject) => {
      synthesizer.speakTextAsync(
        text,
        () => {
          synthesizer.close();
          resolve();
        },
        (error) => {
          synthesizer.close();
          reject(error);
        },
      );
    });

    const duration = (Date.now() - start) / 1000;
    const safeTimeline = ensureTimelineFallback(timeline);
    const lastTimelineTime = safeTimeline.length > 0 ? safeTimeline[safeTimeline.length - 1].t : 0;
    const totalDuration = Math.max(lastTimelineTime, duration);
    const wordTimeline = generateWordTimeline(text, totalDuration);

    return {
      id: audioId,
      audioPath,
      audioType: 'audio/wav',
      mouthTimeline: safeTimeline,
      wordTimeline,
      duration,
    };
  }

  /**
   * 根据 Azure 的 viseme ID 映射 mouth 值。Azure 的 viseme 与 eSpeak 不同，默认提供 22 个编号。
   * 这里给出简单示例：如需精细化控制可在 README 中提示如何调整。
   * @param {number} visemeId - Azure SDK 返回的口型编号。
   * @returns {number} mouth 值。
   */
  resolveMouthFromViseme(visemeId) {
    const mapping = {
      0: 0.05,
      1: 0.12,
      2: 0.25,
      3: 0.35,
      4: 0.45,
      5: 0.58,
      6: 0.7,
      7: 0.85,
    };
    return mapping[visemeId] ?? 0.3;
  }
}

