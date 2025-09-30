/**
 * @file index.js
 * @description 微信小程序首页，调用服务端 TTS 并根据 mouth 时间轴驱动“大嘴巴头”。
 */

const DEFAULT_SERVER_ORIGIN = 'http://localhost:8787';
const RENDER_MODES = ['Vector', 'Sprite'];
const PROVIDER_LABELS = ['espeak', 'azure'];
const TIMER_INTERVAL = 66; // 约 15 FPS，对应 60~80Hz 插值节奏

/**
 * 线性插值 mouth 时间轴。
 * @param {{ t: number, v: number, visemeId: number }[]} timeline - mouth 时间轴。
 * @param {number} time - 当前播放进度（秒）。
 * @returns {{ value: number, visemeId: number }} mouth 帧。
 */
function interpolateTimeline(timeline, time) {
  if (!timeline || timeline.length === 0) {
    return { value: 0.1, visemeId: 0 };
  }
  if (time <= timeline[0].t) {
    return { value: timeline[0].v, visemeId: timeline[0].visemeId };
  }
  for (let i = 1; i < timeline.length; i += 1) {
    const prev = timeline[i - 1];
    const next = timeline[i];
    if (time <= next.t) {
      const span = Math.max(next.t - prev.t, 1e-6);
      const ratio = (time - prev.t) / span;
      const value = prev.v + (next.v - prev.v) * ratio;
      const visemeId = ratio > 0.5 ? next.visemeId : prev.visemeId;
      return { value, visemeId };
    }
  }
  const last = timeline[timeline.length - 1];
  return { value: last.v, visemeId: last.visemeId };
}

