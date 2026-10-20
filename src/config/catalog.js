/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 领域服务编目体系 (Service Catalog & SSOT)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 维护六维内置服务（AI、流媒体、社交、游戏平台、开发学术、系统服务）的标准元数据基准
 * 2. 集中管理 CDN、geosite/geoip 仓库与各大知名图标库前缀（杜绝分散硬编码）
 * 3. 智能正则编译器：支持 YAML 字符串正则与标准 RegExp 安全转换
 * 4. 增量合并引擎：支持用户自定义服务 (customServices) 与外部脚本深度补丁（对象合并、数组覆盖）
 * 5. 面向 Core（特征打标/Emoji）与 Strategy（策略组/分流规则/在线图标）提供多维纯净投影
 */

// ─────────────────────────────────────────────────────────────
// 1. 全局默认仓库与源头映射表 (DEFAULT_REPOS)
// ─────────────────────────────────────────────────────────────
const { FIELDS_BY_KEY } = require('../data');

/**
 * 默认仓库前缀。
 *
 * ⚠️ 数值一律取自只读数据层的字段注册表，不在此处重抄字面量：
 * 这些前缀同时也是用户可配置项（`ruleProviderCDN` / `geositeRepo` / `geoipRepo` /
 * `iconRepoXxx`）的出厂默认值，抄两份迟早会漂移成两个真相。
 */
const DEFAULT_REPOS = {
  cdn: FIELDS_BY_KEY.ruleProviderCDN.default,
  geosite: FIELDS_BY_KEY.geositeRepo.default,
  geoip: FIELDS_BY_KEY.geoipRepo.default,
  icons: {
    orz: FIELDS_BY_KEY.iconRepoOrz.default,
    koolson: FIELDS_BY_KEY.iconRepoKoolson.default,
    lige47: FIELDS_BY_KEY.iconRepoLige47.default
  }
};

// ─────────────────────────────────────────────────────────────
// 2. 专项独立服务与聚合策略组定义
// ─────────────────────────────────────────────────────────────
const DEFAULT_AGGREGATES = Object.freeze({
  game: {
    service: {
      name: '游戏服务',
      emoji: '🎮',
      icon: { repo: 'koolson', file: 'Game.png' },
      proxies: ['DIRECT', '@standardOptions', '@buckets.game']
    },
    download: {
      name: '游戏下载',
      emoji: '🎮',
      icon: { repo: 'koolson', file: 'Game.png' },
      proxies: ['DIRECT', '下载策略', '自动选择', '手动选择', '@buckets.game']
    }
  },
  social: {
    combined: {
      name: '社交平台',
      emoji: '💬',
      icon: { repo: 'koolson', file: 'Discord.png' },
      proxies: ['@standardOptions', 'DIRECT']
    }
  }
});

