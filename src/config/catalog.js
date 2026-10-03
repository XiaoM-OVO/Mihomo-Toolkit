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
// 2. 六维分类默认策略 (CATEGORY_DEFAULTS)
// ─────────────────────────────────────────────────────────────
const CATEGORY_DEFAULTS = {
  ai: {
    groupType: 'select',
    preferredRegions: ['us', 'jp', 'tw', 'sg', 'kr', 'eu'],
    includeStandard: false,
    noDirect: false
  },
  streaming: {
    groupType: 'select',
    preferredRegions: [],
    includeStandard: true,
    noDirect: false
  },
  social: {
    groupType: 'select',
    preferredRegions: [],
    includeStandard: true,
    noDirect: false
  },
  game: {
    groupType: 'select',
    preferredRegions: [],
    includeStandard: true,
    noDirect: false
  },
  dev: {
    groupType: 'select',
    preferredRegions: [],
    includeStandard: true,
    noDirect: false
  },
  system: {
    groupType: 'select',
    preferredRegions: [],
    includeStandard: true,
    noDirect: false
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

  // ④ 游戏服务
  game: {
    steam: {
      name: 'Steam',
      emoji: '🎮',
      rules: [
        { type: 'DOMAIN-SUFFIX', value: 'steamcontent.com', target: 'GAME_DOWNLOAD' },
        { type: 'RULE-SET', value: 'steam-cn', path: 'steam@cn', target: 'GAME_DOWNLOAD' },
        { type: 'RULE-SET', value: 'steam', path: 'steam', target: 'GAME_SERVICE' }
      ],
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    'steam-cn': {
      name: 'Steam CN',
      emoji: '🎮',
      rules: [],
      providerOnly: true,
      providerPath: 'steam@cn',
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    epic: {
      name: 'Epic',
      emoji: '🎮',
      providerPath: 'epicgames',
      rules: [
        { type: 'DOMAIN-SUFFIX', value: 'download.epicgames.com', target: 'GAME_DOWNLOAD' },
        { type: 'RULE-SET', value: 'epic', path: 'epicgames', target: 'GAME_SERVICE' },
        { type: 'DOMAIN-SUFFIX', value: 'epicgames.com', target: 'GAME_SERVICE' }
      ],
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    riot: {
      name: 'Riot',
      emoji: '🎮',
      rules: [{ type: 'RULE-SET', value: 'riot', path: 'riot', target: 'GAME_SERVICE' }],
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    blizzard: {
      name: 'Blizzard',
      emoji: '🎮',
      rules: [{ type: 'RULE-SET', value: 'blizzard', path: 'blizzard', target: 'GAME_SERVICE' }],
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    nintendo: {
      name: 'Nintendo',
      emoji: '🎮',
      rules: [{ type: 'RULE-SET', value: 'nintendo', path: 'nintendo', target: 'GAME_SERVICE' }],
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    playstation: {
      name: 'PlayStation',
      emoji: '🎮',
      rules: [{ type: 'RULE-SET', value: 'playstation', path: 'playstation', target: 'GAME_SERVICE' }],
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    xbox: {
      name: 'Xbox',
      emoji: '🎮',
      rules: [{ type: 'RULE-SET', value: 'xbox', path: 'xbox', target: 'GAME_SERVICE' }],
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    ubisoft: {
      name: 'Ubisoft',
      emoji: '🎮',
      rules: [{ type: 'RULE-SET', value: 'ubisoft', path: 'ubisoft', target: 'GAME_SERVICE' }],
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    origin: {
      name: 'Origin',
      emoji: '🎮',
      rules: [{ type: 'RULE-SET', value: 'origin', path: 'origin', target: 'GAME_SERVICE' }],
      icon: { repo: 'koolson', file: 'Game.png' }
    },
    ea: {
      name: 'EA',
      emoji: '🎮',
      rules: [{ type: 'RULE-SET', value: 'ea', path: 'ea', target: 'GAME_SERVICE' }],
      icon: { repo: 'koolson', file: 'Game.png' }
    }
  },

  // ⑤ 开发者与学术
  dev: {
    github: {
      name: 'GitHub',
      emoji: '🐱',
      rules: 'github',
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
      icon: { repo: 'orz', file: 'Google.png' }
    },
    apple: {
      name: 'Apple',
      emoji: '🍎',
      rules: 'apple',
      icon: { repo: 'orz', file: 'Apple.png' }
    },
    microsoft: {
      name: 'Microsoft',
      emoji: '🪟',
      rules: 'microsoft',
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
    if (iconDef.startsWith('http://') || iconDef.startsWith('https://')) {
      return iconDef;
    }
    // 兼容老版直接写全名的情况
    return `${repoMap.koolson || ''}${iconDef}`;
  }
  if (typeof iconDef === 'object') {
    if (iconDef.url) return iconDef.url;
    const repoBase = (iconDef.repo && repoMap[iconDef.repo]) || iconDef.repo || repoMap.koolson || '';
    const file = iconDef.file || '';
    return `${repoBase}${file}`;
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

    const allowedKeys = activeKeysMap[category] || Object.keys(catServices);
    const result = [];

    allowedKeys.forEach(key => {
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
      for (const { key, service } of active) {
        if (service.reg) {
          const compiledReg = compileRegex(service.reg);
          if (compiledReg) {
            matchers.push({
              id: key,
              reg: compiledReg,
              tag: service.tag || key,
              pool: service.pool || key,
              uiIcon: service.emoji || service.uiIcon || '',
              uiText: service.cleanName || service.name || key
            });
          }
        }
      }
    }

    return matchers;
  }

  /**
   * 计算策略组的展示全名（依据 groupIconMode）
   * @param {object} service
   * @param {string} [mode] "emoji" | "icon" | "both"
   * @returns {string}
   */
  getGroupName(service, mode) {
    const iconMode = mode || this.userConfig.groupIconMode || 'emoji';
    const cleanName = service.cleanName || service.name;
    const emoji = service.emoji || '';

    if (iconMode === 'icon') {
      return cleanName;
    }
    return emoji ? `${emoji} ${cleanName}` : cleanName;
  }

  /**
   * 获取策略组在线图标全息字典 (供 Strategy/icons 使用)
   * @returns {Record<string, { icon: string, newName: string }>}
   */
  getGroupIconMap() {
    const mapping = {};
    for (const catServices of Object.values(this.services)) {
      for (const service of Object.values(catServices)) {
        if (service && service.name) {
          const fullName = service.emoji ? `${service.emoji} ${service.name}` : service.name;
          const cleanName = service.cleanName || service.name;
          const iconUrl = resolveIconUrl(service.icon || service.iconUrl, this.repos.icons);
          if (iconUrl) {
            mapping[fullName] = { icon: iconUrl, newName: cleanName };
            mapping[cleanName] = { icon: iconUrl, newName: cleanName };
          }
        }
      }
    }
    return mapping;
  }

  /**
   * 导出结构化服务注册表对象
   * @returns {object} { ai, streaming, social, game, dev, system }
   */
  toRegistries() {
    const registries = {};
    for (const [cat, catServices] of Object.entries(this.services)) {
      registries[cat] = {};
      for (const [key, s] of Object.entries(catServices)) {
        const cleanName = s.cleanName || s.name;
        const fullName = s.emoji ? `${s.emoji} ${cleanName}` : cleanName;
        const iconUrl = resolveIconUrl(s.icon || s.iconUrl, this.repos.icons);
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
          rulesArr = [`RULE-SET,${s.rules},${cleanName}`];
        } else if (Array.isArray(s.rules)) {
          if (!s.provider && !s.providerPath) {
            const ruleSetItem = s.rules.find(r => r && r.type === 'RULE-SET' && r.path);
            if (ruleSetItem) {
              providerPath = `geosite/${ruleSetItem.path}`;
            }
          }
          rulesArr = s.rules.map(r => {
            if (typeof r === 'string') return r;
            const target = r.target === '@self' ? cleanName : (r.target === 'GAME_DOWNLOAD' ? '游戏下载' : (r.target === 'GAME_SERVICE' ? '游戏服务' : (r.target || cleanName)));
            return `${r.type},${r.value},${target}`;
          });
        } else if (s.rules && typeof s.rules === 'object') {
          ruleSetName = s.rules.name || key;
          if (!s.provider && !s.providerPath) {
            providerPath = s.rules.path ? `geosite/${s.rules.path}` : `geosite/${ruleSetName}`;
          }
          rulesArr = [`RULE-SET,${ruleSetName},${cleanName}`];
        }

        registries[cat][key] = {
          tag: s.tag || key,
          name: cleanName,
          cleanName,
          fullName,
          iconUrl,
          uiIcon: s.emoji || s.uiIcon || '',
          reg: compiledReg,
          provider: s.provider || providerPath,
          ruleSet: s.ruleSet || ruleSetName,
          pool: s.pool || key,
          rules: rulesArr,
          preferredRegions: s.preferredRegions || CATEGORY_DEFAULTS[cat]?.preferredRegions || []
        };
      }
    }
    return registries;
  }

  /** @deprecated 请直接使用 toRegistries() */
  toLegacyRegistries() {
    return this.toRegistries();
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
  let mergedServices = {};
  for (const [cat, sMap] of Object.entries(BUILTIN_SERVICES)) {
    mergedServices[cat] = {};
    for (const [k, v] of Object.entries(sMap)) {
      mergedServices[cat][k] = { ...v };
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
      const normalized = { ...def };
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
  DEFAULT_REPOS,
  CATEGORY_DEFAULTS,
  BUILTIN_SERVICES,
  compileRegex,
  resolveIconUrl,
  deepMerge,
  ServiceCatalog,
  buildServiceCatalog
};
