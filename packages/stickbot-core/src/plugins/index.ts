/**
 * @module plugins
 * @description stickbot 核心插件机制：提供统一的事件总线以便扩展 mouth 捕捉、语义触发与自动增益等功能。
 */

import { BigMouthAvatar } from '../avatar.bigmouth.js';
import type {
  AvatarExpressionParams,
} from '../emotion/expression-mapping.js';
import {
  DEFAULT_SEMANTIC_DICTIONARY,
  deriveSemanticTimelines,
  type SemanticDictionary,
  type WordTimelineEntry,
} from '../emotion/semantic-triggers.js';
import { TimelinePlayer } from '../timeline-player.js';
import type {
  ExpressionTimelineKeyframe,
  TimelinePlayerAutoGainOptions,
  TimelinePlayerOptions,
} from '../timeline-player.js';

/**
 * 插件上下文，插件可通过时间线播放器、头像实例与事件总线进行交互。
 */
export interface StickBotPluginContext {
  /** 当前使用的 {@link TimelinePlayer} 实例。 */
  timeline: TimelinePlayer;
  /** 当前展示的 {@link BigMouthAvatar}。 */
  avatar: BigMouthAvatar;
  /** 用于插件之间通信的事件总线。 */
  bus: EventTarget;
  /** 可选的额外配置，通常由宿主传入。 */
  options?: unknown;
}

/**
 * stickbot 插件接口。插件需要提供名称，`setup` 会在注册时调用，可选的 `dispose`
 * 则在取消注册或宿主销毁时执行，用于清理事件监听与定时器。
 */
export interface StickBotPlugin {
  /** 插件唯一标识，建议使用 kebab-case。 */
  name: string;
  /**
   * 初始化插件。宿主会传入时间线、头像与事件总线。插件可在此阶段注册监听。
   *
   * @param ctx - 插件上下文。
   */
  setup(ctx: StickBotPluginContext): void;
  /**
   * 可选的清理函数，宿主在卸载插件时调用。
   */
  dispose?(): void;
}

/**
 * 时间线准备事件：宿主在创建或更新 {@link TimelinePlayer} 之前触发，允许插件调整
 * 播放参数或注入额外的表情时间轴。
 */
export interface StickBotTimelinePrepareDetail {
  /** 将要播报的原始文本。 */
  text: string;
  /** 可选的情绪估计结果。 */
  sentiment?: unknown;
  /** 逐词时间轴，便于插件对齐事件。 */
  wordTimeline?: WordTimelineEntry[];
  /**
   * 可修改的时间线配置。插件可直接覆盖或追加字段，宿主会在事件结束后读取。
   */
  timelineOptions: Partial<TimelinePlayerOptions> & {
    /** 可选的表达式预设，用于在播放前覆盖头像表情。 */
    expressionPreset?: AvatarExpressionParams;
  };
}

/**
 * mouth 捕捉启用事件：宿主发出后插件应启动捕捉，并持续回调 `onFrame`。
 */
export interface StickBotMouthCaptureStartDetail {
  /** mouth 数值回调，范围建议在 [0,1]。 */
  onFrame: (value: number) => void;
}

/**
 * mouth 捕捉停止事件。
 */
export type StickBotMouthCaptureStopDetail = Record<string, never>;

const TIMELINE_PREPARE_EVENT = 'stickbot:timeline:prepare';
const MOUTH_CAPTURE_START_EVENT = 'stickbot:mouth-capture:start';
const MOUTH_CAPTURE_STOP_EVENT = 'stickbot:mouth-capture:stop';
const MOUTH_CAPTURE_STATUS_EVENT = 'stickbot:mouth-capture:status';

/**
 * 语义触发表情插件。会在时间线准备阶段根据文本与逐词时间轴推导语义时间轴，并合并进
 * {@link TimelinePlayerOptions}。
 *
 * @param options - 自定义词典或强度调整。
 */
export function semanticTriggersPlugin(options: {
  /** 自定义语义词典，默认使用 {@link DEFAULT_SEMANTIC_DICTIONARY}。 */
  dictionary?: SemanticDictionary;
  /** 对整体强度的额外缩放。 */
  intensityScale?: number;
} = {}): StickBotPlugin {
  const { dictionary, intensityScale = 1 } = options;
  let bus: EventTarget | null = null;
  let handler: ((event: Event) => void) | null = null;
  return {
    name: 'semantic-triggers',
    setup(ctx) {
      bus = ctx.bus;
      handler = (event: Event) => {
        if (!(event instanceof CustomEvent<StickBotTimelinePrepareDetail>)) {
          return;
        }
        const detail = event.detail;
        if (!detail || !detail.timelineOptions) {
          return;
        }
        const baseDictionary = Array.isArray(dictionary) && dictionary.length > 0
          ? dictionary
          : DEFAULT_SEMANTIC_DICTIONARY;
        const result = deriveSemanticTimelines(
          detail.text ?? '',
          detail.sentiment as never,
          detail.wordTimeline ?? [],
          baseDictionary,
        );
        const emote = Array.isArray(result.emoteTimeline) ? [...result.emoteTimeline] : [];
        const gesture = Array.isArray(result.gestureTimeline) ? [...result.gestureTimeline] : [];
        const scale = Number.isFinite(intensityScale) ? Math.max(0, intensityScale) : 1;
        const applyScale = (frames: ExpressionTimelineKeyframe[]): ExpressionTimelineKeyframe[] =>
          frames.map((frame) => ({ ...frame, v: frame.v * scale }));
        const existingEmote = Array.isArray(detail.timelineOptions.emoteTimeline)
          ? detail.timelineOptions.emoteTimeline
          : [];
        const existingGesture = Array.isArray(detail.timelineOptions.gestureTimeline)
          ? detail.timelineOptions.gestureTimeline
          : [];
        detail.timelineOptions.emoteTimeline = [...existingEmote, ...applyScale(emote)];
        detail.timelineOptions.gestureTimeline = [...existingGesture, ...applyScale(gesture)];
      };
      bus.addEventListener(TIMELINE_PREPARE_EVENT, handler as EventListener);
    },
    dispose() {
      if (bus && handler) {
        bus.removeEventListener(TIMELINE_PREPARE_EVENT, handler as EventListener);
      }
      bus = null;
      handler = null;
    },
  };
}

