# Web 前端模块说明（第二轮）

网页端展示了“大嘴巴火柴人”动画，并根据服务端返回的 mouth 时间轴驱动唇形。项目仍为纯静态资源，可通过任意静态服务器托管。

## 目录结构

- **`index.html`**：页面骨架与样式，包含渲染模式、TTS 供应器选择等控件。
- **`tuner.html`**：可视化调参面板 Tuner，提供参数滑条、曲线叠加与 JSON 导入导出。
- **`js/main.js`**：入口脚本，负责：
  - 根据用户输入调用服务端 `/tts`，优先消费 `mouthTimeline`；
  - 管理 Web Speech / 音量包络回退，并处理停止逻辑；
  - 将长文本自动切分为多个片段，播放首段的同时在 70% 进度预取下一段；
  - 针对首段音频加载延迟应用轻量级口型补偿，使角色尽快出声；
  - 与 `BigMouthAvatar`、`MouthSignal` 协同更新 UI。
- **`js/avatar.js`**：实现 `BigMouthAvatar`，绘制火柴人身体 + 大嘴巴头，支持 Vector / Sprite 两种模式。
- **`js/lipsync.js`**：封装口型信号、时间轴插值与服务端请求，提供 `resolveServerUrl` 以跨源访问。
- **`js/mouth-capture.js`**：实验性的摄像头口型捕捉器，若检测到全局 `faceMesh` 库则使用唇部关键点估计。

## 角色档案与主题切换

- 页面右侧“角色档案”下拉框会调用服务端 `GET /roles` 拉取 JSON 档案，切换后自动应用：
  - `preset` 通过 `setExpressionOverride` 调整嘴角、眨眼与肢体幅度；
  - `voice` 作为 `/tts` 的默认 `voice` 参数，同时覆盖 Web Speech 兜底语种；
  - `renderMode` 与 `theme` 同步更新 Canvas 渲染模式与页面配色；
- 档案存放于仓库根目录 `roles/`，可随时新增/修改，浏览器会在刷新后读取；
- 浏览器会将最近一次选择保存在 `localStorage`，再次进入页面时自动恢复。

## 口型驱动优先级

1. **服务端时间轴**：`/tts` 返回 `mouthTimeline` 时，`main.js` 会创建 `<audio>` 元素播放 `audioUrl`，同时调用 `MouthSignal.playTimeline`，以 ~80Hz 的关键帧驱动嘴唇开合。
2. **Web Speech 边界事件**：若时间轴缺失且浏览器支持 `SpeechSynthesisUtterance`，则监听 `boundary` 事件触发脉冲，并衰减 mouth 值。
3. **音量包络分析**：服务端仅返回音频时，通过 Web Audio `AnalyserNode` 计算 RMS 映射到 mouth，保持基本的张合效果。
4. **占位时间轴**：以上途径均不可用时，会使用 `generatePlaceholderTimeline` 生成简易口型曲线，避免角色僵硬。

## 分段预取与延迟补偿

- 当输入文本较长时，前端会根据标点与字符长度自动拆分为 80–220 字左右的片段。首段合成完成后立即播放，同时在剩余时长的 70% 处触发下一段的请求，避免播放中断。
- 首段音频若因为网络或缓存尚未写盘而延迟，`TimelinePlayer` 会短暂使用 `performance.now()` 构造的虚拟时钟提前驱动嘴型，并在音频真正开始时对齐时间轴，默认等待 160ms、最长提前 320ms。
- 可通过 `window.STICKBOT_TIMELINE_PREFS.latencyCompensation` 微调补偿策略，例如在局域网部署时关闭，或提高 `maxLeadMs` 适配慢速云端存储。
- 可通过在页面加载前设置 `window.STICKBOT_TIMELINE_PREFS` 覆盖行为，例如：

  ```js
  window.STICKBOT_TIMELINE_PREFS = {
    segmentMode: 'auto',      // 取值 auto/off，关闭后始终整段请求
    segmentMinChars: 80,
    segmentMaxChars: 220,
    prefetchThreshold: 0.7,
    latencyCompensation: {
      enabled: true,
      thresholdMs: 160,
      maxLeadMs: 320,
    },
  };
  ```

- 页面下方的 `GET /metrics` 可配合服务端缓存观察命中率，前端 `TimelinePlayer` 的实现位于 `js/main.js`。

## 逐词字幕与 WebVTT

