# Web 前端模块说明

该目录包含 stickbot 的纯静态网页演示，实现要点如下：

- **`index.html`**：构建左画布右控制面板的布局，引入 `main.js` 作为入口。
- **`js/avatar.js`**：封装画布绘制逻辑，负责火柴人骨架、眨眼、肢体摆动与口型渲染。
- **`js/lipsync.js`**：提供口型信号控制器，兼容 Web Speech 边界事件、Web Audio 能量包络与时间轴驱动。
- **`js/main.js`**：处理 UI 事件、拼装口型策略并与服务端占位接口通讯。

## 口型驱动原理

1. **Web Speech 优先**：浏览器支持 `SpeechSynthesisUtterance` 时，使用 `onboundary` 事件触发 `MouthSignal.pulse`，结合指数衰减实现自然开合。
2. **音量包络回退**：若 Web Speech 不可用，则 `fetchTtsFallback` 请求 `/tts`。当返回音频时，通过 Web Audio `AnalyserNode` 计算 RMS 能量，映射到 0~1 的 mouth 值。
3. **占位时间轴**：当前服务端仅返回文本提示时，`generatePlaceholderTimeline` 会基于字符数构造一个合成的 mouth 时间轴，让火柴人仍保持动态。

## 可调参数

| 模块 | 常量 | 建议范围 | 说明 |
| --- | --- | --- | --- |
| `avatar.js` | `blinkIntervalRange` | `[2, 5]` 秒 | 控制眨眼频率，范围越大越自然。 |
| `avatar.js` | `limbSwingAmplitude` | `0.1 ~ 0.4` | 肢体摆动幅度，配合语速可做轻微抖动。 |
| `avatar.js` | `mouthSmoothing` | `0.1 ~ 0.3` | 口型平滑系数，增大可减缓跳变。 |
| `lipsync.js` | `SIGNAL_CONFIG.decay` | `0.85 ~ 0.95` | 衰减速度，越小闭口越快。 |
| `main.js` | 语速滑条范围 | `0.5 ~ 2` | 直接映射到 Web Speech `rate`。 |

## 开发调试建议

1. 运行 `npm run dev:web` 启动静态服务器，浏览器打开 `http://localhost:5173`。
2. 在控制台关注 `[stickbot]` 前缀日志，以了解当前策略与错误信息。
3. 可在 `avatar.js` 中引入更多肢体状态（如抬手、点头），只需根据 mouth 值或时间驱动即可。
4. 准备接入真实 `mouthTimeline` 时，只需在 `main.js` 获取后调用 `mouthSignal.playEnvelope(timeline, performance.now())`，即可替换现有脉冲与包络策略。
