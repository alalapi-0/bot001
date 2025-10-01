# stickbot

stickbot 是一个最小但可运行、易扩展的火柴人语音 Bot 项目骨架，第二轮更新完成后具备以下能力：

1. 服务端接入开源 eSpeak NG，返回真实音频、80Hz 口型时间轴与逐词 `wordTimeline`；
2. 网页端使用“大嘴巴头”形象，支持 Vector/Sprite 渲染与 TTS 供应器切换；
3. 微信小程序骨架可消费相同时间轴，实现跨端嘴型同步；
4. 聊天接口仍保留占位，实现后续与 LLM 的集成空间。
5. 新增 WebVTT 导出与逐词高亮字幕，方便录屏、编辑与外部工具接入。

## 快速开始

```bash
# 克隆仓库
git clone <repo-url> stickbot
cd stickbot

# 安装依赖（包含 http-server、npm-run-all、dotenv 等）
npm install
```

### 运行前端静态页面

```bash
npm run dev:web
```

访问 <http://localhost:5173>，即可看到火柴人画布、渲染模式切换与 TTS 供应器选择。

### 运行服务端占位接口

```bash
npm run dev:server
```

默认监听 `STICKBOT_SERVER_PORT`（`.env.example` 中为 8787），并在 `tmp/` 目录生成临时音频。可运行 `npm run clean:tmp` 清理缓存。

### 同时运行前后端

可以在两个终端分别运行上述命令，也可以执行：

```bash
npm run dev
```

此命令使用 `npm-run-all` 并行启动静态站点与服务端。

## 演示流程

1. 打开支持 Web Audio 的现代浏览器（Chrome 桌面版推荐）。
2. 在文本框输入待合成内容，选择 TTS 供应器（默认 eSpeak）与渲染模式（Vector/Sprite）。
3. 点击“朗读并演示”：
   - 若服务端返回 `mouthTimeline`，网页会下载音频并严格按照时间轴驱动嘴型；
   - 若服务端返回 `wordTimeline`，字幕条会逐词高亮，支持播放过程中拖动；
   - 否则将回退至 Web Speech 或音量包络分析，并在控制台提示当前策略；
4. 渲染模式可随时切换，Sprite 模式需在 `web/assets/mouth/` 下放置 `v0.png` 等贴图；
5. 滑条仍可调整语速、音调，mouth 进度条会实时展示当前张合度与 viseme。

逐词字幕还支持在网页面板粘贴 WebVTT 文本：勾选“使用手动 VTT”即可覆盖服务端结果，便于与外部字幕工具联调。若仅需字幕文本，可直接请求 `GET /tts/vtt`。

## 架构概览

```
文本输入 → main.js（请求 /tts、选择策略） → lipsync.js（时间轴插值 + MouthSignal）
    ↘                                           ↘
     Web Speech 脉冲                      innerAudio / AudioContext
                                             ↘
                                        BigMouthAvatar 渲染
```

## 部署建议

- **前端**：纯静态资源，可部署到 Netlify、Vercel、GitHub Pages 或任意静态托管服务。
- **服务端**：Express 应用可部署到 Render、Railway、Fly.io、Vercel Functions、阿里云函数计算等。部署时请通过 `.env` 配置真实 TTS/LLM 端点。

## CDN 接入示例

```html
<!-- 通过 ESM 模块方式拉取 core 包 -->
<script type="module">
  import { BigMouthAvatar } from 'https://cdn.jsdelivr.net/npm/@stickbot/core/dist/stickbot-core.esm.js';

  const canvas = document.querySelector('#stickbot-canvas');
  const avatar = new BigMouthAvatar(canvas);
  avatar.start();
  avatar.setMouthFrame({ value: 0.4, visemeId: 4, phoneme: 'E' });
</script>

<!-- 通过 IIFE 方式拉取 web component 包 -->
<script src="https://cdn.jsdelivr.net/npm/@stickbot/webcomp/dist/stickbot-webcomp.global.js"></script>
<script>
  if (!customElements.get('stick-bot')) {
    customElements.define('stick-bot', StickBotComponent);
  }
</script>
```

## 安全与合规提示

- 不要在前端硬编码任何私有 API Key。将敏感信息存储在服务端 `.env` 中，并通过代理接口调用。
- 对用户语音内容或聊天文本的存储需符合所在地隐私法规，必要时提供显式授权与删除机制。
- 若未来接入第三方 TTS 服务，需遵守其使用条款与速率限制，避免滥用。

## 路线图

**已完成**

1. eSpeak NG 开源 TTS 接入与口型时间轴。
2. 网页端“大嘴巴头”与 Vector/Sprite 渲染切换。
3. 微信小程序骨架接入口型时间轴。

**下一步**

1. 可插拔多语种映射表与 viseme 配置管理。
2. Sprite 资源打点与可视化校准工具。
3. 将嘴型与头部摇摆、表情能量耦合。
4. 对齐云存储/CDN 与缓存策略。
5. 封装成 SSR + WebComponent 形态，统一多端体验。

## 贡献

欢迎提交 Issue 与 Pull Request，共同完善 stickbot。

## 许可证

遵循 MIT License，详见 [LICENSE](LICENSE)。
