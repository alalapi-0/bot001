# stickbot 架构设计说明

本文档描述 stickbot 项目的整体架构、数据流、边界条件与未来扩展方向，帮助团队快速理解如何演进至生产级体验。

## 整体组件

```
┌──────────────────────┐        ┌─────────────────────┐        ┌─────────────────────────┐
│ Web 前端 (web/)      │        │ 微信小程序 (weapp)   │        │ 服务端 (server/)        │
│ • BigMouthAvatar     │        │ • Canvas 火柴人      │        │ • Express + eSpeak NG   │
│ • MouthSignal        │        │ • innerAudioContext  │        │ • /tts 生成音频+时间轴   │
│ • 渲染模式切换       │        │ • 时间轴插值          │        │ • /audio 提供下载        │
└────────────┬─────────┘        └────────────┬────────┘        └────────────┬────────────┘
             │ mouthTimeline/音频                         │ mouthTimeline/音频          │ eSpeak CLI
             └────────────────────────────────────────────┴─────────────────────────────┘
```

## 数据流

1. 用户在网页端或小程序输入文本并请求合成。
2. 前端调用 `/tts`，服务端执行：
   - 调用 `espeak-ng` 生成 `tmp/<uuid>.wav` 与 `tmp/<uuid>.pho`；
   - 解析 `.pho` 中的音素与时长，映射至 viseme，并以 80Hz 采样成 `mouthTimeline`；
   - 返回 `{ audioUrl, mouthTimeline, provider }`。
3. 前端根据响应执行优先级：
   - 若 `mouthTimeline` 存在，创建音频播放器与 `MouthSignal.playTimeline`；
   - 结合 `deriveSemanticTimelines` 解析原始文本与 `wordTimeline`，生成 `emoteTimeline`、`gestureTimeline`；
   - 否则回退到 Web Speech（仅限浏览器）或音量包络分析；
4. 动画层（BigMouthAvatar 或小程序 Canvas）根据 `TimelinePlayer` 融合后的表情参数绘制：
   - `mouthTimeline` 负责嘴型插值；
   - `emoteTimeline` 改变嘴角弧度、眼睑开合；
   - `gestureTimeline` 调整点头、身体摇摆等动作；
5. 服务端周期性清理临时音频，`/chat` 仍保留占位实现以待后续接入 LLM。

### 时序图

```
用户输入 → main.js → requestServerTts → Express /tts
    → eSpeak CLI (--pho) → 解析 .pho → 生成 mouthTimeline
    → 返回 JSON → 浏览器创建 Audio 元素/innerAudioContext → MouthSignal.playTimeline
    → deriveSemanticTimelines → TimelinePlayer 融合 emote/gesture → BigMouthAvatar/Canvas 绘制
    → 用户看到嘴型与表情/手势同步
```

## 兼容性矩阵

| 平台 | Web Speech 支持 | Web Audio/音频支持 | mouthTimeline 建议 |
| --- | --- | --- | --- |
| Chrome 桌面 | ✅ | ✅ | 优先使用服务端时间轴，必要时回退 Web Speech。 |
| Safari macOS | ⚠️（需手动授权） | ✅ | 同 Chrome，注意首次播放需用户交互。 |
| Firefox | ❌ | ✅ | 始终请求 `/tts`，使用时间轴或音量包络。 |
| Edge Chromium | ✅ | ✅ | 行为与 Chrome 一致。 |
| 微信小程序 | ❌ | ✅（InnerAudioContext） | 必须依赖 `/tts` 返回的时间轴。 |

> 备注：⚠️ 表示该功能存在可用性差异，需要在 UI 上做提示。

## 回退策略的精度与性能取舍

- **Web Audio RMS**：实现简单、无需额外依赖，但仅能估计嘴巴开合程度，缺乏精细 viseme 区分。
- **服务端 mouthTimeline**：提供语素级控制，精度高，可跨端复用；需注意临时文件清理与网络延迟。
- **占位时间轴**：保证演示效果，即使无音频也有动画；正式上线后应只作为兜底方案。

## 小程序端扩展

- **现状**：`weapp-stickbot/` 已提供最小骨架，使用 `innerAudioContext` + Canvas 绘制大嘴巴头像。
- **差异**：
  1. 仅支持服务端时间轴，不再回退 Web Speech；
  2. Sprite 模式依赖 `assets/mouth/v{n}.png`，缺失时回退 Vector；
  3. 定时器默认 66ms，可根据设备性能调整。

## 数据形象渲染管线建议

- 当前仅绘制火柴人，未来可抽象成“骨骼 + 蒙皮”或“矢量表情”管线：
  - 定义统一的 `MouthValue`、`EyeBlink`、`BodyPose` 数据结构；
  - 支持替换成 SVG、Lottie、Three.js 等不同渲染器；
  - 提供配置驱动的主题（颜色、表情、配件）。

## 语义触发到表情融合

语义触发模块 `semantic-triggers.ts` 使用原始文本、`estimateSentiment` 结果与 `wordTimeline` 推导表情包与手势时间轴：

1. 对输入文本执行低开销的词典匹配，默认词典覆盖笑声、问号、感叹号等关键词；
2. 若提供逐词时间轴，会使用词块的中点时间作为触发点，否则按字符位置推算时间；
3. 结合情绪标签（positive/question/excited）补充基础动作，例如积极文本自动加一点笑弧度；
4. `TimelinePlayer` 将 `emoteTimeline`、`gestureTimeline` 与常规表情关键帧融合，映射成 `AvatarExpressionParams`。

| 时间轴类型 | 键值 (`k`)       | 作用说明                           | 建议取值范围 |
| -------- | ---------------- | ---------------------------------- | ------------ |
| emote    | `smileBoost`      | 嘴角上扬并略微放松嘴唇紧绷         | 0~1          |
| emote    | `browLift`        | 提升眉眼开合，减少眨眼概率         | 0~1          |
| gesture  | `headNod`         | 增加点头幅度，适合强调语气         | 0~1          |
| gesture  | `swayBoost`*      | 额外身体摇摆（可在自定义词典中启用）| 0~1          |

> 说明：带星号的键默认为空，可通过自定义词典添加。若词典直接输出 `cornerCurve`、`headNodAmp` 等现有字段，则会作为绝对值覆盖。

## 扩展路线

1. **服务端**：引入消息队列或缓存（Redis）管理生成请求，提供鉴权与速率限制。
2. **前端**：将 `MouthSignal` 抽象成可重用类，发布到 npm，方便多项目复用。
3. **多端统一**：通过协议文档规定 `/tts` 的请求与响应字段，确保 Web、微信小程序、未来的原生端共享一套接口。
