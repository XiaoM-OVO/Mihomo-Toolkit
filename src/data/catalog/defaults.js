/**
 * -----------------------------------------------------------------------------
 * Data: 分类默认策略与游戏聚合组 (Catalog Category Defaults)
 * -----------------------------------------------------------------------------
 * 分类维度的默认地区、图标与聚合组内联声明。
 */

'use strict';

const DEFAULT_AGGREGATES = Object.freeze({
  game: {
    service: {
      refKey: 'game-service',
      name: '游戏服务',
      emoji: '🎮',
      icon: { repo: 'koolson', file: 'Game.png' },
      type: 'select',
      match: { pool: 'game' },
      proxies: ['DIRECT', '@standardOptions', '@matchedNodes']
      // 成员清单：未声明时默认为本分类（game）全量服务——不自建第二份清单，避免与 BUILTIN_SERVICES 漂移。
    },
    download: {
      refKey: 'game-download',
      name: '游戏下载',
      emoji: '🎮',
      icon: { repo: 'koolson', file: 'Game.png' },
      type: 'select',
      match: { pool: 'game' },
      proxies: ['DIRECT', '下载策略', '自动选择', '手动选择', '@matchedNodes']
    }
  }
  // social 已取消聚合：社交服务一律「一服务一组」，不再有合并组与成员归属概念。
  // 若将来需要重新合并，用一条显式聚合组定义 + 把相关规则的 target 指过去即可（纯数据）。
});

const CATEGORY_DEFAULTS = {
  ai: {
    preferredRegions: ['us', 'jp', 'tw', 'sg', 'kr', 'eu']
  },
  streaming: {
    preferredRegions: []
  },
  social: {
    preferredRegions: []
  },
  game: {
    preferredRegions: [],
    emoji: '🎮',
    icon: { repo: 'koolson', file: 'Game.png' },
    defaultAggregate: 'service',
    aggregates: DEFAULT_AGGREGATES.game
  },
  dev: {
    preferredRegions: []
  },
  system: {
    preferredRegions: []
  }
};

module.exports = { DEFAULT_AGGREGATES, CATEGORY_DEFAULTS };
