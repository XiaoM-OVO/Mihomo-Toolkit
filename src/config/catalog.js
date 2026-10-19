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
const DEFAULT_AGGREGATE_GROUPS = Object.freeze({
  '游戏服务': { emoji: '🎮', icon: { repo: 'koolson', file: 'Game.png' } },
  '游戏下载': { emoji: '🎮', icon: { repo: 'koolson', file: 'Game.png' } },
  '社交平台': { emoji: '💬', icon: { repo: 'koolson', file: 'Discord.png' } }
});

const SPECIAL_SERVICES = Object.freeze({
  crypto: {
    name: '加密货币',
    emoji: '🪙',
    icon: { repo: 'koolson', file: 'Cryptocurrency.png' },
    configKey: 'enableCrypto',
    providers: { crypto: 'geosite/category-cryptocurrency' },
    rules: ['RULE-SET,crypto,加密货币']
  },
  paypal: {
    name: 'PayPal',
    emoji: '💳',
    icon: { repo: 'koolson', file: 'PayPal.png' },
    configKey: 'enablePayPal',
    providers: { paypal: 'geosite/paypal' },
    rules: ['RULE-SET,paypal,PayPal']
  },
  webrtc: {
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
    ]
  },
  telegram: {
    name: 'Telegram',
    emoji: '✈️',
    icon: { repo: 'koolson', file: 'Telegram.png' },
    configKey: 'enableTelegram',
    providers: { telegram: 'geosite/telegram', 'telegram-ip': 'geoip/telegram' },
    rules: ({ isWin, isMac, isLin }) => [
      ...(isWin ? ['PROCESS-NAME,Telegram.exe,Telegram'] : []),
      ...(isMac || isLin ? ['PROCESS-NAME,Telegram,Telegram'] : []),
      'RULE-SET,telegram,Telegram',
      'RULE-SET,telegram-ip,Telegram,no-resolve'
    ]
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
    aggregateGroups: {
      '社交平台': DEFAULT_AGGREGATE_GROUPS['社交平台']
    }
  },
  game: {
    preferredRegions: [],
    emoji: '🎮',
    icon: { repo: 'koolson', file: 'Game.png' },
    aggregateGroups: {
      '游戏服务': DEFAULT_AGGREGATE_GROUPS['游戏服务'],
      '游戏下载': DEFAULT_AGGREGATE_GROUPS['游戏下载']
    }
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
  ai: {
    chatgpt: {
      name: 'ChatGPT',
      emoji: '🤖',
      reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i,
      rules: 'openai',
      icon: { repo: 'orz', file: 'OpenAI.png' }
    },
    gemini: {
      name: 'Gemini',
      emoji: '♊',
      reg: /\bGemini\b/i,
      rules: { name: 'gemini', path: 'google-gemini' },
      icon: { repo: 'koolson', file: 'AI.png' }
    },
    claude: {
      name: 'Claude',
      emoji: '🦀',
      reg: /\bClaude\b/i,
      rules: { name: 'claude', path: 'anthropic' },
      icon: { repo: 'lige47', file: '04ProxySoft/claude(1).png' }
    },
    copilot: {
      name: 'Copilot',
      emoji: '🐙',
      reg: /\b(?:Copilot|Bing)\b/i,
      rules: { name: 'bing', path: 'bing' },
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
        { type: 'DOMAIN-SUFFIX', value: 'steamcontent.com', target: 'GAME_DOWNLOAD' },
        { type: 'RULE-SET', value: 'steam-cn', path: 'steam@cn', target: 'GAME_DOWNLOAD' },
        { type: 'RULE-SET', value: 'steam', path: 'steam', target: 'GAME_SERVICE' }
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
        { type: 'DOMAIN-SUFFIX', value: 'download.epicgames.com', target: 'GAME_DOWNLOAD' },
        { type: 'RULE-SET', value: 'epic', path: 'epicgames', target: 'GAME_SERVICE' },
        { type: 'DOMAIN-SUFFIX', value: 'epicgames.com', target: 'GAME_SERVICE' }
      ]
    },
    riot: {
      name: 'Riot',
      rules: [{ type: 'RULE-SET', value: 'riot', path: 'riot', target: 'GAME_SERVICE' }]
    },
    blizzard: {
      name: 'Blizzard',
      rules: [{ type: 'RULE-SET', value: 'blizzard', path: 'blizzard', target: 'GAME_SERVICE' }]
    },
    nintendo: {
      name: 'Nintendo',
      rules: [{ type: 'RULE-SET', value: 'nintendo', path: 'nintendo', target: 'GAME_SERVICE' }]
    },
    playstation: {
      name: 'PlayStation',
      rules: [{ type: 'RULE-SET', value: 'playstation', path: 'playstation', target: 'GAME_SERVICE' }]
    },
    xbox: {
      name: 'Xbox',
      rules: [{ type: 'RULE-SET', value: 'xbox', path: 'xbox', target: 'GAME_SERVICE' }]
    },
    ubisoft: {
      name: 'Ubisoft',
      rules: [{ type: 'RULE-SET', value: 'ubisoft', path: 'ubisoft', target: 'GAME_SERVICE' }]
    },
    origin: {
      name: 'Origin',
      rules: [{ type: 'RULE-SET', value: 'origin', path: 'origin', target: 'GAME_SERVICE' }]
    },
    ea: {
      name: 'EA',
      rules: [{ type: 'RULE-SET', value: 'ea', path: 'ea', target: 'GAME_SERVICE' }]
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
   * 获取某分类下所有有效/激活的服务列表
   * @param {string} category
   * @param {object} [runtimeConfig] 可选运行时配置覆写
   * @returns {Array<{ key: string, category: string, service: object }>}
   */
  getActiveServices(category, runtimeConfig) {
    const cfg = runtimeConfig || this.userConfig;
    const catServices = this.services[category] || {};

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
    const baseKeys = activeKeysMap[category] || Object.keys(catServices);
    const allowedKeys = [...new Set([...baseKeys, ...customKeys])];
    const result = [];

    allowedKeys.forEach(key => {
      if (category === 'dev') {
        if (key === 'github' && cfg.enableGitHub === false) return;
        if (key === 'scholar' && cfg.enableScholar === false) return;
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
      // 检查分类总控开关
      if (cat === 'ai' && cfg.enableAI === false) continue;
      if (cat === 'streaming' && cfg.enableStreaming === false) continue;
      if (cat === 'social' && !cfg.enableSocial) continue;
      if (cat === 'game' && !cfg.enableGame) continue;
      if (cat === 'system' && !cfg.enableSystemServices) continue;

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
   * @returns {object} { ai, streaming, social, game, dev, system, _aggregate, _specialized }
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
          const target = cat === 'game' ? '游戏服务' : cleanName;
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
            let target = r.target;
            if (target === 'GAME_DOWNLOAD') {
              target = '游戏下载';
            } else if (target === 'GAME_SERVICE') {
              target = '游戏服务';
            } else if (target === '@self' || !target) {
              target = cat === 'game' ? '游戏服务' : cleanName;
            }
            return `${r.type},${r.value},${target}`;
          });
        } else if (s.rules && typeof s.rules === 'object') {
          ruleSetName = s.rules.name || key;
          if (!s.provider && !s.providerPath) {
            providerPath = s.rules.path ? `geosite/${s.rules.path}` : `geosite/${ruleSetName}`;
          }
          const target = cat === 'game' ? '游戏服务' : cleanName;
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
          preferredRegions: s.preferredRegions || catDefaults.preferredRegions || []
        };
      }
    }

    // 聚合策略组投影 (如 '游戏服务', '游戏下载', '社交平台')
    const aggregate = {};
    for (const catDef of Object.values(CATEGORY_DEFAULTS)) {
      if (catDef.aggregateGroups) {
        for (const [groupName, meta] of Object.entries(catDef.aggregateGroups)) {
          aggregate[groupName] = {
            cleanName: groupName,
            fullName: meta.emoji ? `${meta.emoji} ${groupName}` : groupName,
            uiIcon: meta.emoji || '',
            iconUrl: resolveIconUrl(meta.icon, this.repos.icons)
          };
        }
      }
    }
    registries._aggregate = aggregate;

    // 专项独立服务投影 (如 'Telegram', '加密货币', 'PayPal', 'WebRTC')
    const specialized = {};
    for (const [specKey, spec] of Object.entries(SPECIAL_SERVICES)) {
      specialized[specKey] = {
        cleanName: spec.name,
        fullName: spec.emoji ? `${spec.emoji} ${spec.name}` : spec.name,
        uiIcon: spec.emoji || '',
        iconUrl: resolveIconUrl(spec.icon, this.repos.icons)
      };
    }
    registries._specialized = specialized;

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
  deepMerge,
  CATEGORY_DEFAULTS,
  DEFAULT_AGGREGATE_GROUPS,
  SPECIAL_SERVICES,
  BUILTIN_SERVICES,
  ServiceCatalog,
  buildServiceCatalog
};
