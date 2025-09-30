/**
 * @file EspeakAdapter.js
 * @description 通过调用 eSpeak NG 命令行将文本转换为音频与 `.pho` 口型文件，并解析为统一时间轴。
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mapPhonemeToViseme } from '../mapping.js';
import { accumulateSegments, ensureTimelineFallback, generateTimeline } from '../utils/timeline.js';

/**
 * @typedef {import('../mapping.js').VisemeConfig} VisemeConfig
 * @typedef {import('../utils/timeline.js').MouthKeyframe} MouthKeyframe
 */

/**
 * @typedef {Object} EspeakOptions
 * @property {string} command - eSpeak NG 命令名称或绝对路径，默认 `espeak-ng`。
 * @property {string} voice - 发音人 ID，例如 `zh`、`en-US`。
 * @property {number} rate - 语速，单位为 WPM，与命令行 `-s` 参数一致。
 * @property {string} tmpDir - 运行期临时目录，用于存放音频与 `.pho` 文件。
 * @property {number} sampleRate - mouth 时间轴采样率（Hz），建议 60-100。
 * @property {VisemeConfig} visemeConfig - 音素映射配置。
 */

/**
 * @typedef {Object} SynthesizeOptions
 * @property {string} [voice] - 可覆盖默认发音人。
 * @property {number} [rate] - 可覆盖默认语速。
 */

/**
 * @typedef {Object} EspeakResult
 * @property {string} id - 临时文件 ID，可用于拼接下载地址。
 * @property {string} audioPath - 音频文件在磁盘上的绝对路径。
 * @property {string} audioType - 音频类型，当前固定为 `audio/wav`。
 * @property {MouthKeyframe[]} mouthTimeline - 采样后的口型时间轴。
 * @property {number} duration - 总时长（秒）。
 */

/**
 * EspeakAdapter 负责封装 eSpeak NG 命令行调用及 `.pho` 解析流程。
 */
export class EspeakAdapter {
  /**
   * @param {EspeakOptions} options - 构造参数。
   */
  constructor(options) {
    this.command = options.command;
    this.voice = options.voice;
    this.rate = options.rate;
    this.tmpDir = options.tmpDir;
    this.sampleRate = options.sampleRate;
    this.visemeConfig = options.visemeConfig;
  }

  /**
   * 执行一次语音合成。
   * @param {string} text - 待合成的文本内容。
   * @param {SynthesizeOptions} [options] - 可覆盖默认语速/发音人。
   * @returns {Promise<EspeakResult>} 合成结果，包含音频路径与口型时间轴。
   */
  async synthesize(text, options = {}) {
    if (!text || !text.trim()) {
      throw new Error('文本不能为空。');
    }
    const trimmed = text.trim();
    const voice = options.voice || this.voice;
    const rate = options.rate || this.rate;
    const id = randomUUID();
    const wavPath = path.join(this.tmpDir, `${id}.wav`);
    const phoPath = path.join(this.tmpDir, `${id}.pho`);

    await this.runCommand(trimmed, { voice, rate, wavPath, phoPath });

    const segments = this.parsePho(phoPath);
    const { cumulative, totalDuration } = accumulateSegments(segments);
    const timeline = ensureTimelineFallback(generateTimeline(cumulative, totalDuration, this.sampleRate));

    // `.pho` 文件只在解析阶段使用，为避免目录堆积及时删除。
    await fs.promises.unlink(phoPath).catch(() => {});

    return {
      id,
      audioPath: wavPath,
      audioType: 'audio/wav',
      mouthTimeline: timeline,
      duration: totalDuration,
    };
  }

  /**
   * 调用 eSpeak NG 命令行生成音频与 `.pho` 文件。
   * @param {string} text - 输入文本。
   * @param {{ voice: string, rate: number, wavPath: string, phoPath: string }} params - 命令执行参数。
   * @returns {Promise<void>} 命令执行完成。
   */
  runCommand(text, params) {
    const args = [
      '-v',
      params.voice,
      '-s',
      String(params.rate),
      '--pho',
      '--phonout',
      params.phoPath,
      '-w',
      params.wavPath,
      text,
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, { stdio: 'ignore' });
      child.on('error', (error) => {
        reject(new Error(`无法调用 eSpeak NG，请确认命令是否安装并在 PATH 中。原始错误：${error.message}`));
      });
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`eSpeak NG 返回非零状态码：${code}`));
        }
      });
    });
  }

  /**
   * 解析 `.pho` 文件，将音素及时长转换为统一的口型片段。
   * `.pho` 行格式通常为：`phoneme duration pitch1 pitch2 ...`，其中 duration 为 10ms 单位。
   * @param {string} phoPath - `.pho` 文件绝对路径。
   * @returns {Array<{ phoneme: string, durationMs: number, visemeId: number, mouth: number }>} 口型片段数组。
   */
  parsePho(phoPath) {
    const content = fs.readFileSync(phoPath, 'utf-8');
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const segments = [];
    for (const line of lines) {
      if (line.startsWith(';')) {
        continue; // 注释行
      }
      const parts = line.split(/\s+/);
      if (parts.length < 2) {
        continue;
      }
      const phoneme = parts[0];
      const duration10ms = Number(parts[1]);
      if (!Number.isFinite(duration10ms) || duration10ms <= 0) {
        continue;
      }
      const durationMs = duration10ms * 10;
      const { visemeId, mouth } = mapPhonemeToViseme(phoneme, this.visemeConfig);
      segments.push({ phoneme, durationMs, visemeId, mouth });
    }
    return segments;
  }
}

