/**
 * @file providerFactory.js
 * @description 根据配置创建不同的 TTS 供应商实例，并提供统一的查找接口。
 */

import { EspeakAdapter } from './adapters/EspeakAdapter.js';
import { AzureAdapter } from './adapters/AzureAdapter.js';

/**
 * @typedef {import('./ITtsProvider.js').ITtsProvider} ITtsProvider
 * @typedef {import('../config.js').loadServerConfig} loadServerConfig
 */

/**
 * 创建 provider 映射表。
 * @param {Awaited<ReturnType<import('../config.js').loadServerConfig>>} config - 服务端配置。
 * @returns {Record<string, ITtsProvider>} provider 实例集合。
 */
export const createProviders = (config) => {
  const providers = {
    espeak: new EspeakAdapter({
      command: config.espeak.command,
      voice: config.espeak.voice,
      rate: config.espeak.rate,
      tmpDir: config.tmpDir,
      sampleRate: config.sampleRate,
      visemeConfig: config.visemeConfig,
    }),
  };

  if (config.azure.key && config.azure.region) {
    providers.azure = new AzureAdapter({
      region: config.azure.region,
      key: config.azure.key,
      tmpDir: config.tmpDir,
      visemeConfig: config.visemeConfig,
    });
  }

  return providers;
};

