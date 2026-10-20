/**
 * -----------------------------------------------------------------------------
 * 展示层终末装配器 (Presentation Assembler)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 终末单一职责：流水线内部全链路使用规范纯净中文（如 "自动选择"、"漏网之鱼"、"香港节点"），
 *    仅在最终交付前的最后一刻统一根据 groupIconMode ("emoji" | "both" | "icon") 渲染装饰。
 * 2. icon 模式：内部纯净名即最终交付名，零字符串替换，直接装配 g.icon。
 * 3. emoji / both 模式：依据统一字典一次性赋予徽标并安全更新 rules/proxies 引用。
 */

const { getEnhancedRegionDefs, CONTINENT_DEFS } = require('../core/shared/regions');
const { replaceRuleTarget } = require('../core/chinese-sync');
const { FIELDS_BY_KEY } = require('../data');

const GROUP_DECORATION_PREFIX = /^[^\p{L}\p{N}]+/u;

/**
 * 非中国大中华核心区组名集合：用于 `@nonCnRegions` 宏剔除。
 * 语义与 catalog.js 的 TikTok 组选点保持一致（含「未知识别」，不含澳门/台湾）。
 */
const NON_CN_EXCLUDED_GROUPS = ['香港节点', '大陆节点', '中国节点', '未知识别'];

/** 「中国分流」策略组引用的中国大中华核心地区组（含港澳台） */
const CN_CORE_PROXY_GROUPS = ['大陆节点', '香港节点', '澳门节点', '台湾节点'];

function stripGroupDecoration(rawName) {
  const stripped = String(rawName || '').replace(GROUP_DECORATION_PREFIX, '').trim();
  return stripped || String(rawName || '').trim();
}


const SKELETON_GROUPS = {
  '手动选择':       { emoji: '📍', icon: 'Static.png', repo: 'orz' },
  '自动选择':       { emoji: '🚀', icon: 'Urltest.png', repo: 'orz' },
  '故障转移':       { emoji: '♻️', icon: 'Available.png', repo: 'orz' },
  '下载策略':       { emoji: '⏬', icon: 'Roundrobin.png', repo: 'orz' },
  '负载均衡-轮询':   { emoji: '🔄', icon: 'Roundrobin.png', repo: 'orz' },
  '高倍率优选':     { emoji: '🚀', icon: 'Speedtest.png', repo: 'koolson' },
  '实验节点':       { emoji: '🧪', icon: 'Lab.png', repo: 'koolson' },
  '家宽优选':       { emoji: '🏠', icon: '05icon/home.png', repo: 'lige47' },
  '中国分流':       { emoji: '🇨🇳', icon: 'China_Map.png', repo: 'koolson' },
  '广告拦截':       { emoji: '🚫', icon: 'Reject.png', repo: 'koolson' },
  'IPv6控制台':     { emoji: '🌐', icon: 'Direct.png', repo: 'koolson' },
  '订阅与状态看板':   { emoji: '📊', icon: 'Airport.png', repo: 'koolson' },
  '漏网之鱼':       { emoji: '🐟', icon: 'Final.png', repo: 'koolson' },
  '其他节点':       { emoji: '🌐', icon: 'Global.png', repo: 'koolson' },
  '未知识别':       { emoji: '🗑️', icon: 'Cydia.png', repo: 'koolson' }
};

/** 图标仓库前缀默认值取自字段注册表（单一真相源，避免与配置默认值漂移） */
function resolveIconUrl(iconFile, repo, userConfig = {}) {
  const iconOrz = userConfig.iconRepoOrz || FIELDS_BY_KEY.iconRepoOrz.default;
  const iconKoolson = userConfig.iconRepoKoolson || FIELDS_BY_KEY.iconRepoKoolson.default;
  const iconLige47 = userConfig.iconRepoLige47 || FIELDS_BY_KEY.iconRepoLige47.default;
  if (repo === 'orz') return `${iconOrz}${iconFile}`;
  if (repo === 'lige47') return `${iconLige47}${iconFile}`;
  return `${iconKoolson}${iconFile}`;
}

/**
 * 组装全量映射表 (emojiMap 与 iconMap)
 */
