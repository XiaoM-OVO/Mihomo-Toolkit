/**
 * -----------------------------------------------------------------------------
 * Data: 内置服务编目 · 流媒体平台 (streaming)
 * -----------------------------------------------------------------------------
 * 单条服务声明即完整组声明，可被 groups[].ref 直接引用。
 */

'use strict';

module.exports = {
  streaming: {
    youtube: {
      name: 'YouTube',
      emoji: '▶️',
      tag: 'yt',
      pool: 'youtube',
      reg: /\b(?:YouTube|YT|油管)\b/i,
      rules: 'youtube',
      type: 'select',
      match: { pool: 'youtube' },
      proxies: ['@matchedNodes', '@preferredRegions', '@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'YouTube.png' }
    },
    netflix: {
      name: 'Netflix',
      emoji: '🎬',
      tag: 'nf',
      pool: 'netflix',
      reg: /\b(?:Netflix|NF|奈飞|网飞|耐飞)\b/i,
      rules: 'netflix',
      type: 'select',
      match: { pool: 'netflix' },
      proxies: ['@matchedNodes', '@preferredRegions', '@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Netflix.png' }
    },
    bilibili: {
      name: 'BiliBili',
      emoji: '📺',
      tag: 'streaming',
      pool: 'bilibili',
      preferredRegions: ['cn', 'tw', 'mo', 'hk'],
      rules: 'bilibili',
      type: 'select',
      proxies: ['@domesticGroup', '台湾节点', '澳门节点', '香港节点', 'DIRECT'],
      icon: { repo: 'orz', file: 'Bili.png' }
    },
    disney: {
      name: 'Disney+',
      emoji: '🪄',
      tag: 'd+',
      pool: 'disney',
      reg: /\b(?:Disney\+|Disney|迪士尼|D\+)\b/i,
      rules: 'disney',
      type: 'select',
      match: { pool: 'disney' },
      proxies: ['@matchedNodes', '@preferredRegions', '@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Disney.png' }
    },
    spotify: {
      name: 'Spotify',
      emoji: '🎧',
      tag: 'sp',
      pool: 'spotify',
      reg: /\b(?:Spotify|声田|声破天)\b/i,
      rules: 'spotify',
      type: 'select',
      match: { pool: 'spotify' },
      proxies: ['@matchedNodes', '@preferredRegions', '@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Spotify.png' }
    },
    tiktok: {
      name: 'TikTok',
      emoji: '🎵',
      tag: 'tk',
      pool: 'tiktok',
      reg: /\b(?:TikTok|抖音海外|TT)\b/i,
      rules: 'tiktok',
      type: 'select',
      match: { pool: 'tiktok' },
      proxies: ['@matchedNodes', '@nonCnRegions', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'koolson', file: 'TikTok.png' }
    },
    bahamut: {
      name: 'Bahamut',
      emoji: '📺',
      pool: 'bahamut',
      preferredRegions: ['tw', 'hk'],
      rules: 'bahamut',
      type: 'select',
      proxies: ['台湾节点', '香港节点', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Bahamut.png' }
    },
    pixiv: {
      name: 'Pixiv',
      emoji: '🅿️',
      pool: 'pixiv',
      rules: 'pixiv',
      type: 'select',
      match: { pool: 'pixiv' },
      proxies: ['@matchedNodes', '@preferredRegions', '@standardOptions', 'DIRECT'],
      icon: { repo: 'lige47', file: '04ProxySoft/pixiv.png' }
    },
    twitch: {
      name: 'Twitch',
      emoji: '🎮',
      pool: 'twitch',
      rules: 'twitch',
      type: 'select',
      match: { pool: 'twitch' },
      proxies: ['@matchedNodes', '@preferredRegions', '@standardOptions', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Twitch.png' }
    }
  },
};
