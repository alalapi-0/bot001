/**
 * @module stickbot-core
 * 核心导出：包含 Avatar、时间线播放器与情绪工具。
 */

export { BigMouthAvatar, DEFAULT_CONFIG } from './avatar.bigmouth.js';
export type { AvatarConfig, MouthFrame, RenderMode, SpriteOptions } from './avatar.bigmouth.js';

export { TimelinePlayer } from './timeline-player.js';
export type {
  MouthTimelineFrame,
  ExpressionTimelineKeyframe,
  TimelinePlayerFrame,
  TimelinePlayerOptions,
} from './timeline-player.js';

export { estimateSentiment } from './emotion/sentiment-heuristics.js';
export type { SentimentEstimate } from './emotion/sentiment-heuristics.js';

export { deriveProsodyHints } from './emotion/prosody-hints.js';
export type { ProsodyHintOptions } from './emotion/prosody-hints.js';
export type { ExpressionTimelinePoint } from './timeline-player.js';

export { mapEmotionToExpression } from './emotion/expression-mapping.js';
export type { AvatarExpressionParams } from './emotion/expression-mapping.js';
