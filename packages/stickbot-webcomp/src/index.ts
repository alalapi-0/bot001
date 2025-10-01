/**
 * @module stickbot-webcomp
 * @description 提供 `<stick-bot>` Web Component，占位实现内置插件注册接口。
 */

import { BigMouthAvatar } from '../../stickbot-core/src/avatar.bigmouth.js';
import { TimelinePlayer } from '../../stickbot-core/src/timeline-player.js';
import type { StickBotPlugin } from '../../stickbot-core/src/plugins/index.js';

interface ActivePluginEntry {
  plugin: StickBotPlugin;
}

/**
 * `<stick-bot>` 组件：目前仍为占位渲染，仅开放插件注册接口，方便宿主在自定义渲染管线中复用 core 插件。
 */
export class StickBotComponent extends HTMLElement {
  private readonly shadowRootRef: ShadowRoot;

  private readonly canvas: HTMLCanvasElement;

  private readonly avatar: BigMouthAvatar;

  private readonly timeline: TimelinePlayer;

  private readonly bus: EventTarget;

  private activePlugins: ActivePluginEntry[] = [];

  constructor() {
    super();
    this.shadowRootRef = this.attachShadow({ mode: 'open' });
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 320;
    this.canvas.setAttribute('part', 'canvas');
    this.shadowRootRef.appendChild(this.canvas);
    this.bus = new EventTarget();
    this.avatar = new BigMouthAvatar(this.canvas);
    this.timeline = new TimelinePlayer([], {});
  }

  /**
   * 注册插件列表，重复调用会先清理旧插件再加载新插件。
   *
   * @param plugins - 待注册的插件数组。
   */
  registerPlugins(plugins: StickBotPlugin[]): void {
    this.disposePlugins();
    if (!Array.isArray(plugins)) {
      return;
    }
    for (const plugin of plugins) {
      if (!plugin || typeof plugin.setup !== 'function') {
        continue;
      }
      try {
        plugin.setup({
          timeline: this.timeline,
          avatar: this.avatar,
          bus: this.bus,
          options: { element: this },
        });
        this.activePlugins.push({ plugin });
      } catch (error) {
        console.warn('[stickbot] 插件初始化失败', plugin?.name, error);
      }
    }
  }

  /**
   * 移除所有已注册插件。
   */
  private disposePlugins(): void {
    for (const entry of this.activePlugins) {
      try {
        entry.plugin.dispose?.();
      } catch (error) {
        console.warn('[stickbot] 插件清理失败', entry.plugin?.name, error);
      }
    }
    this.activePlugins = [];
  }

  disconnectedCallback(): void {
    this.disposePlugins();
  }
}
