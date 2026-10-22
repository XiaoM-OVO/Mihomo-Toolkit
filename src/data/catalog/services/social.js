/**
 * -----------------------------------------------------------------------------
 * Data: 内置服务编目 · 海外社交平台 (social)
 * -----------------------------------------------------------------------------
 * 单条服务声明即完整组声明，可被 groups[].ref 直接引用。
 */

'use strict';

module.exports = {
  social: {
    twitter: {
      name: 'Twitter',
      emoji: '🐦',
      rules: 'twitter',
      type: 'select',
      proxies: ['@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Twitter.png' }
    },
    facebook: {
      name: 'Facebook',
      emoji: '👥',
      rules: 'facebook',
      type: 'select',
      proxies: ['@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Facebook.png' }
    },
    instagram: {
      name: 'Instagram',
      emoji: '📸',
      rules: 'instagram',
      type: 'select',
      proxies: ['@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Instagram.png' }
    },
    discord: {
      name: 'Discord',
      emoji: '🎮',
      rules: 'discord',
      type: 'select',
      proxies: ['@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Discord.png' }
    }
  },
};