Page({
  data: {
    text: '你好，我是 stickbot，大嘴巴头准备就绪！',
    providers: PROVIDER_LABELS,
    providerIndex: 0,
    renderModes: RENDER_MODES,
    renderModeIndex: 0,
    mouth: 0.1,
    mouthDisplay: '0.10',
    visemeId: 0,
    serverOrigin: '',
    spriteBasePath: '/assets/mouth',
  },
  /**
   * 生命周期函数：初始化画布、音频与服务端信息。
   */
  onLoad() {
    this.canvasCtx = wx.createCanvasContext('avatar');
    this.canvasWidth = 320;
    this.canvasHeight = 420;
    this.spriteCache = {};
    this.pendingSprites = {};
    this.timeline = [];
    this.timelineTimer = null;
    this.timelineStart = 0;

    this.innerAudio = wx.createInnerAudioContext();
    this.innerAudio.obeyMuteSwitch = false;
    this.innerAudio.onPlay(() => {
      this.startTimelineLoop();
    });
    this.innerAudio.onStop(() => {
      this.stopTimelineLoop();
    });
    this.innerAudio.onEnded(() => {
      this.stopTimelineLoop();
      this.resetMouth();
    });
    this.innerAudio.onError((err) => {
      console.error('播放失败', err);
      this.stopTimelineLoop();
      this.resetMouth();
    });

    this.drawAvatar();
    this.fetchProviders();
  },
  /**
   * 页面卸载时清理资源。
   */
  onUnload() {
    this.stopPlayback();
    if (this.innerAudio) {
      this.innerAudio.destroy();
    }
  },
  /**
   * 文本输入事件。
   * @param {WechatMiniprogram.TextareaInput} event - 输入事件对象。
   */
  onTextInput(event) {
    this.setData({ text: event.detail.value });
  },
  /**
   * 切换 TTS 供应器。
   * @param {WechatMiniprogram.PickerChange} event - 选择事件。
   */
  onProviderChange(event) {
    this.setData({ providerIndex: Number(event.detail.value) });
  },
  /**
   * 切换渲染模式。
   * @param {WechatMiniprogram.PickerChange} event - 选择事件。
   */
  onRenderModeChange(event) {
    this.setData({ renderModeIndex: Number(event.detail.value) });
    this.drawAvatar();
  },
  /**
   * 点击“开始合成”。
   */
  onSynthesize() {
    const text = this.data.text.trim();
    if (!text) {
      wx.showToast({ title: '请输入文本', icon: 'none' });
      return;
    }
    this.stopPlayback();
    wx.showLoading({ title: '合成中...' });
    this.requestTts(text)
      .then((result) => {
        if (!result.audioUrl) {
          wx.showToast({ title: '未返回音频', icon: 'none' });
          return;
        }
        this.timeline = result.mouthTimeline || [];
        this.innerAudio.src = this.resolveServerUrl(result.audioUrl);
        this.innerAudio.play();
      })
      .catch((error) => {
        console.error('请求 TTS 失败', error);
        wx.showToast({ title: 'TTS 请求失败', icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
  /**
   * 点击“停止”。
   */
  onStop() {
    this.stopPlayback();
  },
  /**
   * 停止音频与时间轴。
   */
  stopPlayback() {
    this.stopTimelineLoop();
    if (this.innerAudio && !this.innerAudio.paused) {
      this.innerAudio.stop();
    }
    this.resetMouth();
  },
  /**
   * 重置 mouth 状态并重绘。
   */
  resetMouth() {
    this.setData({ mouth: 0.1, mouthDisplay: '0.10', visemeId: 0 });
    this.drawAvatar();
  },
  /**
   * 调用服务端 `/tts`。
   * @param {string} text - 待合成文本。
   * @returns {Promise<{ audioUrl: string, mouthTimeline: { t: number, v: number, visemeId: number }[] }>} 结果。
   */
  requestTts(text) {
    const provider = this.data.providers[this.data.providerIndex];
    const origin = this.getServerOrigin();
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${origin}/tts`,
        method: 'GET',
        data: {
          text,
          provider,
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        },
        fail: reject,
      });
    });
  },
  /**
   * 获取服务端地址，可在 data.serverOrigin 中覆盖。
   * @returns {string} 服务端基础 URL。
   */
  getServerOrigin() {
    return this.data.serverOrigin || DEFAULT_SERVER_ORIGIN;
  },
  /**
   * 将相对路径转换为绝对 URL。
   * @param {string} path - 相对路径。
   * @returns {string} 完整 URL。
   */
  resolveServerUrl(path) {
    if (!path) return this.getServerOrigin();
    if (/^https?:/i.test(path)) {
      return path;
    }
    return `${this.getServerOrigin()}${path}`;
  },
  /**
   * 启动时间轴定时器，每 50~80ms 更新一次口型。
   */
  startTimelineLoop() {
    this.stopTimelineLoop();
    if (!this.timeline || this.timeline.length === 0) {
      return;
    }
    this.timelineStart = Date.now();
    this.timelineTimer = setInterval(() => {
      const elapsed = (Date.now() - this.timelineStart) / 1000;
      const frame = interpolateTimeline(this.timeline, elapsed);
      this.updateMouthFrame(frame.value, frame.visemeId);
      const lastTime = this.timeline[this.timeline.length - 1]?.t || 0;
      if (elapsed >= lastTime) {
        this.stopTimelineLoop();
      }
    }, TIMER_INTERVAL);
  },
  /**
   * 停止时间轴定时器。
   */
  stopTimelineLoop() {
    if (this.timelineTimer) {
      clearInterval(this.timelineTimer);
      this.timelineTimer = null;
    }
  },
  /**
   * 更新 mouth 并重绘。
   * @param {number} value - mouth 值。
   * @param {number} visemeId - 口型编号。
   */
  updateMouthFrame(value, visemeId) {
    const clamped = Math.max(0, Math.min(1, value));
    this.setData({
      mouth: clamped,
      mouthDisplay: clamped.toFixed(2),
      visemeId,
    });
    this.drawAvatar();
  },
  /**
   * 绘制火柴人 + 大嘴巴头。
   */
  drawAvatar() {
    const ctx = this.canvasCtx;
    if (!ctx) return;
    const mouth = this.data.mouth;
    const visemeId = this.data.visemeId;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    ctx.save();
    ctx.translate(this.canvasWidth / 2, this.canvasHeight / 2 + 40);
    ctx.setLineCap('round');
    this.drawBody(ctx);
    if (this.data.renderModes[this.data.renderModeIndex] === 'Sprite') {
      this.drawSpriteHead(ctx, mouth, visemeId);
    } else {
      this.drawVectorHead(ctx, mouth, visemeId);
    }
    ctx.restore();
    ctx.draw();
  },
  /**
   * 绘制身体。
   * @param {WechatMiniprogram.CanvasContext} ctx - 画布上下文。
   */
  drawBody(ctx) {
    const time = Date.now() / 1000;
    const swing = Math.sin(time * 1.5) * 0.22;
    const jitter = (Math.random() - 0.5) * 0.05 * (0.2 + this.data.mouth);
    ctx.setStrokeStyle('#1f2937');
    ctx.setLineWidth(6);

    ctx.beginPath();
    ctx.moveTo(0, -120);
    ctx.lineTo(0, 40);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -80);
    ctx.lineTo(-70, -80 + Math.sin(time * 1.5 + Math.PI / 4) * 32);
    ctx.moveTo(0, -80);
    ctx.lineTo(70, -80 + Math.sin(time * 1.5 + Math.PI + jitter) * 32);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.lineTo(-50, 140 + swing * 40);
    ctx.moveTo(0, 40);
    ctx.lineTo(50, 140 - swing * 40);
    ctx.stroke();
  },
  /**
   * 绘制矢量大嘴巴头。
   * @param {WechatMiniprogram.CanvasContext} ctx - 画布上下文。
   * @param {number} mouth - mouth 值。
   * @param {number} visemeId - 口型编号。
   */
  drawVectorHead(ctx, mouth, visemeId) {
    const headY = -150 - mouth * 8;
    const headRadius = 48;
    const mouthWidthBase = 70;
    const mouthHeight = 8 + mouth * 48;
    const rounded = Math.round(visemeId) === 9;
    const widthFactor = rounded ? 0.65 : 1;

    ctx.setLineWidth(5);
    ctx.setStrokeStyle('#111827');
    ctx.setFillStyle('#f9fafb');
    ctx.beginPath();
    ctx.arc(0, headY, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const eyeGap = 20;
    const eyeHeight = Math.max(2, 10 * (1 - Math.min(1, mouth * 1.4)));
    ctx.setLineWidth(4);
    ctx.beginPath();
    ctx.moveTo(-eyeGap, headY - 12);
    ctx.lineTo(-eyeGap, headY - 12 + eyeHeight);
    ctx.moveTo(eyeGap, headY - 12);
    ctx.lineTo(eyeGap, headY - 12 + eyeHeight);
    ctx.stroke();

    const mouthWidth = mouthWidthBase * widthFactor;
    const lipTopY = headY + 18;
    const lipBottomY = lipTopY + mouthHeight;
    const controlOffset = mouthHeight * 0.7;

    ctx.setLineWidth(6);
    ctx.setStrokeStyle('#ef4444');
    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipTopY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth * 0.4, lipTopY - controlOffset, mouthWidth, lipTopY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-mouthWidth, lipBottomY);
    ctx.bezierCurveTo(-mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth * 0.4, lipBottomY + controlOffset, mouthWidth, lipBottomY);
    ctx.stroke();

    ctx.setFillStyle('#7f1d1d');
    ctx.beginPath();
    ctx.moveTo(-mouthWidth + 3, lipTopY + 3);
    ctx.bezierCurveTo(-mouthWidth * 0.3, lipTopY + 3 - controlOffset * 0.8, mouthWidth * 0.3, lipTopY + 3 - controlOffset * 0.8, mouthWidth - 3, lipTopY + 3);
    ctx.lineTo(mouthWidth - 3, lipBottomY - 3);
    ctx.bezierCurveTo(mouthWidth * 0.3, lipBottomY - 3 + controlOffset * 0.8, -mouthWidth * 0.3, lipBottomY - 3 + controlOffset * 0.8, -mouthWidth + 3, lipBottomY - 3);
    ctx.closePath();
    ctx.fill();

    if (mouthHeight > 12) {
      ctx.setFillStyle('#fefce8');
      const toothCount = Math.min(6, Math.max(3, Math.floor(mouthWidth / 14)));
      const toothWidth = (mouthWidth * 1.8) / toothCount / 2;
      const toothHeight = Math.min(12, mouthHeight * 0.4);
      for (let i = 0; i < toothCount; i += 1) {
        const ratio = (i / (toothCount - 1)) * 2 - 1;
        const x = ratio * mouthWidth * 0.7;
        ctx.fillRect(x - toothWidth / 2, lipTopY + 2, toothWidth, toothHeight);
      }
    }

    if (rounded) {
      ctx.setStrokeStyle('#fca5a5');
      ctx.setLineWidth(2);
      ctx.beginPath();
      ctx.ellipse(0, (lipTopY + lipBottomY) / 2, mouthWidth * 0.7, mouthHeight * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  /**
   * 绘制 Sprite 头部，如无资源则回退至矢量模式。
   * @param {WechatMiniprogram.CanvasContext} ctx - 画布上下文。
   * @param {number} mouth - mouth 值。
   * @param {number} visemeId - 口型编号。
   */
  drawSpriteHead(ctx, mouth, visemeId) {
    const key = Math.round(visemeId);
    const cached = this.spriteCache[key];
    if (cached) {
      const headY = -180;
      const scale = 1 + mouth * 0.1;
      const width = cached.width * scale;
      const height = cached.height * scale;
      ctx.drawImage(cached.path, -width / 2, headY - height / 2, width, height);
      return;
    }
    if (!this.pendingSprites[key]) {
      this.pendingSprites[key] = true;
      const src = `${this.data.spriteBasePath}/v${key}.png`;
      wx.getImageInfo({
        src,
        success: (res) => {
          this.spriteCache[key] = { path: res.path, width: res.width, height: res.height };
          this.drawAvatar();
        },
        fail: () => {
          console.warn('未找到 Sprite 资源：', src);
        },
        complete: () => {
          this.pendingSprites[key] = false;
        },
      });
    }
    this.drawVectorHead(ctx, mouth, visemeId);
  },
  /**
   * 拉取服务端可用 provider。
   */
  fetchProviders() {
    const origin = this.getServerOrigin();
    wx.request({
      url: `${origin}/`,
      success: (res) => {
        const list = Array.isArray(res.data?.providers) ? res.data.providers : PROVIDER_LABELS;
        this.setData({ providers: list, providerIndex: 0 });
      },
      fail: () => {
        console.warn('获取 provider 列表失败');
      },
    });
  },
});
