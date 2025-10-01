const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const DEFAULT_AUTO_GAIN_CONFIG = {
  windowSec: 5,
  targetRMS: 0.5,
  floor: 0.6,
  ceil: 1.5,
  smoothing: 0.3,
  sampleStep: 1 / 60,
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const sampleTimelineValue = (timeline, time) => {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return 0;
  }
  if (time <= timeline[0].t) {
    return toNumber(timeline[0].v ?? timeline[0].value ?? 0);
  }
  for (let i = 1; i < timeline.length; i += 1) {
    const prev = timeline[i - 1];
    const next = timeline[i];
    if (time <= next.t) {
      const span = Math.max(next.t - prev.t, 1e-6);
      const ratio = (time - prev.t) / span;
      const prevValue = toNumber(prev.v ?? prev.value ?? 0);
      const nextValue = toNumber(next.v ?? next.value ?? 0);
      return prevValue + (nextValue - prevValue) * ratio;
    }
  }
  const last = timeline[timeline.length - 1];
  return toNumber(last.v ?? last.value ?? 0);
};

class AutoGainProcessor {
  constructor(timeline, config = {}) {
    this.config = { ...DEFAULT_AUTO_GAIN_CONFIG, ...config };
    this.sampleStep = this.config.sampleStep || DEFAULT_AUTO_GAIN_CONFIG.sampleStep;
    this.timeline = Array.isArray(timeline) ? timeline : [];
    this.samples = [];
    this.prefixSquares = [];
    this.lastGain = 1;
    this.lastTime = null;
    this.buildSamples();
  }

  buildSamples() {
    if (this.timeline.length === 0) {
      this.samples = [0];
      this.prefixSquares = [0, 0];
      return;
    }
    const duration = this.timeline[this.timeline.length - 1].t ?? 0;
    const window = Math.max(this.config.windowSec, 0.001);
    const sampleCount = Math.max(2, Math.ceil((duration + window) / this.sampleStep) + 1);
    this.samples = new Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      const t = i * this.sampleStep;
      const value = clamp(sampleTimelineValue(this.timeline, t), 0, 1);
      this.samples[i] = value;
    }
    this.prefixSquares = new Array(sampleCount + 1).fill(0);
    for (let i = 0; i < sampleCount; i += 1) {
      const value = this.samples[i];
      this.prefixSquares[i + 1] = this.prefixSquares[i] + value * value;
    }
  }

  reset() {
    this.lastGain = 1;
    this.lastTime = null;
  }

  setTimeline(timeline) {
    this.timeline = Array.isArray(timeline) ? timeline : [];
    this.buildSamples();
    this.reset();
  }

  getGain(time) {
    if (!Number.isFinite(time) || time <= 0) {
      this.lastGain = 1;
      this.lastTime = time;
      return 1;
    }
    if (this.lastTime !== null && time < this.lastTime) {
      this.lastGain = 1;
    }
    this.lastTime = time;
    const windowSamples = Math.max(1, Math.round(this.config.windowSec / this.sampleStep));
    const currentIndex = clamp(Math.floor(time / this.sampleStep), 0, this.samples.length - 1);
    const startIndex = Math.max(0, currentIndex - windowSamples + 1);
    const sumSquares = this.prefixSquares[currentIndex + 1] - this.prefixSquares[startIndex];
    const count = currentIndex + 1 - startIndex;
    if (count <= 0) {
      this.lastGain = 1;
      return 1;
    }
    const rms = Math.sqrt(sumSquares / count);
    if (!Number.isFinite(rms) || rms < 1e-4) {
      this.lastGain = 1;
      return 1;
    }
    const rawGain = clamp(this.config.targetRMS / rms, this.config.floor, this.config.ceil);
    const smoothing = clamp(this.config.smoothing ?? 0, 0, 0.95);
    const next = smoothing > 0 ? this.lastGain + (rawGain - this.lastGain) * smoothing : rawGain;
    this.lastGain = clamp(next, this.config.floor, this.config.ceil);
    return this.lastGain;
  }

  apply(time, value) {
    const gain = this.getGain(time);
    const scaled = clamp((value ?? 0) * gain, 0, 1);
    return { value: scaled, gain };
  }
}

module.exports = {
  AutoGainProcessor,
  DEFAULT_AUTO_GAIN_CONFIG,
};
