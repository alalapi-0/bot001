/**
 * @module stickbot-core
 * 核心导出：包含 Avatar、时间线播放器与情绪工具。
 */

export { BigMouthAvatar, DEFAULT_CONFIG, DEFAULT_THEME } from './avatar.bigmouth.js';
export type {
  AvatarConfig,
  AvatarInitOptions,
  AvatarTheme,
  AvatarThemeResolved,
  MouthFrame,
  RenderMode,
  SpriteOptions,
} from './avatar.bigmouth.js';

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

export {
  deriveSemanticTimelines,
  DEFAULT_SEMANTIC_DICTIONARY,
} from './emotion/semantic-triggers.js';
export type {
  SemanticDictionary,
  SemanticDictionaryEntry,
  SemanticTimelineKeyframe,
  SemanticTimelineResult,
  WordTimelineEntry,
} from './emotion/semantic-triggers.js';

export {
  semanticTriggersPlugin,
  autoGainPlugin,
  mouthCapturePlugin,
  StickBotPluginEvents,
} from './plugins/index.js';
export type {
  StickBotPlugin,
  StickBotPluginContext,
  StickBotTimelinePrepareDetail,
  StickBotMouthCaptureStartDetail,
  StickBotMouthCaptureStopDetail,
} from './plugins/index.js';
