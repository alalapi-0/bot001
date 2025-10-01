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

## 角色档案

第二轮开始引入 `/roles/*.json` 角色档案，结合表情预设与主题皮肤实现“一键换人格”：

- 服务端会在启动时读取 `roles/` 目录，并暴露 `GET /roles` 与 `GET /roles/:id` 接口；
- 网页端、微信小程序会拉取该列表，切换时同步更新 voice、渲染模式、主题配色与 `setExpressionOverride`；
- 档案文件为纯文本 JSON，字段示例如下：

```json
{
  "id": "energetic",
  "name": "活力型",
  "description": "高能量动作与暖色主题，适合主持、口播等需要感染力的场景。",
  "voice": "zh",
  "preset": {
    "mouthOpenScale": 1.25,
    "lipTension": -0.2,
    "cornerCurve": 0.3,
    "eyeBlinkBias": 0.15,
    "headNodAmp": 0.6,
    "swayAmp": 0.55
  },
  "theme": "bright",
  "renderMode": "vector"
}
```

可按需增加更多角色（至少保留一个 `default`），修改后无需重启前端即可生效。

## 主题系统

- 根目录 `themes/` 存放纯 JSON 主题与 `manifest.json`：
  - `manifest.json` 指定默认主题 ID，并列出每个主题文件的相对路径；
  - 单个主题 JSON 支持如下字段：

    ```json
    {
      "id": "dark",
      "name": "午夜霓虹",
      "bg": "#0f172a",
      "stroke": "#e2e8f0",
      "fill": "#1e293b",
      "lineWidth": 6,
      "body": { "stroke": "#e2e8f0", "lineWidth": 6 },
      "head": { "stroke": "#38bdf8", "fill": "#1e293b", "lineWidth": 5 },
      "eye": { "stroke": "#38bdf8", "lineWidth": 4, "gap": 22, "minHeight": 1.5 },
      "mouth": {
        "stroke": "#0ea5e9",
        "lineWidth": 5.5,
        "fill": "#082f49",
        "innerFill": "#082f49",
        "toothFill": "#bae6fd",
        "toothCount": 4,
        "toothScale": 0.9,
        "widthScale": 0.95,
        "heightScale": 1.05,
        "cornerCurveBase": 0.04,
        "highlightStroke": "#38bdf8",
        "highlightWidth": 1.8,
        "roundedViseme": 10
      }
    }
    ```

  - `bg` 为画布背景色，`stroke`/`fill`/`lineWidth` 提供全局默认描边与线宽；
  - `body`、`head`、`eye` 可覆盖对应部位的颜色与线宽；
  - `mouth` 控制嘴部细节，包括宽高缩放、牙齿数量/颜色、嘴角基础弧度、圆唇高光、指定与高光相关的 `roundedViseme`；
  - 数值字段会在运行时自动夹紧（如线宽至少 1px、缩放范围 0.4~2.2），避免异常配置导致绘制溢出。
- Express 服务端会自动通过 `/themes` 暴露这些 JSON 文件，网页端与小程序首先读取 `manifest.json`，再按 `path` 拉取主题内容。
- 主题选择优先级：**页面手动选择 > 角色档案默认值 > Manifest 默认主题**，两端的渲染逻辑保持一致；若本地缓存的主题已被移除，将回退到默认主题并清除缓存。
- 新增主题只需在 `themes/` 中放置 JSON 文件并更新 `manifest.json`，无需重新构建即可在 web 与 weapp 端生效。

## 语义表情触发词典

- `packages/stickbot-core/src/emotion/semantic-triggers.ts` 内置 `deriveSemanticTimelines`，会根据文本、`estimateSentiment` 结果与 `wordTimeline` 推导 `emoteTimeline`、`gestureTimeline`；
- 默认词典已覆盖“哈哈/LOL”触发笑弧度、“？”抬眉、“！”点头等基础动作；
- 若需扩展，可在前端或小程序项目中新建 `lexicon/semantic.json` 并写入如下结构：

```json
[
  {
    "key": "swayBoost",
    "timeline": "gesture",
    "terms": ["摇摆", "swing"],
    "intensity": 0.8,
    "sustain": 1.2
  },
  {
    "key": "cornerCurve",
    "timeline": "emote",
    "terms": ["微笑"],
    "intensity": 0.4
  }
]
```

