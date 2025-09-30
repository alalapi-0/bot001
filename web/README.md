# Web 前端模块说明（第二轮）

网页端展示了“大嘴巴火柴人”动画，并根据服务端返回的 mouth 时间轴驱动唇形。项目仍为纯静态资源，可通过任意静态服务器托管。

## 目录结构

- **`index.html`**：页面骨架与样式，包含渲染模式、TTS 供应器选择等控件。
- **`js/main.js`**：入口脚本，负责：
  - 根据用户输入调用服务端 `/tts`，优先消费 `mouthTimeline`；
  - 管理 Web Speech / 音量包络回退，并处理停止逻辑；
  - 与 `BigMouthAvatar`、`MouthSignal` 协同更新 UI。
- **`js/avatar.js`**：实现 `BigMouthAvatar`，绘制火柴人身体 + 大嘴巴头，支持 Vector / Sprite 两种模式。
- **`js/lipsync.js`**：封装口型信号、时间轴插值与服务端请求，提供 `resolveServerUrl` 以跨源访问。

## 口型驱动优先级

1. **服务端时间轴**：`/tts` 返回 `mouthTimeline` 时，`main.js` 会创建 `<audio>` 元素播放 `audioUrl`，同时调用 `MouthSignal.playTimeline`，以 ~80Hz 的关键帧驱动嘴唇开合。
2. **Web Speech 边界事件**：若时间轴缺失且浏览器支持 `SpeechSynthesisUtterance`，则监听 `boundary` 事件触发脉冲，并衰减 mouth 值。
3. **音量包络分析**：服务端仅返回音频时，通过 Web Audio `AnalyserNode` 计算 RMS 映射到 mouth，保持基本的张合效果。
4. **占位时间轴**：以上途径均不可用时，会使用 `generatePlaceholderTimeline` 生成简易口型曲线，避免角色僵硬。

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

