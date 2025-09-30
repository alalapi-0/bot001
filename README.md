# stickbot

stickbot 是一个最小但可运行、易扩展的火柴人语音 Bot 项目骨架，目标是：

1. 在网页端通过 `<canvas>` 绘制火柴人并驱动基础口型同步；
2. 服务端提供占位的聊天与语音合成接口，便于后续接入真实 AI 能力；
3. 未来扩展到微信小程序与可复用组件形式。

## 快速开始

```bash
# 克隆仓库
git clone <repo-url> stickbot
cd stickbot

# 安装依赖（提供 http-server 与 npm-run-all）
npm install
```

### 运行前端静态页面

```bash
npm run dev:web
```

访问 <http://localhost:5173>，即可看到火柴人画布与控制面板。

### 运行服务端占位接口

```bash
npm run dev:server
```

默认监听 `STICKBOT_SERVER_PORT`（`.env.example` 中为 8787）。开启后网页端的回退 TTS fetch 会请求 `http://localhost:8787/tts`。

### 同时运行前后端

可以在两个终端分别运行上述命令，也可以执行：

```bash
npm run dev
```

此命令使用 `npm-run-all` 并行启动静态站点与服务端。

## 演示流程

1. 打开支持 Web Speech API 的浏览器（Chrome 桌面版推荐）。
2. 在右侧文本框输入要朗读的内容，保持“使用浏览器 Web Speech”复选框勾选。
3. 点击“朗读并演示”，浏览器会使用 `SpeechSynthesis` 发声，同时通过 `onboundary` 事件触发口型开合，火柴人肢体会缓慢摆动，眼睛会随机眨动。
4. 如果浏览器不支持 Web Speech 或想测试回退策略，请取消勾选。“朗读并演示”会改为调用服务端 `/tts` 接口；当前仅返回一段说明文本，并用简单包络生成器模拟口型（不会尝试下载二进制文件）。
5. 可用滑条调整语速与音调，观察口型幅度进度条实时变化。

## 架构概览

```
+-------------+      +----------------+      +----------------+      +-----------------+
| 文本输入框  | ---> | main.js 业务层 | ---> | lipsync.js 口型信号 | ---> | avatar.js 画布渲染 |
+-------------+      +----------------+      +----------------+      +-----------------+
        |                          |                     |                     |
        |                          |                     |                     |
        v                          v                     v                     v
  SpeechSynthesis API       /tts 占位接口       mouthTimeline/音量包络      <canvas> 火柴人动画
```

## 部署建议

- **前端**：纯静态资源，可部署到 Netlify、Vercel、GitHub Pages 或任意静态托管服务。
- **服务端**：Express 应用可部署到 Render、Railway、Fly.io、Vercel Functions、阿里云函数计算等。部署时请通过 `.env` 配置真实 TTS/LLM 端点。

## 安全与合规提示

- 不要在前端硬编码任何私有 API Key。将敏感信息存储在服务端 `.env` 中，并通过代理接口调用。
- 对用户语音内容或聊天文本的存储需符合所在地隐私法规，必要时提供显式授权与删除机制。
- 若未来接入第三方 TTS 服务，需遵守其使用条款与速率限制，避免滥用。

## 路线图

1. 服务端接入真实 TTS，返回 audioUrl 与 mouthTimeline。
2. 网页端优先消费 mouthTimeline，再退回 Web Speech 与音量包络。
3. 新建 `/weapp-stickbot` 目录，提供小程序最小可运行画布火柴人与时间轴消费器的骨架。
4. 将前端封装成可复用的 Web Component（`<stick-bot>`）与小程序自定义组件。

## 贡献

欢迎提交 Issue 与 Pull Request，共同完善 stickbot。

## 许可证

遵循 MIT License，详见 [LICENSE](LICENSE)。
