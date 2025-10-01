/**
 * @file server.js
 * @description stickbot 第二轮服务端入口：接入 eSpeak NG 生成真实音频与口型时间轴，并提供下载接口与清理任务。
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import { loadServerConfig, ensureTmpDir } from './src/config.js';
import { createProviders } from './src/tts/providerFactory.js';
import { generateWordTimeline } from './src/tts/utils/wordTimeline.js';

/**
 * 加载配置与初始化资源目录。
 */
const config = await loadServerConfig();
ensureTmpDir(config.tmpDir);
ensureTmpDir(config.logDir);
const providers = createProviders(config);
sweepTmpFiles();

const metricsState = {
  activeSynths: 0,
  dailyCount: 0,
  totalElapsedMs: 0,
  dayStamp: getDayStamp(),
};

const RATE_LIMIT_WINDOW_MS = 1000;
const requestTimestamps = [];

class AuditLogger {
  constructor(dir) {
    this.dir = dir;
  }

  async log(entry) {
    const now = new Date();
    const iso = now.toISOString();
    const day = iso.slice(0, 10);
    const filePath = path.join(this.dir, `${day}.log`);
    const duration = Number.isFinite(entry.durationSec) ? entry.durationSec.toFixed(3) : '0.000';
    const elapsed = Number.isFinite(entry.elapsedMs) ? entry.elapsedMs.toFixed(2) : '0.00';
    const sanitizedError = entry.error ? entry.error.replace(/\s+/g, ' ').slice(0, 200) : 'none';
    const line = [
      `[${iso}]`,
      `endpoint=${entry.endpoint}`,
      `provider=${entry.provider}`,
      `voice=${entry.voice ?? '-'}`,
      `chars=${entry.chars}`,
      `duration=${duration}`,
      `timelinePoints=${entry.timelinePoints}`,
      `elapsedMs=${elapsed}`,
      `error=${sanitizedError}`,
    ].join(' ');
    await fs.promises.appendFile(filePath, `${line}\n`);
  }
}

function getDayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDailyCounters() {
  const today = getDayStamp();
  if (metricsState.dayStamp !== today) {
    metricsState.dayStamp = today;
    metricsState.dailyCount = 0;
    metricsState.totalElapsedMs = 0;
  }
}

function recordSynthMetrics(elapsedMs) {
  ensureDailyCounters();
  metricsState.dailyCount += 1;
  metricsState.totalElapsedMs += Math.max(0, elapsedMs);
}

function consumeRateLimit() {
  const limit = config.limits.rateLimitRps;
  if (!Number.isFinite(limit) || limit <= 0) {
    return true;
  }
  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= limit) {
    return false;
  }
  requestTimestamps.push(now);
  return true;
}

function measureElapsedMs(start) {
  const diff = Number(process.hrtime.bigint() - start);
  return diff / 1e6;
}

const auditLogger = new AuditLogger(config.logDir);

/**
 * 初始化 Express 应用。
 */
const app = express();
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

/**
 * 本地开发默认允许任意来源跨域，生产环境可在 .env 中配置白名单。
 */
if (config.cors.enabled) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) {
      next();
      return;
    }
    let allowed = false;
    if (config.cors.allowAllOrigins) {
      allowed = true;
    } else if (config.cors.whitelist.includes(origin)) {
      allowed = true;
    }
    if (allowed) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

/**
 * 健康检查。
 */
app.get('/', (_req, res) => {
  res.json({
    name: 'stickbot-server',
    status: 'ok',
    providers: Object.keys(providers),
    tmpDir: config.tmpDir,
    sampleRate: config.sampleRate,
  });
});

/**
 * 聊天接口保留占位实现，确保第一轮调用仍能使用。
 */
app.post('/chat', (req, res) => {
  const { messages = [] } = req.body || {};
  res.json({
    reply: 'stickbot 第二轮：聊天接口仍为占位实现，请接入真实 LLM。',
    echo: messages,
    hint: '可在此处接入 OpenAI/智谱/通义千问等模型，注意密钥管理。',
  });
});

/**
 * 将临时目录下的音频暴露为下载路由，路径形如 `/audio/<uuid>.wav`。
 */
app.get('/audio/:filename', (req, res) => {
  const { filename } = req.params;
  if (!/^[a-z0-9-]+\.wav$/i.test(filename)) {
    res.status(400).json({ message: '非法文件名。' });
    return;
  }
  const filePath = path.join(config.tmpDir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ message: '文件不存在或已过期。' });
    return;
  }
  res.type('audio/wav');
  res.sendFile(filePath);
});

