# 服务端占位实现说明

本目录提供最小可运行的 Express 服务，用于支撑 stickbot 前端的回退策略，并作为后续对接真实 AI 能力的骨架。

## 当前接口

- `POST /chat`：回显传入的 `messages` 数组，仅作占位演示。
- `GET /tts`：返回文本说明，提示开发者接入真实 TTS 并提供口型时间轴。

## 接入真实 TTS 的步骤

1. **选择服务商**：可考虑 Azure Cognitive Services、科大讯飞、火山引擎、ElevenLabs 等，确保其 SDK 支持获取 viseme/phoneme 时间轴或至少提供音频流访问。
2. **在 `/tts` 中调用 TTS API**：
   - 将 `req.query.text` 作为合成文本。
   - 将音频缓存在对象存储/CDN，得到 `audioUrl`。
   - 从 TTS 回调或辅助算法中获得口型时间轴。
3. **构造响应**：

```json
{
  "audioUrl": "https://your-cdn/path/tts.mp3",
  "mouthTimeline": [
    { "t": 0.00, "v": 0.00 },
    { "t": 0.08, "v": 0.85 },
    { "t": 0.16, "v": 0.20 }
  ]
}
```

- `t` 为秒，`v` 为 0~1 的口型开合度。
- 若服务端可提供更精细的 viseme 序列，可进一步扩展字段。

## viseme → mouth 映射建议

| Viseme | 描述 | mouth 建议值 |
| --- | --- | --- |
| `sil` | 静音或闭口 | `0.0` |
| `a` / `aa` | 张大嘴 | `0.9` |
| `e` / `i` | 扁平嘴型 | `0.5` |
| `u` / `o` | 圆唇 | `0.7` |
| `m` / `b` / `p` | 双唇闭合 | `0.1` |

可对相邻点应用线性插值或样条插值，生成平滑的 `mouthTimeline`。

## CDN 与缓存建议

- 将生成的音频文件上传到支持 HTTPS 的对象存储（如 OSS、COS、S3），通过 CDN 加速跨区域访问。
- 根据文本与语音参数计算哈希，命中缓存时直接返回已生成的音频与时间轴，减少 TTS 调用成本。
- 对敏感文本做好鉴黄与合法性检测，避免滥用。

## 环境变量配置

- 在 `.env` 中新增 `TTS_API_ENDPOINT`、`TTS_API_KEY` 等字段。
- 在 `server.js` 中读取并传递给实际的 TTS SDK，切勿硬编码密钥到前端。

## 与小程序/多端协作

- 微信小程序不支持 Web Speech，必须依赖服务端时间轴。确保 `/tts` 同时返回 `audioUrl` 与 `mouthTimeline`。
- 如果需要多语种支持，可在请求中加入 `lang`/`voice` 等参数，由服务端统一处理。
