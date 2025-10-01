/**
 * @file mouth-capture.js
 * @description 可选的摄像头口型捕捉逻辑。若检测到外部 faceMesh 库则使用关键点估计，否则退回亮度差分占位策略。
 */

const DEFAULT_CANVAS_SIZE = 96;

/**
 * @typedef {'idle' | 'facemesh' | 'luma'} MouthCaptureMode
 */

export class MouthCapture {
  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;

    this.canvas = document.createElement('canvas');
    this.canvas.width = DEFAULT_CANVAS_SIZE;
    this.canvas.height = DEFAULT_CANVAS_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    /** @type {MediaStream|null} */
    this.stream = null;
    /** @type {number|null} */
    this.frameHandle = null;
    /** @type {Promise<void>|null} */
    this._pendingFaceMesh = null;
    /** @type {(value: number) => void} */
    this._onMouth = () => {};
    /** @type {number|null} */
    this.prevLuma = null;
    /** @type {number} */
    this._smoothedLuma = 0;
    /** @type {boolean} */
    this._active = false;
    /** @type {MouthCaptureMode} */
    this._mode = 'idle';
    this._faceMesh = this._createFaceMesh();
  }

  /**
   * 获取当前驱动模式。
   * @returns {MouthCaptureMode}
   */
  get mode() {
    return this._mode;
  }

  /**
   * 注册 mouth 值回调。
   * @param {(value: number) => void} callback - mouth 值更新回调。
   */
  onMouth(callback) {
    this._onMouth = typeof callback === 'function' ? callback : () => {};
  }

  /**
   * 启用摄像头捕捉。
   * @returns {Promise<boolean>} 是否成功。
   */
  async enableWebcam() {
    if (this._active) {
      return true;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn('[stickbot] 当前浏览器不支持 webcam。');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
    } catch (error) {
      console.warn('[stickbot] 获取摄像头权限失败', error);
      return false;
    }
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch (error) {
      console.warn('[stickbot] 摄像头流无法播放', error);
      this.disableWebcam();
      return false;
    }
    this.prevLuma = null;
    this._smoothedLuma = 0;
    this._active = true;
    this._mode = this._faceMesh ? 'facemesh' : 'luma';
    this._startLoop();
    return true;
  }

  /**
   * 停止捕捉并释放资源。
   */
  disableWebcam() {
    this._active = false;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this._pendingFaceMesh = null;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.prevLuma = null;
    this._smoothedLuma = 0;
    this._mode = 'idle';
    this._onMouth(0);
  }

  /**
   * 内部：创建 faceMesh 实例（若可用）。
   * @returns {any|null}
   */
  _createFaceMesh() {
    const globalObj = typeof window !== 'undefined' ? window : globalThis;
    if (!globalObj) {
      return null;
    }
    const FaceMeshCtor =
      globalObj.faceMesh?.FaceMesh || globalObj.FaceMesh || globalObj.facemesh?.FaceMesh;
    if (typeof FaceMeshCtor !== 'function') {
      return null;
    }
    try {
      const instance = new FaceMeshCtor({ locateFile: (file) => file });
      if (typeof instance.setOptions === 'function') {
        instance.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      }
      if (typeof instance.onResults === 'function') {
        instance.onResults((results) => {
          this._handleFaceMeshResults(results);
        });
      }
      return instance;
    } catch (error) {
      console.warn('[stickbot] 初始化 faceMesh 失败，将使用亮度差分占位。', error);
      return null;
    }
  }

  _startLoop() {
    if (!this._active) {
      return;
    }
    if (this._faceMesh) {
      if (this._pendingFaceMesh) {
        this.frameHandle = requestAnimationFrame(() => this._startLoop());
        return;
      }
      this._pendingFaceMesh = this._faceMesh
        .send({ image: this.video })
        .catch((error) => {
          console.warn('[stickbot] faceMesh 检测失败，将回退到亮度差分。', error);
          this._faceMesh = null;
          this._mode = 'luma';
        })
        .finally(() => {
          this._pendingFaceMesh = null;
          if (this._active) {
            this.frameHandle = requestAnimationFrame(() => this._startLoop());
          }
        });
      return;
    }
    this._processLumaFrame();
    this.frameHandle = requestAnimationFrame(() => this._startLoop());
  }

  _handleFaceMeshResults(results) {
    if (!this._active) {
      return;
    }
    const landmarks = results?.multiFaceLandmarks?.[0];
    if (!landmarks) {
      this._onMouth(0);
      return;
    }
    const upper = landmarks[13];
    const lower = landmarks[14];
    const left = landmarks[61];
    const right = landmarks[291];
    if (!upper || !lower || !left || !right) {
      return;
    }
    const mouthHeight = Math.hypot(lower.x - upper.x, lower.y - upper.y);
    const mouthWidth = Math.hypot(right.x - left.x, right.y - left.y);
    if (!Number.isFinite(mouthHeight) || !Number.isFinite(mouthWidth) || mouthWidth === 0) {
      return;
    }
    const ratio = mouthHeight / mouthWidth;
    const normalized = Math.max(0, Math.min(1, (ratio - 0.02) * 12));
    this._onMouth(normalized);
  }

  _processLumaFrame() {
    if (!this.ctx) {
      return;
    }
    const videoWidth = this.video.videoWidth;
    const videoHeight = this.video.videoHeight;
    if (!videoWidth || !videoHeight) {
      return;
    }
    if (this.canvas.width !== DEFAULT_CANVAS_SIZE || this.canvas.height !== DEFAULT_CANVAS_SIZE) {
      this.canvas.width = DEFAULT_CANVAS_SIZE;
      this.canvas.height = DEFAULT_CANVAS_SIZE;
    }
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const sampleX = Math.floor(this.canvas.width * 0.25);
    const sampleY = Math.floor(this.canvas.height * 0.45);
    const sampleWidth = Math.floor(this.canvas.width * 0.5);
    const sampleHeight = Math.max(1, Math.floor(this.canvas.height * 0.3));
    const image = this.ctx.getImageData(sampleX, sampleY, sampleWidth, sampleHeight);
    let sum = 0;
    const { data } = image;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sum += r * 0.299 + g * 0.587 + b * 0.114;
    }
    const pixels = data.length / 4;
    const avg = pixels > 0 ? sum / pixels : 0;
    if (this.prevLuma === null) {
      this.prevLuma = avg;
      return;
    }
    const diff = Math.abs(avg - this.prevLuma);
    this.prevLuma = avg;
    const normalized = Math.max(0, Math.min(1, diff / 35));
    this._smoothedLuma = this._smoothedLuma * 0.7 + normalized * 0.3;
    const boosted = Math.max(0, Math.min(1, this._smoothedLuma * 1.4));
    this._onMouth(boosted);
  }
}