function buildPresentationMaps(userConfig = {}, registries = {}) {
  const emojiMap = {};
  const iconMap = {};

  // 1. 骨架组
  for (const [cleanName, def] of Object.entries(SKELETON_GROUPS)) {
    const fullName = `${def.emoji} ${cleanName}`;
    emojiMap[cleanName] = fullName;
    const url = resolveIconUrl(def.icon, def.repo, userConfig);
    iconMap[cleanName] = url;
    iconMap[fullName] = url;
  }

  // 2. 地区与大洲
  getEnhancedRegionDefs().forEach(r => {
    if (r.groupName && r.icon) {
      const cleanName = r.groupName;
      const fullName = `${r.icon} ${cleanName}`;
      emojiMap[cleanName] = fullName;

      const iconFile = r.iconFile || 'Global.png';
      const url = resolveIconUrl(iconFile, 'koolson', userConfig);
      iconMap[cleanName] = url;
      iconMap[fullName] = url;
    }
  });

  // 兜底补齐：中国节点别名映射到大陆节点
  const cnEmoji = '🇨🇳';
  const cnIconUrl = resolveIconUrl('CN.png', 'koolson', userConfig);
  emojiMap['中国节点'] = `${cnEmoji} 大陆节点`;
  iconMap['中国节点'] = cnIconUrl;
  iconMap[`${cnEmoji} 中国节点`] = cnIconUrl;

  CONTINENT_DEFS.forEach(c => {
    if (c.groupName && c.icon) {
      const cleanName = c.groupName;
      const fullName = `${c.icon} ${cleanName}`;
      emojiMap[cleanName] = fullName;

      const iconFile = c.iconFile || 'Global.png';
      const url = resolveIconUrl(iconFile, 'koolson', userConfig);
      iconMap[cleanName] = url;
      iconMap[fullName] = url;
    }
  });

  // 2.5 哈希负载均衡组（enableRegionHashLB 派生）
  // 组名为「负载均衡-哈希 (地区)」，后缀随地区动态生成、无法被静态骨架字典命中，
  // 故在此按地区元数据补登记：emoji/both 模式追加 ⚖️ 徽标，icon 模式剥离并挂载图标。
  const hashLbSuffixes = new Set(['大陆']);
  getEnhancedRegionDefs().forEach(r => {
    if (r.id !== 'cn' && r.name !== '中国' && r.name) hashLbSuffixes.add(r.name);
  });
  CONTINENT_DEFS.forEach(c => {
    if (c.name) hashLbSuffixes.add(c.name);
  });
  const hashLbIconUrl = resolveIconUrl('Roundrobin.png', 'orz', userConfig);
  for (const suffix of hashLbSuffixes) {
    const cleanName = `负载均衡-哈希 (${suffix})`;
    const fullName = `⚖️ ${cleanName}`;
    emojiMap[cleanName] = fullName;
    iconMap[cleanName] = hashLbIconUrl;
    iconMap[fullName] = hashLbIconUrl;
  }

  // 3. 业务服务注册表 (AI, Streaming, Dev, System, 聚合组及专项组等)
  let effectiveRegistries = (registries && Object.keys(registries).length > 0) ? registries : null;
  if (!effectiveRegistries && userConfig.catalog && typeof userConfig.catalog.toRegistries === 'function') {
    effectiveRegistries = userConfig.catalog.toRegistries();
  }
  if (!effectiveRegistries && userConfig.registries && Object.keys(userConfig.registries).length > 0) {
    effectiveRegistries = userConfig.registries;
  }
  if (!effectiveRegistries) {
    try {
      const { buildServiceCatalog } = require('../config/catalog');
      effectiveRegistries = buildServiceCatalog(userConfig).toRegistries();
    } catch {
      effectiveRegistries = {};
    }
  }

  // 确保聚合组与专项组元数据保底挂载 (如外部传入了精简的自定义 registries 字典)
  const { SPECIAL_SERVICES } = require('../config/catalog');
  const aggregateSources = effectiveRegistries.aggregates || {};
  for (const [cleanName, def] of Object.entries(aggregateSources)) {
    const fullName = def.fullName || (def.uiIcon ? `${def.uiIcon} ${cleanName}` : cleanName);
    emojiMap[cleanName] = fullName;
    emojiMap[fullName] = fullName;
    const iconUrl = def.iconUrl || (def.icon ? resolveIconUrl(def.icon.file || def.icon, def.icon.repo || def.repo || 'koolson', userConfig) : null);
    if (iconUrl) {
      iconMap[cleanName] = iconUrl;
      iconMap[fullName] = iconUrl;
    }
  }

  const specialSources = effectiveRegistries.specialized || SPECIAL_SERVICES;
  for (const def of Object.values(specialSources)) {
    const cleanName = def.cleanName || def.name;
    if (!cleanName) continue;
    const fullName = def.fullName || (def.uiIcon ? `${def.uiIcon} ${cleanName}` : cleanName);
    emojiMap[cleanName] = fullName;
    emojiMap[fullName] = fullName;
    const iconUrl = def.iconUrl || (def.icon ? resolveIconUrl(def.icon.file || def.icon, def.icon.repo || def.repo || 'koolson', userConfig) : null);
    if (iconUrl) {
      iconMap[cleanName] = iconUrl;
      iconMap[fullName] = iconUrl;
    }
  }

  for (const [catName, catServices] of Object.entries(effectiveRegistries)) {
    if (catName === 'aggregates' || catName === 'specialized') continue;
    if (catServices && typeof catServices === 'object') {
      Object.values(catServices).forEach(item => {
        if (item && item.cleanName) {
          const cleanName = item.cleanName;
          const fullName = item.fullName || (item.uiIcon ? `${item.uiIcon} ${cleanName}` : cleanName);
          emojiMap[cleanName] = fullName;
          emojiMap[fullName] = fullName;
          if (item.iconUrl) {
            iconMap[cleanName] = item.iconUrl;
            iconMap[fullName] = item.iconUrl;
          }
        }
      });
    }
  }

  // 4. 用户全局组图标与 Emoji 自定义覆盖 (groupIcons)
  const explicitIcons = new Set();
  if (userConfig.groupIcons && typeof userConfig.groupIcons === 'object') {
    for (const [groupName, iconConf] of Object.entries(userConfig.groupIcons)) {
      if (!groupName || !iconConf) continue;
      const cleanName = stripGroupDecoration(groupName);

      if (typeof iconConf === 'string') {
        if (/\p{Extended_Pictographic}/u.test(iconConf)) {
          const emoji = iconConf.trim();
          const fullName = `${emoji} ${cleanName}`;
          emojiMap[cleanName] = fullName;
          emojiMap[groupName] = fullName;
          emojiMap[fullName] = fullName;
        } else {
          const iconUrl = iconConf.startsWith('http') ? iconConf : resolveIconUrl(iconConf, 'koolson', userConfig);
          iconMap[cleanName] = iconUrl;
          explicitIcons.add(cleanName);
          iconMap[groupName] = iconUrl;
          if (emojiMap[cleanName]) iconMap[emojiMap[cleanName]] = iconUrl;
        }
      } else if (typeof iconConf === 'object') {
        if (iconConf.emoji) {
          const emoji = String(iconConf.emoji).trim();
          const fullName = `${emoji} ${cleanName}`;
          emojiMap[cleanName] = fullName;
          emojiMap[groupName] = fullName;
          emojiMap[fullName] = fullName;
        }
        if (iconConf.icon) {
          let iconUrl = '';
          if (typeof iconConf.icon === 'string') {
            iconUrl = iconConf.icon.startsWith('http') ? iconConf.icon : resolveIconUrl(iconConf.icon, 'koolson', userConfig);
          } else if (typeof iconConf.icon === 'object' && iconConf.icon.file) {
            iconUrl = resolveIconUrl(iconConf.icon.file, iconConf.icon.repo || 'koolson', userConfig);
          }
          if (iconUrl) {
            iconMap[cleanName] = iconUrl;
            explicitIcons.add(cleanName);
            iconMap[groupName] = iconUrl;
            if (emojiMap[cleanName]) iconMap[emojiMap[cleanName]] = iconUrl;
          }
        }
      }
    }
  }

  // 5. 自定义策略组 DSL (customGroups) 图标与 Emoji 注册 (防双重 Emoji 拼接)
  if (Array.isArray(userConfig.customGroups)) {
    for (const g of userConfig.customGroups) {
      if (!g || !g.name) continue;
      const cleanName = stripGroupDecoration(g.name);
      const extractedEmoji = g.name.match(GROUP_DECORATION_PREFIX)?.[0]?.trim() || '';
      const emoji = (g.emoji ? String(g.emoji).trim() : '') || extractedEmoji;
      const fullName = emoji ? `${emoji} ${cleanName}` : cleanName;
      if (emoji) {
        emojiMap[cleanName] = fullName;
        emojiMap[g.name] = fullName;
        emojiMap[fullName] = fullName;
      }
      if (g.icon) {
        let iconUrl = '';
        if (typeof g.icon === 'string') {
          iconUrl = g.icon.startsWith('http') ? g.icon : resolveIconUrl(g.icon, 'koolson', userConfig);
        } else if (typeof g.icon === 'object' && g.icon.file) {
          iconUrl = resolveIconUrl(g.icon.file, g.icon.repo || 'koolson', userConfig);
        }
        if (iconUrl) {
          iconMap[cleanName] = iconUrl;
          explicitIcons.add(cleanName);
          iconMap[g.name] = iconUrl;
          iconMap[fullName] = iconUrl;
        }
      }
    }
  }

  return { emojiMap, iconMap, explicitIcons };
}

