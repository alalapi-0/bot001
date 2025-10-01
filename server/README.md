# stickbot 服务端（第二轮）

本目录提供可运行的 Express 服务，接入 eSpeak NG 命令行，实现真实的语音合成与口型/逐词时间轴。服务端将音频写入临时目录，并通过 `/audio/:id` 提供下载，同时输出 `wordTimeline` 与 WebVTT 字幕文本。

## 快速启动

```bash
# 安装依赖
npm install

# 复制环境变量示例
cp .env.example .env

# 启动服务端（默认监听 8787）
npm run dev:server
```

> 若需要同时启动网页端，可运行 `npm run dev`，该命令会并行启动 `http-server` 与本服务端。

## 环境变量说明

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `TTS_PROVIDER` | `espeak` | 默认 TTS 供应器，可选 `espeak` 或 `azure`（需额外配置）。 |
| `ESPEAK_CMD` | `espeak-ng` | eSpeak NG 命令行名称或绝对路径。 |
| `ESPEAK_VOICE` | `zh` | 默认发音人，可填 `en-US`、`cmn` 等。 |
| `ESPEAK_RATE` | `170` | 默认语速（WPM），与 `espeak-ng -s` 参数一致。 |
| `TMP_DIR` | `./tmp` | 运行期临时目录，存放 `.wav` 与 `.pho`。 |
| `LOG_DIR` | `./logs` | 审计日志目录，每日生成 `<日期>.log`。 |
| `MAX_TEXT_LEN` | `5000` | 单次合成允许的最大字数，超过即返回 413。 |
| `RATE_LIMIT_RPS` | `5` | 全局每秒最多允许的合成请求数，超过返回 429。 |
| `MAX_CONCURRENCY` | `2` | 同时进行的合成任务上限，超过返回 429。 |
| `TTS_CACHE_MAX_ENTRIES` | `1000` | `/tts` 接口的内存缓存上限，超过后按照 LRU 淘汰旧条目。 |
| `TTS_CACHE_TTL_MS` | `3600000` | `/tts` 缓存的有效期（毫秒），默认 1 小时。 |
| `MOUTH_SAMPLE_RATE` | `80` | mouth 时间轴采样频率（Hz），建议 60–100。 |
| `CORS_WHITELIST` | 空 | 生产环境域名白名单，逗号分隔。 |
| `AZURE_REGION` | 空 | Azure 语音服务区域。 |
| `AZURE_KEY` | 空 | Azure 语音服务密钥。 |
| `VISEME_CONFIG_PATH` | 空 | 自定义口型映射 JSON 路径。 |

更多变量可参考根目录的 `.env.example`。

## eSpeak NG 安装指引

