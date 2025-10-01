/**
 * @file config.js
 * @description 读取 stickbot 服务端的运行配置，涵盖 TTS 供应商、临时目录与口型映射等信息。
 *              由于项目坚持轻量化，这里不引入复杂的配置框架，而是以环境变量 + 默认值组合实现。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadVisemeConfig, DEFAULT_VISEME_CONFIG } from './tts/mapping.js';

/** @typedef {import('./tts/mapping.js').VisemeConfig} VisemeConfig */

/**
 * 解析项目根目录路径，便于在任何工作目录下都能正确定位 tmp/、配置文件等资源。
 * Node.js 的 ESM 环境中没有 __dirname，这里通过 fileURLToPath 计算。
 * @returns {string} 项目根目录的绝对路径。
 */
const resolveRootDir = () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..');
};

/**
 * 根据环境变量构建统一配置对象。
 * @returns {{
 *   port: number,
 *   defaultProvider: 'espeak' | 'azure',
 *   tmpDir: string,
 *   cleanupIntervalMs: number,
 *   cleanupTTL: number,
 *   sampleRate: number,
 *   espeak: {
 *     command: string,
 *     voice: string,
 *     rate: number,
 *   },
 *   azure: {
 *     region: string,
 *     key: string,
 *   },
 *   visemeConfig: VisemeConfig,
 *   cors: {
 *     enabled: boolean,
 *     allowAllOrigins: boolean,
 *     whitelist: string[],
 *   },
 *   limits: {
 *     maxTextLen: number,
 *     rateLimitRps: number,
 *     maxConcurrency: number,
 *   },
 *   logDir: string,
 * }} 完整的服务端配置。
 */
export const loadServerConfig = async () => {
  const rootDir = resolveRootDir();
  const tmpDir = path.resolve(rootDir, process.env.TMP_DIR || './tmp');
  const sampleRate = Number(process.env.MOUTH_SAMPLE_RATE || 80);
  const logDir = path.resolve(rootDir, process.env.LOG_DIR || './logs');

  const maxTextLen = Number(process.env.MAX_TEXT_LEN || 5000);
  const rateLimitRps = Number(process.env.RATE_LIMIT_RPS || 5);
  const maxConcurrency = Number(process.env.MAX_CONCURRENCY || 2);

  /**
   * 若设置了自定义 viseme 映射文件，则尝试解析；
   * 文件格式要求详见 server/README.md。读取失败时回退至默认映射。
   */
  const visemeConfig = loadVisemeConfig(process.env.VISEME_CONFIG_PATH, DEFAULT_VISEME_CONFIG);

  return {
    port: Number(process.env.STICKBOT_SERVER_PORT || 8787),
    defaultProvider: /** @type {'espeak' | 'azure'} */ (process.env.TTS_PROVIDER || 'espeak'),
    tmpDir,
    cleanupIntervalMs: Number(process.env.TMP_SWEEP_INTERVAL_MS || 5 * 60 * 1000),
    cleanupTTL: Number(process.env.TMP_FILE_TTL_MS || 30 * 60 * 1000),
    sampleRate,
    espeak: {
      command: process.env.ESPEAK_CMD || 'espeak-ng',
      voice: process.env.ESPEAK_VOICE || 'zh',
      rate: Number(process.env.ESPEAK_RATE || 170),
    },
    azure: {
      region: process.env.AZURE_REGION || '',
      key: process.env.AZURE_KEY || '',
    },
    visemeConfig,
    cors: {
      enabled: process.env.CORS_ENABLED ? process.env.CORS_ENABLED === 'true' : true,
      allowAllOrigins: process.env.CORS_ALLOW_ALL ? process.env.CORS_ALLOW_ALL === 'true' : process.env.NODE_ENV !== 'production',
      whitelist: process.env.CORS_WHITELIST ? process.env.CORS_WHITELIST.split(',').map((item) => item.trim()).filter(Boolean) : [],
    },
    limits: {
      maxTextLen: Number.isFinite(maxTextLen) && maxTextLen > 0 ? maxTextLen : 5000,
      rateLimitRps: Number.isFinite(rateLimitRps) && rateLimitRps > 0 ? rateLimitRps : 5,
      maxConcurrency: Number.isFinite(maxConcurrency) && maxConcurrency > 0 ? maxConcurrency : 2,
    },
    logDir,
  };
};

/**
 * 确保临时目录存在，若不存在则自动创建。
 * @param {string} tmpDir - 配置中指定的临时目录路径。
 */
export const ensureTmpDir = (tmpDir) => {
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
};

