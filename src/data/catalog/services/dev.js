/**
 * -----------------------------------------------------------------------------
 * Data: 内置服务编目 · 开发者与学术 (dev)
 * -----------------------------------------------------------------------------
 * 单条服务声明即完整组声明，可被 groups[].ref 直接引用。
 */

'use strict';

module.exports = {
  dev: {
    github: {
      name: 'GitHub',
      emoji: '🐱',
      rules: 'github',
      type: 'select',
      proxies: ['@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'GitHub.png' }
    },
    scholar: {
      name: '学术网站',
      emoji: '🎓',
      preferredRegions: ['us', 'eu', 'jp', 'sg', 'tw', 'hk'],
      rules: [
        { type: 'DOMAIN-KEYWORD', value: 'sci-hub', target: '@self' },
        { type: 'RULE-SET', value: 'scholar', path: 'category-scholar-!cn', target: '@self' }
      ],
      type: 'select',
      proxies: ['@preferredRegions', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Scholar.png' }
    }
  },
};
