# stickbot 微信小程序骨架（第二轮）

本目录提供可运行的小程序页面骨架，负责请求服务端 `/tts` 并播放返回的音频。核心目标：

1. 使用 `innerAudioContext` 播放服务端生成的 WAV；
2. 以 50~80ms 的间隔根据时间轴插值当前 mouth 值，驱动画布上的“大嘴巴头”；
3. 支持 Vector 与 Sprite 两种渲染模式，便于自定义贴图。

## 目录结构

- `app.js` / `app.json` / `app.wxss`：全局配置。
- `pages/index`：主页面，实现文本输入、TTS 调用与口型渲染。
- `assets/`（可选）：用户可自行放置 `mouth/v0.png` 等贴图文件。

## 使用步骤

1. 在小程序管理后台添加合法域名（开发环境可勾选“开发阶段忽略”），确保包含 `http://localhost:8787` 或部署地址。
2. `npm install` 并运行 `npm run dev:server`，确认服务端 `/tts` 正常返回 `audioUrl` 与 `mouthTimeline`。
3. 使用微信开发者工具导入 `weapp-stickbot` 目录，真机或模拟器运行。
4. 若服务端域名非默认 `http://localhost:8787`，可在 `pages/index/index.js` 的 `data.serverOrigin` 中设置为 HTTPS 正式地址。

## 接口约定

服务端 `/tts` 返回格式需包含：

```json
{
  "audioUrl": "/audio/<uuid>.wav",
  "mouthTimeline": [
    { "t": 0, "v": 0.05, "visemeId": 0 },
    { "t": 0.0125, "v": 0.32, "visemeId": 2 }
  ],
  "provider": "espeak",
  "sampleRate": 80
}
```

小程序会将 `audioUrl` 拼接到服务端域名，并使用 `mouthTimeline` 驱动口型；若数组为空，将回退到默认嘴型（嘴巴轻微开合）。

## 时间轴消费策略

- `interpolateTimeline` 会对时间轴进行线性插值：
  - 若 `time` 落在 `[t_i, t_{i+1}]`，采用 `v_i + (v_{i+1}-v_i)*ratio` 计算当前 mouth；
  - `visemeId` 采用距离更近的一个，避免频繁切换。
- 定时器使用 `setInterval`，周期约 66ms（15FPS），可根据性能调节 `TIMER_INTERVAL`。
- 播放结束或用户点击停止时会调用 `stopTimelineLoop()`，清理定时器并重置口型。
- `wordTimeline` 会同步传入，通过 `getWordAtTime` 在底部字幕条展示当前词块。

## 逐词字幕

- 页面底部新增半圆形字幕条，展示当前词块文本；
- `/tts` 返回的 `wordTimeline` 自动驱动字幕，若无数据会保持空白；
- 可根据实际需求缩短文本或增大 `TIMER_INTERVAL`，避免在低端设备上频繁触发 `setData`；
- 需要导出字幕时，可在服务端调用 `GET /tts/vtt` 或直接在网页端粘贴 WebVTT，再将同样的时间轴同步至小程序。

## 渲染模式

- **Vector 模式**：使用 Canvas 绘制火柴人身体与大嘴巴头：
  - 上唇/下唇为贝塞尔曲线，牙齿由短矩形组成；
  - `visemeId = 9`（圆唇类）会绘制额外椭圆高光；
  - `mouth` 值控制嘴巴高度、头部轻微浮动。
- **Sprite 模式**：
  - 尝试加载 `spriteBasePath`（默认 `/assets/mouth`）下的 `v0.png ~ vN.png`；
  - 若对应文件不存在，会回退到 Vector 模式并在控制台提示；
  - 建议贴图尺寸一致且背景透明。

## 性能建议

- `innerAudioContext` 默认 `obeyMuteSwitch=false`，可根据需求调整。
- 若时间轴较长，可将 `TIMER_INTERVAL` 调整为 50ms 提升跟随精度，或适当增大以降低耗电。
- 在弱性能设备上，可将 Canvas 尺寸降低至 `240x320` 并减小线宽。

## 域名配置

- **开发阶段**：可在微信开发者工具的“详情 → 本地设置”勾选“忽略合法域名校验”，指向本地 `http://localhost:8787`。
- **生产部署**：需在微信公众平台配置 HTTPS 域名，并在服务器启用 CORS 白名单，确保 `wx.request` 可以访问 `/tts` 与 `/audio`。

