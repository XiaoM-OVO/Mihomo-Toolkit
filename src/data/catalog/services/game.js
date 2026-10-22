/**
 * -----------------------------------------------------------------------------
 * Data: 内置服务编目 · 游戏服务 (game)
 * -----------------------------------------------------------------------------
 * 单条服务声明即完整组声明，可被 groups[].ref 直接引用。
 */

'use strict';

module.exports = {
  game: {
    steam: {
      name: 'Steam',
      rules: [
        { type: 'DOMAIN-SUFFIX', value: 'steamcontent.com', target: '@download' },
        { type: 'RULE-SET', value: 'steam-cn', path: 'steam@cn', target: '@download' },
        { type: 'RULE-SET', value: 'steam', path: 'steam', target: '@service' }
      ]
    },
    'steam-cn': {
      name: 'Steam CN',
      rules: [],
      providerOnly: true,
      providerPath: 'steam@cn'
    },
    epic: {
      name: 'Epic',
      providerPath: 'epicgames',
      rules: [
        { type: 'DOMAIN-SUFFIX', value: 'download.epicgames.com', target: '@download' },
        { type: 'RULE-SET', value: 'epic', path: 'epicgames', target: '@service' },
        { type: 'DOMAIN-SUFFIX', value: 'epicgames.com', target: '@service' }
      ]
    },
    riot: {
      name: 'Riot',
      rules: [{ type: 'RULE-SET', value: 'riot', path: 'riot', target: '@service' }]
    },
    blizzard: {
      name: 'Blizzard',
      rules: [{ type: 'RULE-SET', value: 'blizzard', path: 'blizzard', target: '@service' }]
    },
    nintendo: {
      name: 'Nintendo',
      rules: [{ type: 'RULE-SET', value: 'nintendo', path: 'nintendo', target: '@service' }]
    },
    playstation: {
      name: 'PlayStation',
      rules: [{ type: 'RULE-SET', value: 'playstation', path: 'playstation', target: '@service' }]
    },
    xbox: {
      name: 'Xbox',
      rules: [{ type: 'RULE-SET', value: 'xbox', path: 'xbox', target: '@service' }]
    },
    ubisoft: {
      name: 'Ubisoft',
      rules: [{ type: 'RULE-SET', value: 'ubisoft', path: 'ubisoft', target: '@service' }]
    },
    origin: {
      name: 'Origin',
      rules: [{ type: 'RULE-SET', value: 'origin', path: 'origin', target: '@service' }]
    },
    ea: {
      name: 'EA',
      rules: [{ type: 'RULE-SET', value: 'ea', path: 'ea', target: '@service' }]
    }
  },
};
