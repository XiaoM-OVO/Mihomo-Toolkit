/**
 * -----------------------------------------------------------------------------
 * Data: 专项服务 / 广告 / 下载 / 方向骨架组声明 (Catalog Group Declarations)
 * -----------------------------------------------------------------------------
 * 所有出厂策略组的静态声明；拓扑层只读取，不再现场推导成员顺序。
 */

'use strict';

const SPECIAL_SERVICES = Object.freeze({
  crypto: {
    key: 'crypto',
    name: '加密货币',
    emoji: '🪙',
    icon: { repo: 'koolson', file: 'Cryptocurrency.png' },
    providers: { crypto: 'geosite/category-cryptocurrency' },
    rules: ['RULE-SET,crypto,加密货币'],
    preferredRegions: ['tw', 'jp', 'eu'],
    proxies: ['@preferredRegions', '@residentialGroup', '@defaultProxy', 'DIRECT']
  },
  paypal: {
    key: 'paypal',
    name: 'PayPal',
    emoji: '💳',
    icon: { repo: 'koolson', file: 'PayPal.png' },
    providers: { paypal: 'geosite/paypal' },
    rules: ['RULE-SET,paypal,PayPal'],
    proxies: ['DIRECT', '@defaultProxy', '@activeRegions', '@residentialGroup']
  },
  webrtc: {
    key: 'webrtc',
    name: 'WebRTC',
    emoji: '🗣',
    icon: { repo: 'koolson', file: 'Direct.png' },
    providers: {},
    rules: [
      'DOMAIN-KEYWORD,webrtc,WebRTC',
      'DOMAIN-KEYWORD,stun,WebRTC',
      'DOMAIN-KEYWORD,turn,WebRTC',
      'DST-PORT,3478,WebRTC',
      'DST-PORT,5349,WebRTC',
      'DST-PORT,5350,WebRTC',
      'DST-PORT,19302,WebRTC'
    ],
    proxies: ['@defaultProxy', 'DIRECT', '手动选择', '自动选择', '@activeRegions']
  },
  telegram: {
    key: 'telegram',
    name: 'Telegram',
    emoji: '✈️',
    icon: { repo: 'koolson', file: 'Telegram.png' },
    providers: { telegram: 'geosite/telegram', 'telegram-ip': 'geoip/telegram' },
    process: {
      win: ['Telegram'],
      mac: ['Telegram'],
      lin: ['Telegram']
    },
    rules: [
      'RULE-SET,telegram,Telegram',
      'RULE-SET,telegram-ip,Telegram,no-resolve'
    ],
    proxies: ['@standardOptions', 'DIRECT']
  }
});

const ADS_GROUPS = Object.freeze({
  'ad-block': {
    refKey: 'ad-block',
    name: '广告拦截',
    type: 'select',
    proxies: ['REJECT-DROP', 'REJECT', 'DIRECT'],
    rules: ['RULE-SET,ads,广告拦截'],
    providers: { ads: 'geosite/category-ads-all' }
  },
  'anti-ad': {
    refKey: 'anti-ad',
    name: '广告拦截',
    type: 'select',
    proxies: ['REJECT-DROP', 'REJECT', 'DIRECT'],
    rules: ['RULE-SET,anti-ad,广告拦截'],
    providers: { 'anti-ad': 'https://anti-ad.net/clash.yaml' }
  }
});

const DOWNLOAD_GROUPS = Object.freeze([
  {
    name: '下载策略',
    type: 'select',
    hidden: false,
    proxies: ['DIRECT', '负载均衡-轮询', '自动选择', '@pool:低倍率节点']
  },
  {
    name: '负载均衡-轮询',
    type: 'load-balance',
    strategy: 'round-robin',
    interval: 300,
    lazy: true,
    hidden: true,
    proxies: ['@pool:低倍率节点']
  }
]);

const SKELETON_GROUP_DEFS = Object.freeze({
  domestic: Object.freeze({
    split: Object.freeze({
      name: '中国分流',
      type: 'select',
      hidden: false,
      proxies: Object.freeze(['DIRECT', '@cnCoreGroups', '@defaultProxy'])
    }),
    return: Object.freeze({
      name: '中国分流',
      type: 'select',
      hidden: false,
      proxies: Object.freeze(['@defaultProxy', '@cnCoreGroups', 'DIRECT'])
    })
  }),
  final: Object.freeze({
    split: Object.freeze({
      name: '漏网之鱼',
      type: 'select',
      hidden: false,
      proxies: Object.freeze(['@defaultProxy', '自动选择', '手动选择', '故障转移', '@downloadGroup', 'DIRECT'])
    }),
    return: Object.freeze({
      name: '漏网之鱼',
      type: 'select',
      hidden: false,
      proxies: Object.freeze(['DIRECT', '@defaultProxy', '自动选择', '手动选择', '故障转移', '@downloadGroup'])
    })
  })
});

module.exports = {
  SPECIAL_SERVICES,
  ADS_GROUPS,
  DOWNLOAD_GROUPS,
  SKELETON_GROUP_DEFS
};