const SPECIAL_SERVICES = Object.freeze({
  crypto: {
    key: 'crypto',
    name: '加密货币',
    emoji: '🪙',
    icon: { repo: 'koolson', file: 'Cryptocurrency.png' },
    configKey: 'enableCrypto',
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
    configKey: 'enablePayPal',
    providers: { paypal: 'geosite/paypal' },
    rules: ['RULE-SET,paypal,PayPal'],
    proxies: ['DIRECT', '@defaultProxy', '@activeRegions', '@residentialGroup']
  },
  webrtc: {
    key: 'webrtc',
    name: 'WebRTC',
    emoji: '🗣',
    icon: { repo: 'koolson', file: 'Direct.png' },
    configKey: 'enableWebRTC',
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
    configKey: 'enableTelegram',
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

// ─────────────────────────────────────────────────────────────
// 2.1 六维分类默认策略 (CATEGORY_DEFAULTS)
// ─────────────────────────────────────────────────────────────
const CATEGORY_DEFAULTS = {
  ai: {
    preferredRegions: ['us', 'jp', 'tw', 'sg', 'kr', 'eu']
  },
  streaming: {
    preferredRegions: []
  },
  social: {
    preferredRegions: [],
    aggregates: DEFAULT_AGGREGATES.social
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

// ─────────────────────────────────────────────────────────────
// 3. 六维全量内置服务字典 (BUILTIN_SERVICES)
// ─────────────────────────────────────────────────────────────
const BUILTIN_SERVICES = {
  // ① AI 助手
  // 注：AI 条目同时是「完整组声明」——match/proxies/rules 三件套齐备，
  // 因此可被用户以 `groups: [{ ref: chatgpt }]` 直接引用，无需在配置里重抄成员配方。
  ai: {
    chatgpt: {
      name: 'ChatGPT',
      emoji: '🤖',
      reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i,
      rules: 'openai',
      type: 'select',
      match: { pool: 'chatgpt' },
      proxies: ['@residentialGroup', '@preferredRegions', '@matchedNodes', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'orz', file: 'OpenAI.png' }
    },
    gemini: {
      name: 'Gemini',
      emoji: '♊',
      reg: /\bGemini\b/i,
      rules: { name: 'gemini', path: 'google-gemini' },
      type: 'select',
      match: { pool: 'gemini' },
      proxies: ['@residentialGroup', '@preferredRegions', '@matchedNodes', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'koolson', file: 'AI.png' }
    },
    claude: {
      name: 'Claude',
      emoji: '🦀',
      reg: /\bClaude\b/i,
      rules: { name: 'claude', path: 'anthropic' },
      type: 'select',
      match: { pool: 'claude' },
      proxies: ['@residentialGroup', '@preferredRegions', '@matchedNodes', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'lige47', file: '04ProxySoft/claude(1).png' }
    },
    copilot: {
      name: 'Copilot',
      emoji: '🐙',
      reg: /\b(?:Copilot|Bing)\b/i,
      rules: { name: 'bing', path: 'bing' },
      type: 'select',
      match: { pool: 'copilot' },
      proxies: ['@residentialGroup', '@preferredRegions', '@matchedNodes', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Copilot.png' }
    }
  },

  // ② 流媒体平台
  streaming: {
    youtube: {
      name: 'YouTube',
      emoji: '▶️',
      tag: 'yt',
      pool: 'youtube',
      reg: /\b(?:YouTube|YT|油管)\b/i,
      rules: 'youtube',
      icon: { repo: 'koolson', file: 'YouTube.png' }
    },
    netflix: {
      name: 'Netflix',
      emoji: '🎬',
      tag: 'nf',
      pool: 'netflix',
      reg: /\b(?:Netflix|NF|奈飞|网飞|耐飞)\b/i,
      rules: 'netflix',
      icon: { repo: 'koolson', file: 'Netflix.png' }
    },
    disney: {
      name: 'Disney+',
      emoji: '🪄',
      tag: 'd+',
      pool: 'disney',
      reg: /\b(?:Disney\+|Disney|迪士尼|D\+)\b/i,
      rules: 'disney',
      icon: { repo: 'koolson', file: 'Disney.png' }
    },
    tiktok: {
      name: 'TikTok',
      emoji: '🎵',
      tag: 'tk',
      pool: 'tiktok',
      reg: /\b(?:TikTok|抖音海外|TT)\b/i,
      rules: 'tiktok',
      proxies: ['@matchedNodes', '@nonCnRegions', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'koolson', file: 'TikTok.png' }
    },
    spotify: {
      name: 'Spotify',
      emoji: '🎧',
      tag: 'sp',
      pool: 'spotify',
      reg: /\b(?:Spotify|声田|声破天)\b/i,
      rules: 'spotify',
      icon: { repo: 'koolson', file: 'Spotify.png' }
    },
    bahamut: {
      name: 'Bahamut',
      emoji: '📺',
      pool: 'bahamut',
      preferredRegions: ['tw', 'hk'],
      rules: 'bahamut',
      proxies: ['台湾节点', '香港节点', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Bahamut.png' }
    },
    pixiv: {
      name: 'Pixiv',
      emoji: '🅿️',
      pool: 'pixiv',
      rules: 'pixiv',
      icon: { repo: 'lige47', file: '04ProxySoft/pixiv.png' }
    },
    twitch: {
      name: 'Twitch',
      emoji: '🎮',
      pool: 'twitch',
      rules: 'twitch',
      icon: { repo: 'koolson', file: 'Twitch.png' }
    },
    bilibili: {
      name: 'BiliBili',
      emoji: '📺',
      tag: 'streaming',
      pool: 'bilibili',
      preferredRegions: ['cn', 'tw', 'mo', 'hk'],
      rules: 'bilibili',
      proxies: ['@domesticGroup', '台湾节点', '澳门节点', '香港节点', 'DIRECT'],
      icon: { repo: 'orz', file: 'Bili.png' }
    }
  },

  // ③ 海外社交平台
  social: {
    twitter: {
      name: 'Twitter',
      emoji: '🐦',
      rules: 'twitter',
      icon: { repo: 'koolson', file: 'Twitter.png' }
    },
    facebook: {
      name: 'Facebook',
      emoji: '👥',
      rules: 'facebook',
      icon: { repo: 'koolson', file: 'Facebook.png' }
    },
    instagram: {
      name: 'Instagram',
      emoji: '📸',
      rules: 'instagram',
      icon: { repo: 'koolson', file: 'Instagram.png' }
    },
    discord: {
      name: 'Discord',
      emoji: '🎮',
      rules: 'discord',
      icon: { repo: 'koolson', file: 'Discord.png' }
    },
    meta: {
      name: 'Meta',
      emoji: '♾️',
      rules: { name: 'meta', path: 'facebook' },
      icon: { repo: 'koolson', file: 'Meta.png' }
    }
  },

  // ④ 游戏服务 (徽标与默认图标统一定义在 CATEGORY_DEFAULTS.game 中继承)
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

  // ⑤ 开发者与学术
  dev: {
    github: {
      name: 'GitHub',
      emoji: '🐱',
      rules: 'github',
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
      icon: { repo: 'koolson', file: 'Scholar.png' }
    }
  },

  // ⑥ 系统基础服务
  system: {
    google: {
      name: 'Google',
      emoji: '🔍',
      rules: 'google',
      proxies: ['@standardOptions', 'DIRECT'],
      icon: { repo: 'orz', file: 'Google.png' }
    },
    apple: {
      name: 'Apple',
      emoji: '🍎',
      rules: 'apple',
      proxies: ['DIRECT', '@standardOptions'],
      icon: { repo: 'orz', file: 'Apple.png' }
    },
    microsoft: {
      name: 'Microsoft',
      emoji: '🪟',
      rules: 'microsoft',
      proxies: ['DIRECT', '@standardOptions'],
      icon: { repo: 'orz', file: 'Microsoft.png' }
    }
  }
};

// ─────────────────────────────────────────────────────────────
// 4. 辅助工具：正则智能提升与图标 URL 组装
// ─────────────────────────────────────────────────────────────

/**
 * 将字符串形式或原生正则安全转换为标准 RegExp 实例
 * @param {string|RegExp} input
 * @returns {RegExp|null}
 */
function compileRegex(input) {
  if (input instanceof RegExp) return input;
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 检测 /pattern/flags 形式
  const slashMatch = trimmed.match(/^\/(.*)\/([a-z]*)$/i);
  if (slashMatch) {
    try {
      return new RegExp(slashMatch[1], slashMatch[2]);
    } catch {
      // 回退容错
    }
  }

  // 普通文本转为大小写不敏感正则
  try {
    return new RegExp(trimmed, 'i');
  } catch {
    return null;
  }
}

/**
 * 根据图标定义与仓库前缀解析绝对图标链接
 * @param {string|object} iconDef
 * @param {object} repoMap
 * @returns {string}
 */
function resolveIconUrl(iconDef, repoMap = DEFAULT_REPOS.icons) {
  if (!iconDef) return '';
  if (typeof iconDef === 'string') {
    return iconDef.startsWith('http://') || iconDef.startsWith('https://') ? iconDef : '';
  }
  if (typeof iconDef === 'object') {
    if (iconDef.url) return iconDef.url;
    const repoBase = (iconDef.repo && repoMap[iconDef.repo]) || '';
    const file = iconDef.file || '';
    return repoBase && file ? `${repoBase}${file}` : '';
  }
  return '';
}

/**
 * 递归深度合并对象，数组直接替换（符合声明式覆写直觉）
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
function deepMerge(target, source) {
  const output = { ...target };
  if (!source || typeof source !== 'object') return output;

  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      output[key] = [...value]; // 数组整体覆盖
    } else if (value instanceof RegExp) {
      output[key] = value;
    } else if (typeof value === 'object') {
      output[key] = deepMerge(target[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**
 * 解析服务分流规则的目标策略组（杜绝私有魔术字符串，动态绑定大类聚合目标）
 * @param {string} rawTarget 原始 target 声明
 * @param {string} cat 服务所属大类 ('game', 'ai' 等)
 * @param {string} cleanName 服务名称
 * @param {object} catDefaults 大类默认配置对象
 * @returns {string} 目标策略组名称
 */
function resolveRuleTarget(rawTarget, cat, cleanName, catDefaults = {}) {
  const aggregates = catDefaults.aggregates || {};
  const defaultAggName = catDefaults.defaultAggregate ? aggregates[catDefaults.defaultAggregate]?.name : null;

  if (!rawTarget || rawTarget === '@self') {
    return defaultAggName || cleanName;
  }
  if (typeof rawTarget === 'string' && rawTarget.startsWith('@')) {
    const key = rawTarget.slice(1);
    if (aggregates[key]) {
      return aggregates[key].name;
    }
  }
  return rawTarget;
}

// ─────────────────────────────────────────────────────────────
// 5. 编目解析引擎 (ServiceCatalog)
// ─────────────────────────────────────────────────────────────

class ServiceCatalog {
  constructor(services = {}, repos = DEFAULT_REPOS, userConfig = {}) {
    this.services = services;
    this.repos = repos;
    this.userConfig = userConfig;
  }

  /**
   * 获取指定分类下的单个服务定义
   * @param {string} category 'ai' | 'streaming' | 'social' | 'game' | 'dev' | 'system'
   * @param {string} key
   * @returns {object|null}
   */
  getService(category, key) {
    return this.services[category]?.[key] || null;
  }

  /**
   * 收集配置中通过 `groups: [{ ref: <键> }]` 显式引用的内置组键（未禁用者）
   * @param {object} [runtimeConfig]
   * @returns {string[]}
   */
  getDeclaredRefKeys(runtimeConfig) {
    const cfg = runtimeConfig || this.userConfig;
    if (!cfg || !Array.isArray(cfg.groups)) return [];
    return cfg.groups
      .filter(g => g && typeof g === 'object' && g.disabled !== true && typeof g.ref === 'string' && g.ref.trim())
      .map(g => g.ref.trim());
  }

  /**
   * 判定某分类是否被 `groups` 引用激活（用于「开关关闭但 ref 声明在」时仍开启打标/建组）
   * @param {string} category
   * @param {object} [runtimeConfig]
   * @returns {boolean}
   */
  hasRefActivation(category, runtimeConfig) {
    const cfg = runtimeConfig || this.userConfig;
    return this.getDeclaredRefKeys(cfg).some(key => this.isRefableGroup(key, category));
  }

  /**
   * 判定某个键是否为「可引用的完整组声明」（必须有 match + proxies，否则引用只会得到空壳）
   * @param {string} key
   * @param {string} [category] 限定分类；省略则在全部分类中查找
   * @returns {boolean}
   */
  isRefableGroup(key, category) {
    const cats = category ? [category] : Object.keys(this.services);
    return cats.some(cat => {
      const s = this.services[cat]?.[key];
      return Boolean(s && s.match && Array.isArray(s.proxies) && s.proxies.length > 0);
    });
  }

  /**
   * 获取某分类下所有有效/激活的服务列表
   * 激活口径 = 「分类总开关打开」或「该分类被 groups 引用激活」；两者取并集后再叠加自定义服务键。
   * @param {string} category
   * @param {object} [runtimeConfig] 可选运行时配置覆写
   * @returns {Array<{ key: string, category: string, service: object }>}
   */
  getActiveServices(category, runtimeConfig) {
    const cfg = runtimeConfig || this.userConfig;
    const catServices = this.services[category] || {};

    // 分类总开关（与 getCoreMatchers / cleaner 的门禁语义保持一致，单一真相源）
    const switchOn = {
      ai: cfg.enableAI !== false,
      streaming: cfg.enableStreaming !== false,
      social: cfg.enableSocial === true,
      game: cfg.enableGame === true,
      system: cfg.enableSystemServices === true,
      dev: true
    }[category] ?? true;

    // 默认激活键表映射
    const activeKeysMap = {
      ai: cfg.aiServices || Object.keys(catServices),
      streaming: cfg.streamingServices || Object.keys(catServices),
      social: cfg.socialServices || Object.keys(catServices),
      game: cfg.gameServices || Object.keys(catServices),
      system: cfg.systemServices || Object.keys(catServices),
      dev: cfg.devServices || Object.keys(catServices)
    };

    const customKeys = Object.keys(cfg.customServices?.[category] || {});
    const refKeys = this.getDeclaredRefKeys(cfg).filter(k => this.isRefableGroup(k, category));
    // 总开关关闭时不再回落到「全部内置键」，只保留 ref 显式声明与自定义服务（列了才激活）
    const baseKeys = switchOn ? (activeKeysMap[category] || Object.keys(catServices)) : [];
    const allowedKeys = [...new Set([...baseKeys, ...customKeys, ...refKeys])];
    const result = [];

    allowedKeys.forEach(key => {
      if (category === 'dev') {
        if (key === 'github' && cfg.enableGitHub === false && !refKeys.includes(key)) return;
        if (key === 'scholar' && cfg.enableScholar === false && !refKeys.includes(key)) return;
      }
      const s = catServices[key];
      if (s) {
        result.push({ key, category, service: s });
      }
    });

    return result;
  }

  /**
   * 获取特征打标规则列表 (供 Core/cleaner 使用)
   * 包含编译后的 RegExp、tag/pool、Emoji 图标与显示文本
   * @param {object} [runtimeConfig]
   * @returns {Array<{ id: string, reg: RegExp, tag: string, pool: string, uiIcon: string, uiText: string }>}
   */
  getCoreMatchers(runtimeConfig) {
    const cfg = runtimeConfig || this.userConfig;
    const matchers = [];

    // 遍历所有允许打标分类
    const categories = ['ai', 'streaming', 'social', 'game', 'dev', 'system'];
    for (const cat of categories) {
      // 检查分类总控开关：开关关闭但被 `groups` ref 显式引用时，仍需打标（列了即生效）
      if (cat === 'ai' && cfg.enableAI === false && !this.hasRefActivation('ai', cfg)) continue;
      if (cat === 'streaming' && cfg.enableStreaming === false && !this.hasRefActivation('streaming', cfg)) continue;
      if (cat === 'social' && !cfg.enableSocial && !this.hasRefActivation('social', cfg)) continue;
      if (cat === 'game' && !cfg.enableGame && !this.hasRefActivation('game', cfg)) continue;
      if (cat === 'system' && !cfg.enableSystemServices && !this.hasRefActivation('system', cfg)) continue;

      const active = this.getActiveServices(cat, cfg);
      const catDefaults = CATEGORY_DEFAULTS[cat] || {};
      for (const { key, service } of active) {
        if (service && service.reg) {
          const compiledReg = compileRegex(service.reg);
          if (compiledReg) {
            matchers.push({
              id: key,
              reg: compiledReg,
              tag: service.tag || key,
              pool: service.pool || key,
              uiIcon: service.emoji || catDefaults.emoji || '',
              uiText: service.name || key
            });
          }
        }
      }
    }

    return matchers;
  }

  /**
   * 导出面向节点重命名与分流展示的服务级特征图标与文本字典 (Feature Maps)
   * 包含 tag, key 与 pool 多维别名映射，支持 O(1) 幂等缓存
   * @returns {{ icons: Record<string, string>, texts: Record<string, string> }}
   */
  getFeatureMaps() {
    if (this._featureMaps) {
      return this._featureMaps;
    }
    const icons = {};
    const texts = {};
    for (const [cat, catServices] of Object.entries(this.services)) {
      const catDefaults = CATEGORY_DEFAULTS[cat] || {};
      for (const [key, service] of Object.entries(catServices)) {
        if (!service) continue;
        const tag = service.tag || key;
        const pool = service.pool || key;
        const emoji = service.emoji || catDefaults.emoji || '';
        const name = service.name || key;

        if (emoji) {
          icons[tag] = emoji;
          icons[key] = emoji;
          if (pool) icons[pool] = emoji;
        }
        if (name) {
          texts[tag] = name;
          texts[key] = name;
          if (pool) texts[pool] = name;
        }
      }
    }
    this._featureMaps = { icons, texts };
    return this._featureMaps;
  }

  /**
   * 计算策略组的展示全名（依据 groupIconMode）
   * @param {object} service
   * @param {string} [mode] "emoji" | "icon" | "both"
   * @returns {string}
   */
  getGroupName(service, mode) {
    const iconMode = mode || this.userConfig.groupIconMode || 'emoji';
    const name = service.name;
    const catDefaults = service.category ? CATEGORY_DEFAULTS[service.category] : null;
    const emoji = service.emoji || catDefaults?.emoji || '';

    if (iconMode === 'icon') {
      return name;
    }
    return emoji ? `${emoji} ${name}` : name;
  }

  /**
   * 导出结构化服务注册表对象
   * @returns {object} { ai, streaming, social, game, dev, system, aggregates, specialized }
   */
  toRegistries() {
    const registries = {};
    for (const [cat, catServices] of Object.entries(this.services)) {
      const catDefaults = CATEGORY_DEFAULTS[cat] || {};
      registries[cat] = {};
      for (const [key, s] of Object.entries(catServices)) {
        const cleanName = s.name || key;
        const emoji = s.emoji || catDefaults.emoji || '';
        const fullName = emoji ? `${emoji} ${cleanName}` : cleanName;
        const iconDef = s.icon || catDefaults.icon;
        const iconUrl = resolveIconUrl(iconDef, this.repos.icons);
        const compiledReg = compileRegex(s.reg);

        let providerPath = `geosite/${key}`;
        let ruleSetName = key;
        let rulesArr = [];

        if (s.provider) {
          providerPath = s.provider;
        } else if (s.providerPath) {
          providerPath = s.providerPath.startsWith('geosite/') || s.providerPath.startsWith('geoip/')
            ? s.providerPath
            : `geosite/${s.providerPath}`;
        }

        if (typeof s.rules === 'string') {
          if (!s.provider && !s.providerPath) providerPath = `geosite/${s.rules}`;
          ruleSetName = s.rules;
          const target = resolveRuleTarget(s.target, cat, cleanName, catDefaults);
          rulesArr = [`RULE-SET,${s.rules},${target}`];
        } else if (Array.isArray(s.rules)) {
          if (!s.provider && !s.providerPath) {
            const ruleSetItem = s.rules.find(r => r && r.type === 'RULE-SET' && r.path);
            if (ruleSetItem) {
              providerPath = `geosite/${ruleSetItem.path}`;
            }
          }
          rulesArr = s.rules.map(r => {
            if (typeof r === 'string') return r;
            const target = resolveRuleTarget(r.target, cat, cleanName, catDefaults);
            return `${r.type},${r.value},${target}`;
          });
        } else if (s.rules && typeof s.rules === 'object') {
          ruleSetName = s.rules.name || key;
          if (!s.provider && !s.providerPath) {
            providerPath = s.rules.path ? `geosite/${s.rules.path}` : `geosite/${ruleSetName}`;
          }
          const target = resolveRuleTarget(s.rules.target || s.target, cat, cleanName, catDefaults);
          rulesArr = [`RULE-SET,${ruleSetName},${target}`];
        }

        registries[cat][key] = {
          tag: s.tag || key,
          name: cleanName,
          cleanName,
          fullName,
          iconUrl,
          uiIcon: emoji,
          reg: compiledReg,
          provider: s.provider || providerPath,
          ruleSet: s.ruleSet || ruleSetName,
          pool: s.pool || key,
          rules: rulesArr,
          proxies: s.proxies ? [...s.proxies] : undefined,
          preferredRegions: s.preferredRegions || catDefaults.preferredRegions || [],
          type: s.type,
          match: s.match,
          exclude: s.exclude,
          hidden: s.hidden
        };
      }
    }

    // 聚合策略组全量投影 (外观 + 拓扑配方)
    const aggregates = {};
    for (const catDef of Object.values(CATEGORY_DEFAULTS)) {
      if (catDef.aggregates) {
        for (const [aggKey, meta] of Object.entries(catDef.aggregates)) {
          aggregates[meta.name] = {
            key: aggKey,
            name: meta.name,
            cleanName: meta.name,
            fullName: meta.emoji ? `${meta.emoji} ${meta.name}` : meta.name,
            uiIcon: meta.emoji || '',
            iconUrl: resolveIconUrl(meta.icon, this.repos.icons),
            proxies: meta.proxies ? [...meta.proxies] : undefined
          };
        }
      }
    }
    registries.aggregates = aggregates;

    // 专项独立服务全量投影 (Crypto, PayPal, WebRTC, Telegram - 包含 rules/providers/process/proxies)
    const specialized = {};
    for (const [specKey, spec] of Object.entries(SPECIAL_SERVICES)) {
      specialized[specKey] = {
        key: specKey,
        name: spec.name,
        cleanName: spec.name,
        fullName: spec.emoji ? `${spec.emoji} ${spec.name}` : spec.name,
        uiIcon: spec.emoji || '',
        iconUrl: resolveIconUrl(spec.icon, this.repos.icons),
        configKey: spec.configKey,
        providers: spec.providers ? { ...spec.providers } : {},
        rules: spec.rules ? [...spec.rules] : [],
        process: spec.process ? { ...spec.process } : undefined,
        preferredRegions: spec.preferredRegions ? [...spec.preferredRegions] : undefined,
        proxies: spec.proxies ? [...spec.proxies] : undefined
      };
    }
    registries.specialized = specialized;

    // 内置策略组目录 (供 `groups: [{ ref: <键> }]` 引用)：
    // 条目必须自身就是一条「完整组声明」(match + proxies 齐备) 才可被引用，
    // 否则引用它只会得到空壳组——那是「配了不生效」，必须 fail-closed 而非静默降级。
    // 该目录不是第二份真相源：它只是同一批 catalog 条目的另一种投影形态。
    const groupDirectory = {};
    for (const [cat, catReg] of Object.entries(registries)) {
      if (cat === 'aggregates' || cat === 'specialized') continue;
      for (const [key, item] of Object.entries(catReg)) {
        if (!item || !item.match || !Array.isArray(item.proxies) || item.proxies.length === 0) continue;
        // AI 大类偏好地区允许用户用 aiPreferredRegions 全局覆写（与内置配方口径一致）
        const prefOverride = cat === 'ai' && Array.isArray(this.userConfig.aiPreferredRegions)
          ? this.userConfig.aiPreferredRegions
          : null;
        groupDirectory[key] = {
          name: item.cleanName,
          type: item.type || 'select',
          match: item.match,
          exclude: item.exclude,
          proxies: [...item.proxies],
          preferredRegions: prefOverride || [...(item.preferredRegions || [])],
          rules: [...(item.rules || [])],
          providers: (item.rules && item.rules.length > 0 && item.provider)
            ? { [item.ruleSet]: item.provider }
            : undefined,
          hidden: item.hidden
        };
      }
    }
    registries.groups = groupDirectory;

    return registries;
  }
}

/**
 * 组装生成完整的 ServiceCatalog 实例
 * @param {object} [userConfig={}]
 * @returns {ServiceCatalog}
 */
function buildServiceCatalog(userConfig = {}) {
  // 1. 组装全局仓库
  const repos = {
    cdn: userConfig.ruleProviderCDN || DEFAULT_REPOS.cdn,
    geosite: userConfig.geositeRepo || DEFAULT_REPOS.geosite,
    geoip: userConfig.geoipRepo || DEFAULT_REPOS.geoip,
    icons: {
      orz: userConfig.iconRepoOrz || DEFAULT_REPOS.icons.orz,
      koolson: userConfig.iconRepoKoolson || DEFAULT_REPOS.icons.koolson,
      lige47: userConfig.iconRepoLige47 || DEFAULT_REPOS.icons.lige47
    }
  };

  // 2. 初始化服务字典（深拷贝内置默认基准）
  const mergedServices = {};
  for (const [cat, sMap] of Object.entries(BUILTIN_SERVICES)) {
    mergedServices[cat] = {};
    for (const [k, v] of Object.entries(sMap)) {
      mergedServices[cat][k] = { category: cat, ...v };
    }
  }

  // 3. 增量合并用户的自定义服务 (customServices)
  const custom = userConfig.customServices || {};
  for (const [cat, catCustom] of Object.entries(custom)) {
    if (!mergedServices[cat]) {
      mergedServices[cat] = {};
    }
    for (const [key, def] of Object.entries(catCustom || {})) {
      if (!def) continue;

      // 规范化用户传入的定义
      const normalized = { category: cat, ...def };
      if (normalized.reg) {
        normalized.reg = compileRegex(normalized.reg);
      }
      if (normalized.icon && typeof normalized.icon === 'string' && !normalized.icon.startsWith('http')) {
        normalized.icon = { repo: 'koolson', file: normalized.icon };
      }

      if (mergedServices[cat][key]) {
        // 用户修改已有服务 -> 深度合并，保留官方未被修改的字段
        mergedServices[cat][key] = deepMerge(mergedServices[cat][key], normalized);
      } else {
        // 用户新增全新服务 -> 直接注册
        mergedServices[cat][key] = normalized;
      }
    }
  }

  return new ServiceCatalog(mergedServices, repos, userConfig);
}

module.exports = {
  compileRegex,
  resolveIconUrl,
  resolveRuleTarget,
  deepMerge,
  CATEGORY_DEFAULTS,
  DEFAULT_AGGREGATES,
  SPECIAL_SERVICES,
  BUILTIN_SERVICES,
  ServiceCatalog,
  buildServiceCatalog
};