/**
 * 核心 TTS 接口：根据 provider 调用适配器并返回音频 URL 与 mouth 时间轴。
 */
app.get('/tts', async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text) {
    res.status(400).json({ message: 'text 参数不能为空。' });
    return;
  }
  const charCount = Array.from(text).length;
  if (charCount > config.limits.maxTextLen) {
    res.status(413).json({ message: `文本长度超出限制（最大 ${config.limits.maxTextLen} 字）。` });
    return;
  }

  const providerKey = /** @type {'espeak' | 'azure'} */ (req.query.provider || config.defaultProvider);
  const provider = providers[providerKey];
  if (!provider) {
    res.status(400).json({ message: `未找到 provider: ${providerKey}` });
    return;
  }
  const voice = req.query.voice ? String(req.query.voice) : undefined;
  const rate = req.query.rate ? Number(req.query.rate) : undefined;

  if (!consumeRateLimit()) {
    res.status(429).json({ message: '请求过于频繁，请稍后再试。' });
    return;
  }
  if (config.limits.maxConcurrency > 0 && metricsState.activeSynths >= config.limits.maxConcurrency) {
    res.status(429).json({ message: '当前合成请求过多，请稍后再试。' });
    return;
  }

  metricsState.activeSynths += 1;
  const started = process.hrtime.bigint();
  let result;
  try {
    result = await provider.synthesize(text, { voice, rate });
    const elapsedMs = measureElapsedMs(started);
    recordSynthMetrics(elapsedMs);
    auditLogger
      .log({
        endpoint: 'tts',
        provider: providerKey,
        voice,
        chars: charCount,
        durationSec: result.duration ?? 0,
        timelinePoints: Array.isArray(result.mouthTimeline) ? result.mouthTimeline.length : 0,
        elapsedMs,
        error: null,
      })
      .catch((error) => {
        console.warn('写入审计日志失败', error);
      });

    const audioFilename = `${result.id}.wav`;
    const audioUrl = `/audio/${audioFilename}`;

    res.json({
      audioUrl,
      audioType: result.audioType,
      mouthTimeline: result.mouthTimeline,
      wordTimeline: result.wordTimeline,
      duration: result.duration,
      provider: providerKey,
      sampleRate: config.sampleRate,
    });
  } catch (error) {
    const elapsedMs = measureElapsedMs(started);
    auditLogger
      .log({
        endpoint: 'tts',
        provider: providerKey,
        voice,
        chars: charCount,
        durationSec: result?.duration ?? 0,
        timelinePoints: Array.isArray(result?.mouthTimeline) ? result.mouthTimeline.length : 0,
        elapsedMs,
        error: error instanceof Error ? error.message : String(error),
      })
      .catch((logError) => {
        console.warn('写入审计日志失败', logError);
      });
    res.status(500).json({ message: 'TTS 处理失败', detail: error instanceof Error ? error.message : String(error) });
  } finally {
    metricsState.activeSynths = Math.max(0, metricsState.activeSynths - 1);
  }
});

/**
 * 将秒数格式化为 WebVTT 时间戳。
 * @param {number} seconds - 时间（秒）。
 * @returns {string} WebVTT 时间戳（HH:MM:SS.mmm）。
 */