> 建议将词典 JSON 放在 `web/lexicon/semantic.json` 或 `weapp-stickbot/lexicon/semantic.json`，按需在构建脚本/页面中加载后传入 `deriveSemanticTimelines(text, sentiment, wordTimeline, dictionary)`。若词典直接输出 `cornerCurve` 等现有字段，将作为绝对值覆盖，其它键如 `smileBoost`、`browLift` 会以增量方式融合。

## 插件开发指南

- 核心包新增 `packages/stickbot-core/src/plugins/`，导出统一的 {@link StickBotPlugin} 接口：
  - `setup(ctx)` 在插件注册时调用，`ctx` 包含 `timeline`（{@link TimelinePlayer}）、`avatar`（{@link BigMouthAvatar}）、`bus`（`EventTarget`）与可选的 `options`；
  - `dispose()` 可选，用于移除监听、停止定时器等收尾操作；
- 宿主可通过事件总线协调多插件流程，核心内置事件常量 `StickBotPluginEvents`：
  - `timeline:prepare`：创建时间线前触发，插件可修改 `detail.timelineOptions` 注入 `expressionTimeline`、`emoteTimeline`、`autoGain` 等；
  - `mouth-capture:start` / `mouth-capture:stop`：请求 mouth 捕捉插件启动或停止，并通过 `detail.onFrame(value)` 推送 0-1 mouth 值；
  - `mouth-capture:status`：插件可回传当前模式（如 `placeholder`、`facemesh`）。
- 内置三个插件工厂函数可直接复用：
  - `semanticTriggersPlugin(options)`：依据文本、情绪估计与 `wordTimeline` 生成语义表情/手势时间轴；
  - `autoGainPlugin(options)`：确保 `TimelinePlayer` 启用自动增益，支持布尔或部分配置覆盖；
  - `mouthCapturePlugin(options)`：提供无需外部库的占位 mouth 捕捉，实现伪随机波动输出。
- 宿主（网页、小程序或自定义容器）在切换插件时应调用 `dispose()`，并保证即便全部插件关闭仍能维持基础 mouth 播放流程。

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

### Nginx 反代示例

- 若前端与服务端托管在同一台机器，可直接使用 `server/nginx.example.conf` 作为模版：
  1. 将静态目录（例如 `web/` 构建产物）同步到服务器上的 `/var/www/stickbot/web`；
  2. 调整示例中的 `root`、`server_name` 与端口，确认 Express 监听在 `127.0.0.1:8787`；
  3. 将配置文件拷贝到 `/etc/nginx/conf.d/stickbot.conf`，执行 `nginx -t` 校验后 `systemctl reload nginx`；
  4. 如需 HTTPS，可在 `server` 块中追加证书配置（`listen 443 ssl` 等），并删除示例内的注释跳转；
  5. 若部署在内网环境，可将 `server_name` 改为实际域名或直接使用 `_` 作为默认站点。
- 配置文件内包含 `/tts`、`/audio` 的反向代理以及音频缓存策略，若需要额外 API，可继续扩展 `location /api/`。
- 前端若通过 CDN 下发，可将 `/assets/` 缓存策略调大，或直接改为上游 CDN 域名。

### 常见故障排查清单

1. **前端访问 404 或无法加载静态资源**：确认 `root` 指向的路径下存在 `index.html`，并检查是否遗漏 `try_files $uri $uri/ /index.html;`。
2. **`/tts` 返回 502/504**：确认 Node 服务是否监听在 `127.0.0.1:8787`，必要时在 `.env` 中同步更新 `STICKBOT_SERVER_PORT` 并重启；同时检查防火墙或容器网络策略。
3. **音频无法播放或被重复拉取**：确保 `server/nginx.example.conf` 中的 `proxy_cache_path` 目录已创建且 Nginx 有写权限，可通过 `sudo mkdir -p /var/cache/nginx/stickbot && sudo chown www-data /var/cache/nginx/stickbot` 初始化。
4. **诊断叠层显示“请求中”不再变化**：检查浏览器控制台是否有跨域或 HTTPS 混用警告，必要时在前端 `window.STICKBOT_SERVER_ORIGIN` 中显式指定服务端地址。
5. **摄像头捕捉不可用**：确认页面已通过 HTTPS 访问，浏览器权限授权成功，诊断叠层中的“捕捉模式”需显示为 `faceMesh` 或 `亮度估计` 才表示驱动成功。

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