- `/tts` 现返回 `wordTimeline`，页面右侧面板会渲染逐词字幕条并根据音频 `currentTime` 高亮；
- 点击“使用手动 VTT”复选框可覆盖服务端字幕，支持直接粘贴 WebVTT 文本并即时预览；
- 若仅需字幕文件，可调用服务端 `GET /tts/vtt?text=...` 获取纯文本响应，无需下载音频；
- DOM 中每个词块都会创建 `<span>` 元素，建议在长段落中控制句长（例如 <200 词）以避免过多节点导致渲染抖动。

## 大嘴巴头像

- Vector 模式完全依赖 Canvas 绘制：
  - 上下唇由贝塞尔曲线构成，mouth 值越大，高度越高；
  - 牙齿使用多段短矩形表示，并随开口度调整数量与高度；
  - 口型 `visemeId = 9` 时额外绘制高光，模拟圆唇收紧效果。
- Sprite 模式按 `visemeId` 选择贴图：
  - 用户可在 `web/assets/mouth/` 目录放入 `v0.png` ~ `vN.png`（不在仓库提交）；
  - 切换到 Sprite 模式时会按编号加载图片，若资源缺失会自动回退到 Vector 模式；
  - 可通过 `avatar.configureSprite({ basePath, maxViseme })` 自定义路径与数量。

## TTS 供应器与跨域

- `main.js` 会自动探测服务端 `/` 返回的 `providers` 列表，未启用的项（如 Azure）会禁用选项。
- `lipsync.js` 的 `resolveServerUrl` 默认指向 `http://<当前主机>:8787`，可在浏览器全局注入 `window.STICKBOT_SERVER_ORIGIN` 覆盖。
- 开发环境推荐同时运行 `npm run dev:web` 与 `npm run dev:server`，确保前端可以跨域访问。

## Sprite 资源投放

```
web/
  assets/
    mouth/
      v0.png  # 闭口
      v1.png  # 半开
      ...
```

- 文件名中的数字应与口型 `visemeId` 一致（0~9 为默认映射）。
- 图片建议采用透明背景、相同分辨率，避免切换时抖动。
- 若只准备部分口型，缺失编号会自动回落到向量绘制。

## 调试建议

1. 运行 `npm run dev:web`，浏览器打开 `http://localhost:5173`。
2. 在控制面板查看 `TTS 供应器` 选项，确认服务端返回的 `mouthTimeline` 是否生效（控制台会输出 `[stickbot] 使用服务端时间轴驱动口型。`）。
3. 切换渲染模式观察差异，若 Sprite 未加载成功，会有提示信息。
4. 开发自定义口型映射时，可在控制台打印 `viseme` 与 `phoneme`（`main.js` 已在进度条旁显示）。

## 摄像头口型捕捉（实验）

- `index.html` 中新增“启用摄像头口型捕捉”开关，默认关闭，开启时浏览器会请求摄像头权限。
- `MouthCapture` 会优先检查是否存在全局 `faceMesh.FaceMesh`（或 `FaceMesh`）构造函数：
  - 若检测到，可使用唇部关键点（如 MediaPipe FaceMesh）计算 mouth 值，抖动明显降低；
  - 未检测到时会自动回退到亮度差分，占位驱动嘴型但稳定性较弱。
- 项目不内置关键点模型，若需更精准效果可在页面中自行通过 CDN 引入，例如：

  ```html
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh"></script>
  ```

- 摄像头模式仅在未播放服务端/本地音频时驱动火柴人；播放流程会临时暂停 webcam 信号以避免冲突。

## 可视化调参面板 Tuner

- 通过 `tuner.html` 打开调参页面：左侧为火柴人预览与 mouth 曲线叠加，右侧提供以下参数滑条：
  - `mouthOpenScale`：嘴巴张开倍数，用于放大整体口型；
  - `lipTension`：嘴唇收紧程度；
  - `cornerCurve`：嘴角弯曲程度，正值上扬、负值下压；
  - `eyeBlinkBias`：眨眼偏置，影响眨眼频率；
  - `headNodAmp`：点头动作幅度；
  - `swayAmp`：身体左右摆动幅度；
  - `emaAlpha`：口型 EMA 平滑系数；
  - `tickHz`：时间轴采样频率；
  - `roundLipCompress`：圆唇收紧系数，用于压缩高口型。
- 页面会将最新参数写入浏览器 `localStorage`，刷新后自动恢复。
- 导出 JSON：点击“导出 JSON”生成当前参数文本，可继续使用“复制 JSON”或“下载 JSON”保留文件。
- 从 JSON 粘贴导入：将外部预设粘贴到文本框中后点击按钮即可恢复参数。
- 若页面检测到 `<stick-bot>` 组件，会调用 `setExpressionOverride(preset)`；否则使用内置火柴人预览演示实时效果。