const formatVttTimestamp = (seconds) => {
  const clamped = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalMs = Math.max(0, Math.round(clamped * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(ms, 3)}`;
};

/**
 * 新增 WebVTT 导出接口，返回逐词字幕文本，不落盘。
 */
app.get('/tts/vtt', async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text) {
    res.status(400).json({ message: 'text 参数不能为空。' });
    return;
  }
  const charCount = Array.from(text).length;
  if (charCount > config.limits.maxTextLen) {
    res.status(413).json({ message: `文本长度超出限制（最大 ${config.limits.maxTextLen} 字）。` });
    return;
  }

  const providerKey = /** @type {'espeak' | 'azure'} */ (req.query.provider || config.defaultProvider);
  const provider = providers[providerKey];
  if (!provider) {
    res.status(400).json({ message: `未找到 provider: ${providerKey}` });
    return;
  }
  const voice = req.query.voice ? String(req.query.voice) : undefined;
  const rate = req.query.rate ? Number(req.query.rate) : undefined;

  if (!consumeRateLimit()) {
    res.status(429).json({ message: '请求过于频繁，请稍后再试。' });
    return;
  }
  if (config.limits.maxConcurrency > 0 && metricsState.activeSynths >= config.limits.maxConcurrency) {
    res.status(429).json({ message: '当前合成请求过多，请稍后再试。' });
    return;
  }

  metricsState.activeSynths += 1;
  const started = process.hrtime.bigint();
  let synthResult;
  try {
    synthResult = await provider.synthesize(text, { voice, rate });
    const elapsedMs = measureElapsedMs(started);
    recordSynthMetrics(elapsedMs);
    auditLogger
      .log({
        endpoint: 'tts_vtt',
        provider: providerKey,
        voice,
        chars: charCount,
        durationSec: synthResult.duration ?? 0,
        timelinePoints: Array.isArray(synthResult.mouthTimeline) ? synthResult.mouthTimeline.length : 0,
        elapsedMs,
        error: null,
      })
      .catch((error) => {
        console.warn('写入审计日志失败', error);
      });

    const sourceTimeline = Array.isArray(synthResult.wordTimeline) ? synthResult.wordTimeline : [];
    const wordTimeline =
      sourceTimeline.length > 0 ? sourceTimeline : generateWordTimeline(text, synthResult.duration ?? 0);

    const blocks = wordTimeline.map((item, index) => {
      const start = formatVttTimestamp(item.tStart ?? item.t ?? 0);
      const end = formatVttTimestamp(item.tEnd ?? item.tStart ?? item.t ?? 0);
      const lines = String(item.text ?? '').trim() || '...';
      return `${index + 1}\n${start} --> ${end}\n${lines}`;
    });

    let body = 'WEBVTT\n\n';
    if (blocks.length > 0) {
      body += `${blocks.join('\n\n')}\n`;
    }
    res.type('text/vtt').send(body);
  } catch (error) {
    const elapsedMs = measureElapsedMs(started);
    auditLogger
      .log({
        endpoint: 'tts_vtt',
        provider: providerKey,
        voice,
        chars: charCount,
        durationSec: synthResult?.duration ?? 0,
        timelinePoints: Array.isArray(synthResult?.mouthTimeline) ? synthResult.mouthTimeline.length : 0,
        elapsedMs,
        error: error instanceof Error ? error.message : String(error),
      })
      .catch((logError) => {
        console.warn('写入审计日志失败', logError);
      });
    res
      .status(500)
      .json({ message: '生成 WebVTT 失败', detail: error instanceof Error ? error.message : String(error) });
  } finally {
    metricsState.activeSynths = Math.max(0, metricsState.activeSynths - 1);
    if (synthResult?.audioPath) {
      fs.promises.unlink(synthResult.audioPath).catch(() => {});
    }
  }
});

app.get('/metrics', async (_req, res) => {
  ensureDailyCounters();
  let tmpFileCount = 0;
  try {
    const entries = await fs.promises.readdir(config.tmpDir);
    tmpFileCount = entries.filter((name) => !name.startsWith('.')).length;
  } catch (error) {
    // 读取失败时忽略，保持默认值 0。
  }
  const avgSeconds = metricsState.dailyCount > 0 ? metricsState.totalElapsedMs / metricsState.dailyCount / 1000 : 0;
  const lines = [
    `active_synth=${metricsState.activeSynths}`,
    `daily_synth_count=${metricsState.dailyCount}`,
    `avg_synth_seconds=${avgSeconds.toFixed(3)}`,
    `tmp_files=${tmpFileCount}`,
  ];
  res.type('text/plain').send(lines.join('\n'));
});

/**
 * 定时清理临时目录，移除过期的音频文件。
 */
function sweepTmpFiles() {
  const now = Date.now();
  fs.promises
    .readdir(config.tmpDir)
    .then((files) => {
      files
        .filter((name) => name.endsWith('.wav') || name.endsWith('.pho'))
        .forEach((name) => {
          const filePath = path.join(config.tmpDir, name);
          fs.promises
            .stat(filePath)
            .then((stat) => {
              if (now - stat.mtimeMs > config.cleanupTTL) {
                fs.promises.unlink(filePath).catch(() => {});
              }
            })
            .catch(() => {});
        });
    })
    .catch(() => {});
}

setInterval(sweepTmpFiles, config.cleanupIntervalMs).unref();

/**
 * 启动服务器。
 */
app.listen(config.port, () => {
  // eslint-disable-next-line no-console -- Demo 项目允许直接输出日志
  console.log(`stickbot server listening on ${config.port}`);
});