- **macOS**：`brew install espeak` 或 `brew install espeak-ng`
- **Ubuntu/Debian**：`sudo apt install espeak-ng`
- **Windows**：可通过 [winget](https://learn.microsoft.com/windows/package-manager/winget/) 安装 `espeak-ng`，或使用官方发行版，安装后将 `espeak-ng.exe` 加入 `PATH`。

服务端会调用如下命令生成音频与 `.pho` 文件：

```bash
espeak-ng -v zh -s 170 --pho --phonout tmp/<id>.pho -w tmp/<id>.wav "你好 stickbot"
```

## `.pho` 文件解析

`.pho` 是 MBROLA 控制文件，行格式形如：

```
; comment
sh 16 90
an 20 100
```

- 第一列为音素（phoneme）。
- 第二列为时长，单位为 **10ms**。
- 后续列为基频控制点，此处可忽略。

服务端会：

1. 读取每一行的音素与时长，并按顺序累计成时间轴。
2. 将音素映射为口型编号（viseme）。
3. 根据采样率（默认 80Hz）生成稀疏关键帧，同时按语言特性切分文本并分配逐词字幕时间轴。

## 口型映射（默认值）

### 音素 → 口型编号

| 口型 ID | 示例音素 | 说明 |
| --- | --- | --- |
| 0 | `p`、`b`、`m` | 闭唇爆破音 |
| 1 | `f`、`v` | 唇齿半开 |
| 2 | `t`、`d`、`s`、`z` | 齿龈接触 |
| 3 | `r`、`zh`、`ch`、`sh` | 卷舌/儿化 |
| 4 | `e`、`ə` | 中开央元音 |
| 5 | `o`、`ɔ`、`ŋ` | 中开圆唇 |
| 6 | `i`、`j`、`y` | 扁唇高元音 |
| 7 | `æ` | 大开前元音 |
| 8 | `a`、`ɑ` | 最大开口 |
| 9 | `u`、`ʊ` | 圆唇收紧 |

可通过 `VISEME_CONFIG_PATH` 指向自定义 JSON（包含 `phonemeToViseme` 与 `visemeToMouth` 字段）覆盖上述映射，适配更多语种。

### 口型编号 → mouth 数值

| 口型 ID | 默认 mouth |
| --- | --- |
| 0 | 0.05 |
| 1 | 0.22 |
| 2 | 0.32 |
| 3 | 0.40 |
| 4 | 0.52 |
| 5 | 0.60 |
| 6 | 0.45 |
| 7 | 0.70 |
| 8 | 0.92 |
| 9 | 0.62 |

mouth 值范围为 `[0,1]`，前端按照线性插值驱动“大嘴巴”头像的唇形、牙齿与嘴角角度。

## 缓存与并发去重

自第三轮起，`/tts` 接口会将合成结果缓存在内存中，键值由 `text + voice + rate + provider` 以及可选的分段标识组成。命中缓存时会直接返回已有的 `audioUrl` 与 `mouthTimeline`/`wordTimeline`，避免重复执行合成命令。对于正在进行的合成任务，服务器会将相同键值的请求挂载到同一个 Promise 上，待首个请求完成后共享结果，从而避免并发风暴。

- 可通过 `TTS_CACHE_MAX_ENTRIES` 控制 LRU 容量，默认 1000 条；超过后按最久未使用顺序淘汰。
- `TTS_CACHE_TTL_MS` 指定缓存条目过期时间，默认为 1 小时。若设置大于临时音频文件的清理周期，请同步调整 `TMP_FILE_TTL_MS`，确保音频链接仍然可用。
- 并发去重：相同键值的请求会挂载到首个合成 Promise 上，仅触发一次外部 TTS 调用，其余请求在 Promise resolve 后共享音频/时间轴结果，可有效避免雪崩式回放。
- 缓存命中与占用可在 `GET /metrics` 中查看：新增 `tts_cache_entries` 与 `tts_cache_bytes` 字段，便于粗略估算内存使用量（一般中文文本每条约 5–20KB）。

## Azure 适配示例

若需要启用 Azure 语音服务：

1. 安装 SDK：`npm install microsoft-cognitiveservices-speech-sdk`
2. 在 `.env` 中配置 `AZURE_REGION` 与 `AZURE_KEY`。
3. 将 `TTS_PROVIDER` 设置为 `azure`。
4. `server/src/tts/adapters/AzureAdapter.js` 中演示了如何监听 `VisemeReceived` 事件，并将 `audioOffset`（纳秒）转换为秒。

> 默认不会加载 Azure 适配器；若未安装 SDK 或未配置密钥，请保持 `TTS_PROVIDER=espeak`。

## API 说明

### `GET /tts`

请求参数：

- `text`（必填）：要合成的文本。
- `voice`（可选）：覆盖默认发音人。
- `rate`（可选）：语速（WPM），与 `espeak-ng -s` 对齐。
- `provider`（可选）：`espeak` 或 `azure`。

返回示例：

```json
{
  "audioUrl": "/audio/0f1d.wav",
  "audioType": "audio/wav",
  "mouthTimeline": [
    { "t": 0, "v": 0.05, "visemeId": 0, "phoneme": "sil" },
    { "t": 0.0125, "v": 0.32, "visemeId": 2, "phoneme": "t" }
  ],
  "wordTimeline": [
    { "tStart": 0, "tEnd": 0.6, "text": "你好" },
    { "tStart": 0.6, "tEnd": 1.84, "text": "stickbot" }
  ],
  "duration": 1.84,
  "provider": "espeak",
  "sampleRate": 80
}
```

前端会优先使用 `mouthTimeline`；若数组为空，会退回到 Web Speech 或音量包络分析。`wordTimeline` 为可选字段，主要用于逐词高亮字幕，也可作为 `GET /tts/vtt` 的缓存结果。

### `GET /tts/vtt`

- `text`（必填）：要合成的文本。
- `voice`、`rate`、`provider` 与 `/tts` 保持一致。

返回内容类型为 `text/vtt`，示例如下：

```
WEBVTT

1
00:00:00.000 --> 00:00:00.600
你好

2
00:00:00.600 --> 00:00:01.840
stickbot
```

该接口仅返回内存中的 WebVTT 文本，不会在临时目录写入音频，可用于导出逐词字幕或在前端直接粘贴。

### `GET /metrics`

返回纯文本指标，便于 Prometheus/脚本抓取：

```
active_synth=0
daily_synth_count=12
avg_synth_seconds=1.238
tmp_files=3
```

- `active_synth`：当前正在执行的合成任务数量。
- `daily_synth_count`：当日成功合成总次数（跨日自动清零）。
- `avg_synth_seconds`：当日合成耗时均值（壁钟时间，秒）。
- `tmp_files`：临时目录下文件总数，用于监控清理任务是否正常运行。
- `tts_cache_entries`：当前内存缓存条目数量。
- `tts_cache_bytes`：缓存估算占用的字节数。

### `GET /audio/:id`

下载运行期生成的 WAV 音频。文件会在 30 分钟后自动清理，可通过 `TMP_FILE_TTL_MS` 自定义过期时间。

### `POST /chat`

仍保留占位逻辑，便于后续接入真实对话模型。

## CORS 与安全

- 开发环境默认允许任意来源。若部署到公网，请在 `.env` 中设置 `CORS_ALLOW_ALL=false` 并配置 `CORS_WHITELIST`。
- 音频文件存放于 `TMP_DIR`，服务端会每隔 5 分钟清理一次过期资源。

## 安全与合规清单

- 已启用 [Helmet](https://helmetjs.github.io/) 设置常见 HTTP 安全响应头。
- `express.json`/`express.urlencoded` 请求体验证限制为 10KB，防止异常大请求拖垮服务。
- 通过环境变量控制的 `MAX_TEXT_LEN`、`RATE_LIMIT_RPS` 与 `MAX_CONCURRENCY` 防止滥用与突发并发。
- `/metrics` 端点暴露活跃合成数、当日次数、平均耗时与临时文件数，便于运行观测。
- 审计日志写入 `LOG_DIR`，逐条记录 provider、voice、字数、时长、时间轴点数、耗时与错误原因。
- 定期执行临时目录清理任务，确保敏感音频不过量保留。

## 与多端协作

- 网页端会根据 `mouthTimeline` 驱动“大嘴巴头”动画，Sprite 模式依赖同名 viseme 贴图。
- 微信小程序会使用 `/tts` 返回的时间轴，以 50–80ms 的间隔进行插值，保持与网页一致的口型效果。