/**
 * 在流水线终末执行展示层装配
 * @param {object} config 待交付的 Mihomo 配置对象
 * @param {object} [userConfig={}] 用户全局配置
 * @param {object} [registries={}] 服务注册表
 */
function applyPresentation(config, userConfig = {}, registries = {}) {
  const mode = userConfig.groupIconMode || 'emoji';
  const { emojiMap, iconMap, explicitIcons } = buildPresentationMaps(userConfig, registries);

  // 模式 0: 纯文本无图标模式 (none) - 保持纯净中文组名，零 Emoji 装饰，零 g.icon 挂载
  if (mode === 'none') {
    const stripMap = {};
    (config['proxy-groups'] || []).forEach(g => {
      const rawName = g.name;
      const clean = stripGroupDecoration(rawName);
      if (rawName !== clean) {
        g.name = clean;
        stripMap[rawName] = clean;
      }
      delete g.icon;
    });
    if (Object.keys(stripMap).length > 0) {
      (config['proxy-groups'] || []).forEach(g => {
        if (Array.isArray(g.proxies)) {
          g.proxies = g.proxies.map(p => stripMap[p] || p);
        }
      });
      if (Array.isArray(config.rules)) {
        config.rules = config.rules.map(rule => replaceRuleTarget(rule, stripMap));
      }
      if (config['rule-providers'] && typeof config['rule-providers'] === 'object') {
        Object.values(config['rule-providers']).forEach(rp => {
          if (rp && rp.proxy && stripMap[rp.proxy]) {
            rp.proxy = stripMap[rp.proxy];
          }
        });
      }
    }
    return;
  }

  // 模式 1: 纯图标模式 (icon) - 内部纯净中文即最终名字，零字符串替换，仅挂载 g.icon
  if (mode === 'icon') {
    const stripMap = {};
    (config['proxy-groups'] || []).forEach(g => {
      const rawName = g.name;
      const clean = stripGroupDecoration(rawName);
      if (rawName !== clean) {
        g.name = clean;
        stripMap[rawName] = clean;
      }
      const iconUrl = iconMap[g.name] || iconMap[clean] || iconMap[rawName];
      if (iconUrl && !g.icon) {
        g.icon = iconUrl;
      }
    });
    if (Object.keys(stripMap).length > 0) {
      (config['proxy-groups'] || []).forEach(g => {
        if (Array.isArray(g.proxies)) {
          g.proxies = g.proxies.map(p => stripMap[p] || p);
        }
      });
      if (Array.isArray(config.rules)) {
        config.rules = config.rules.map(rule => replaceRuleTarget(rule, stripMap));
      }
      if (config['rule-providers'] && typeof config['rule-providers'] === 'object') {
        Object.values(config['rule-providers']).forEach(rp => {
          if (rp && rp.proxy && stripMap[rp.proxy]) {
            rp.proxy = stripMap[rp.proxy];
          }
        });
      }
    }
    return;
  }

  // 模式 2 & 3: emoji 或 both 模式 - 统一追加 Emoji 徽标，both 额外注入在线图标
  const needIcons = mode === 'both';

  // 1. 策略组更名与内部代理更名
  (config['proxy-groups'] || []).forEach(g => {
    const rawName = g.name;
    const clean = stripGroupDecoration(rawName);
    const targetName = emojiMap[clean] || emojiMap[rawName];
    if (targetName) {
      g.name = targetName;
    }
    const shouldMount = needIcons || (explicitIcons && (explicitIcons.has(clean) || explicitIcons.has(rawName)));
    const iconUrl = iconMap[g.name] || iconMap[clean] || iconMap[rawName];
    if (shouldMount && iconUrl && !g.icon) {
      g.icon = iconUrl;
    }
    if (Array.isArray(g.proxies)) {
      g.proxies = g.proxies.map(p => emojiMap[stripGroupDecoration(p)] || emojiMap[p] || p);
    }
  });

  // 2. 规则组按 TARGET 字段精准替换（杜绝误伤规则类型、参数或域名关键字）
  if (Array.isArray(config.rules)) {
    const fullRenameMap = { ...emojiMap };
    for (const [k, v] of Object.entries(emojiMap)) {
      const clean = stripGroupDecoration(k);
      if (clean && !fullRenameMap[clean]) fullRenameMap[clean] = v;
    }
    config.rules = config.rules.map(rule => replaceRuleTarget(rule, fullRenameMap));
  }

  // 3. Rule-Providers 的 proxy 引用更新
  if (config['rule-providers'] && typeof config['rule-providers'] === 'object') {
    Object.values(config['rule-providers']).forEach(rp => {
      if (rp && rp.proxy) {
        const clean = stripGroupDecoration(rp.proxy);
        if (emojiMap[clean]) {
          rp.proxy = emojiMap[clean];
        } else if (emojiMap[rp.proxy]) {
          rp.proxy = emojiMap[rp.proxy];
        }
      }
    });
  }
}

module.exports = {
  SKELETON_GROUPS,
  NON_CN_EXCLUDED_GROUPS,
  CN_CORE_PROXY_GROUPS,
  stripGroupDecoration,
  buildPresentationMaps,
  applyPresentation
};