/**
 * 自动增益插件。插件会在时间线准备阶段确保 {@link TimelinePlayer} 的 `autoGain` 选项启用。
 *
 * @param options - 自动增益配置，未提供时启用默认参数。
 */
export function autoGainPlugin(options?: Partial<TimelinePlayerAutoGainOptions> | boolean): StickBotPlugin {
  let bus: EventTarget | null = null;
  let handler: ((event: Event) => void) | null = null;
  const normalize = (): TimelinePlayerOptions['autoGain'] => {
    if (typeof options === 'boolean') {
      return options;
    }
    if (!options || typeof options !== 'object') {
      return true;
    }
    return { ...options };
  };
  return {
    name: 'auto-gain',
    setup(ctx) {
      bus = ctx.bus;
      handler = (event: Event) => {
        if (!(event instanceof CustomEvent<StickBotTimelinePrepareDetail>)) {
          return;
        }
        const detail = event.detail;
        if (!detail || !detail.timelineOptions) {
          return;
        }
        detail.timelineOptions.autoGain = normalize();
      };
      bus.addEventListener(TIMELINE_PREPARE_EVENT, handler as EventListener);
    },
    dispose() {
      if (bus && handler) {
        bus.removeEventListener(TIMELINE_PREPARE_EVENT, handler as EventListener);
      }
      bus = null;
      handler = null;
    },
  };
}

/**
 * mouth 捕捉插件。默认提供无外部依赖的占位实现，基于伪随机波动输出 mouth 数值。
 * 宿主若引入真实捕捉算法，可在自定义插件中替换。
 *
 * @param options - 可选参数，例如基础值与振幅。
 */
export function mouthCapturePlugin(options: {
  /** 静止时的基准值，默认 0.08。 */
  idle?: number;
  /** 输出振幅，默认 0.6。 */
  amplitude?: number;
  /** 伪随机步进间隔（毫秒），默认 80。 */
  intervalMs?: number;
} = {}): StickBotPlugin {
  const idle = Number.isFinite(options.idle) ? Math.max(0, Math.min(1, Number(options.idle))) : 0.08;
  const amplitude = Number.isFinite(options.amplitude)
    ? Math.max(0, Math.min(1, Number(options.amplitude)))
    : 0.6;
  const intervalCandidate = Number(options.intervalMs);
  const interval = Number.isFinite(intervalCandidate) && intervalCandidate > 0
    ? Math.max(30, intervalCandidate)
    : 80;
  let bus: EventTarget | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let phase = 0;
  const stopLoop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  let cleanup: (() => void) | null = null;
  return {
    name: 'mouth-capture',
    setup(ctx) {
      bus = ctx.bus;
      const handleStart = (event: Event) => {
        if (!(event instanceof CustomEvent<StickBotMouthCaptureStartDetail>)) {
          return;
        }
        const detail = event.detail;
        if (!detail || typeof detail.onFrame !== 'function') {
          return;
        }
        stopLoop();
        phase = 0;
        timer = setInterval(() => {
          phase += 0.18 + Math.random() * 0.12;
          const oscillation = Math.sin(phase) * 0.5 + 0.5;
          const jitter = Math.random() * 0.2;
          const value = Math.max(0, Math.min(1, idle + (oscillation * (1 - idle) + jitter * amplitude) * amplitude));
          detail.onFrame(value);
        }, interval);
        bus?.dispatchEvent(new CustomEvent(MOUTH_CAPTURE_STATUS_EVENT, {
          detail: { active: true, mode: 'placeholder' },
        }));
      };
      const handleStop = () => {
        stopLoop();
        bus?.dispatchEvent(new CustomEvent(MOUTH_CAPTURE_STATUS_EVENT, {
          detail: { active: false, mode: 'idle' },
        }));
      };
      ctx.bus.addEventListener(MOUTH_CAPTURE_START_EVENT, handleStart as EventListener);
      ctx.bus.addEventListener(MOUTH_CAPTURE_STOP_EVENT, handleStop as EventListener);
      cleanup = () => {
        ctx.bus.removeEventListener(MOUTH_CAPTURE_START_EVENT, handleStart as EventListener);
        ctx.bus.removeEventListener(MOUTH_CAPTURE_STOP_EVENT, handleStop as EventListener);
        stopLoop();
        bus = null;
      };
    },
    dispose() {
      cleanup?.();
      cleanup = null;
    },
  };
}

export type {
  StickBotTimelinePrepareDetail,
  StickBotMouthCaptureStartDetail,
  StickBotMouthCaptureStopDetail,
};

export const StickBotPluginEvents = {
  TIMELINE_PREPARE: TIMELINE_PREPARE_EVENT,
  MOUTH_CAPTURE_START: MOUTH_CAPTURE_START_EVENT,
  MOUTH_CAPTURE_STOP: MOUTH_CAPTURE_STOP_EVENT,
  MOUTH_CAPTURE_STATUS: MOUTH_CAPTURE_STATUS_EVENT,
} as const;
