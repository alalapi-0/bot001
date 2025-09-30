/**
 * @file server.js
 * @description stickbot 服务端占位实现，基于 Express 搭建，暴露 `/chat` 与 `/tts` 两个接口。
 * 设计目标：
 * 1. 结构足够简单，方便后续对接真实的大模型与 TTS 服务；
 * 2. 遵循 JSON/文本返回格式，让前端轻松消费；
 * 3. 保持大量中文注释，便于团队成员快速理解扩展点。
 */

import express from 'express';

/**
 * 读取端口号：默认 8787，可通过环境变量 `STICKBOT_SERVER_PORT` 覆盖。
 * 由于当前项目仅为占位 Demo，这里不引入 dotenv，直接读取 `process.env`。
 */
const PORT = Number(process.env.STICKBOT_SERVER_PORT || 8787);

/**
 * 创建 Express 应用实例，并挂载常用中间件。
 */
const app = express();
app.use(express.json());

/**
 * 根路由返回简单健康检查。
 */
app.get('/', (_req, res) => {
  res.json({
    name: 'stickbot-server',
    status: 'ok',
    message: '欢迎使用 stickbot 占位服务端，等待对接真实 TTS/LLM 能力。',
  });
});

/**
 * POST /chat 接口：当前仅回显请求，未来可接入大模型。
 */
app.post('/chat', (req, res) => {
  const { messages = [] } = req.body || {};
  res.json({
    reply: '这是 stickbot 的占位回复。请在 server/server.js 中对接真实聊天服务。',
    echo: messages,
    hint: '未来可将此处接入 OpenAI、智谱、通义千问等服务，注意通过 .env 管理密钥。',
  });
});

/**
 * GET /tts 接口：当前返回文本提示，告知开发者如何集成真实 TTS。
 * 真实环境应返回音频 URL 与 mouthTimeline，格式示例见 server/README.md。
 */
app.get('/tts', (req, res) => {
  const { text = '' } = req.query;
  res.type('text/plain').send(`stickbot TTS 占位接口已接收到文本：${text}\n请替换为真实 TTS 服务并返回音频 URL 与 mouthTimeline。`);
});

/**
 * 启动服务器并输出日志。
 */
app.listen(PORT, () => {
  // eslint-disable-next-line no-console -- 演示项目允许直接打印
  console.log(`stickbot server 已启动，监听端口 ${PORT}`);
});
