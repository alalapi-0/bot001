# stickbot 服务端（第二轮）

本目录提供可运行的 Express 服务，接入 eSpeak NG 命令行，实现真实的语音合成与口型时间轴。服务端将音频写入临时目录，并通过 `/audio/:id` 提供下载。

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
3. 根据采样率（默认 80Hz）生成稀疏关键帧，最终返回给前端。

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
  "duration": 1.84,
  "provider": "espeak",
  "sampleRate": 80
}
```

前端会优先使用 `mouthTimeline`；若数组为空，会退回到 Web Speech 或音量包络分析。

### `GET /audio/:id`

下载运行期生成的 WAV 音频。文件会在 30 分钟后自动清理，可通过 `TMP_FILE_TTL_MS` 自定义过期时间。

### `POST /chat`

仍保留占位逻辑，便于后续接入真实对话模型。

## CORS 与安全

- 开发环境默认允许任意来源。若部署到公网，请在 `.env` 中设置 `CORS_ALLOW_ALL=false` 并配置 `CORS_WHITELIST`。
- 音频文件存放于 `TMP_DIR`，服务端会每隔 5 分钟清理一次过期资源。

## 与多端协作

- 网页端会根据 `mouthTimeline` 驱动“大嘴巴头”动画，Sprite 模式依赖同名 viseme 贴图。
- 微信小程序会使用 `/tts` 返回的时间轴，以 50–80ms 的间隔进行插值，保持与网页一致的口型效果。

