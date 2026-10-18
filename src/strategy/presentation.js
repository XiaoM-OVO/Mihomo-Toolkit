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

function stripGroupDecoration(rawName) {
  const stripped = String(rawName || '').replace(GROUP_DECORATION_PREFIX, '').trim();
  return stripped || String(rawName || '').trim();
}

const REGION_ICON_FILES = {
  cn: 'CN.png',
  hk: 'HK.png',
  mo: 'MO.png',
  tw: 'TW.png',
  jp: 'JP.png',
  kr: 'KR.png',
  sg: 'SG.png',
  us: 'US.png',
  '中国': 'CN.png',
  '大陆': 'CN.png',
  '香港': 'HK.png',
  '澳门': 'MO.png',
  '台湾': 'TW.png',
  '日本': 'JP.png',
  '韩国': 'KR.png',
  '新加坡': 'SG.png',
  '美国': 'US.png',
  '英国': 'UK.png',
  '德国': 'DE.png',
  '法国': 'FR.png',
  '俄罗斯': 'RU.png',
  '乌克兰': 'UA.png',
  '芬兰': 'FI.png',
  '印度': 'IN.png',
  '马来西亚': 'MY.png',
  '泰国': 'TH.png',
  '菲律宾': 'PH.png',
  '加拿大': 'CA.png',
  '阿根廷': 'AR.png',
  '巴西': 'BR.png',
  '土耳其': 'TR.png',
  '埃及': 'EG.png',
  '澳大利亚': 'AU.png',
  eu: 'EU.png',
  '欧洲': 'EU.png'
};

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
  '未知识别':       { emoji: '🗑️', icon: 'Cydia.png', repo: 'koolson' },
  '游戏服务':       { emoji: '🎮', icon: 'Game.png', repo: 'koolson' },
  '游戏下载':       { emoji: '🎮', icon: 'Game.png', repo: 'koolson' },
  'Telegram':       { emoji: '✈️', icon: 'Telegram.png', repo: 'koolson' },
  'GitHub':         { emoji: '🐱', icon: 'GitHub.png', repo: 'koolson' },
  '学术网站':       { emoji: '🎓', icon: 'Scholar.png', repo: 'koolson' },
  '加密货币':       { emoji: '🪙', icon: 'Cryptocurrency.png', repo: 'koolson' },
  'PayPal':         { emoji: '💳', icon: 'PayPal.png', repo: 'koolson' },
  'WebRTC':         { emoji: '🗣', icon: 'Direct.png', repo: 'koolson' },
  '社交平台':       { emoji: '💬', icon: 'Discord.png', repo: 'koolson' }
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
    if (r.name && r.icon) {
      const cleanName = `${r.name}节点`;
      const fullName = `${r.icon} ${cleanName}`;
      emojiMap[cleanName] = fullName;

      const iconFile = REGION_ICON_FILES[r.id] || REGION_ICON_FILES[r.name] || 'Global.png';
      const url = resolveIconUrl(iconFile, 'koolson', userConfig);
      iconMap[cleanName] = url;
      iconMap[fullName] = url;
    }
  });

  // 兜底补齐：中国节点与大陆节点双向等价
  const cnEmoji = '🇨🇳';
  const cnIconUrl = resolveIconUrl('CN.png', 'koolson', userConfig);
  emojiMap['大陆节点'] = `${cnEmoji} 大陆节点`;
  emojiMap['中国节点'] = `${cnEmoji} 中国节点`;
  iconMap['大陆节点'] = cnIconUrl;
  iconMap['中国节点'] = cnIconUrl;
  iconMap[`${cnEmoji} 大陆节点`] = cnIconUrl;
  iconMap[`${cnEmoji} 中国节点`] = cnIconUrl;

  CONTINENT_DEFS.forEach(c => {
    if (c.name && c.icon) {
      const cleanName = `${c.name}节点`;
      const fullName = `${c.icon} ${cleanName}`;
      emojiMap[cleanName] = fullName;

      const iconFile = (c.id === 'eu' || c.name === '欧洲') ? 'EU.png' : 'Global.png';
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

  // 3. 业务服务注册表 (AI, Streaming, Dev, System 等)
  const effectiveRegistries = (registries && Object.keys(registries).length > 0)
    ? registries
    : (userConfig.catalog ? userConfig.catalog.toRegistries() : {});

  for (const catServices of Object.values(effectiveRegistries)) {
    if (catServices && typeof catServices === 'object') {
      Object.values(catServices).forEach(item => {
        if (item && item.cleanName) {
          const cleanName = item.cleanName;
          const fullName = item.fullName || (item.uiIcon ? `${item.uiIcon} ${cleanName}` : cleanName);
          emojiMap[cleanName] = fullName;
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
          emojiMap[cleanName] = `${emoji} ${cleanName}`;
        } else {
          const iconUrl = iconConf.startsWith('http') ? iconConf : resolveIconUrl(iconConf, 'koolson', userConfig);
          iconMap[cleanName] = iconUrl;
          explicitIcons.add(cleanName);
          if (emojiMap[cleanName]) iconMap[emojiMap[cleanName]] = iconUrl;
        }
      } else if (typeof iconConf === 'object') {
        if (iconConf.emoji) {
          const emoji = String(iconConf.emoji).trim();
          emojiMap[cleanName] = `${emoji} ${cleanName}`;
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
            if (emojiMap[cleanName]) iconMap[emojiMap[cleanName]] = iconUrl;
          }
        }
      }
    }
  }

  // 5. 自定义策略组 DSL (customGroups) 图标与 Emoji 注册
  if (Array.isArray(userConfig.customGroups)) {
    for (const g of userConfig.customGroups) {
      if (!g || !g.name) continue;
      const cleanName = g.name;
      const emoji = g.emoji || '';
      const fullName = emoji ? `${emoji} ${cleanName}` : cleanName;
      if (emoji) {
        emojiMap[cleanName] = fullName;
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
    return;
  }

  // 模式 1: 纯图标模式 (icon) - 内部纯净中文即最终名字，零字符串替换，仅挂载 g.icon
  if (mode === 'icon') {
    (config['proxy-groups'] || []).forEach(g => {
      if (iconMap[g.name] && !g.icon) {
        g.icon = iconMap[g.name];
      }
    });
    return;
  }

  // 模式 2 & 3: emoji 或 both 模式 - 统一追加 Emoji 徽标，both 额外注入在线图标
  const needIcons = mode === 'both';

  // 1. 策略组更名与内部代理更名
  (config['proxy-groups'] || []).forEach(g => {
    const rawName = g.name;
    const clean = stripGroupDecoration(rawName);
    if (emojiMap[rawName]) {
      g.name = emojiMap[rawName];
    }
    const shouldMount = needIcons || (explicitIcons && explicitIcons.has(clean));
    if (shouldMount && (iconMap[g.name] || iconMap[rawName]) && !g.icon) {
      g.icon = iconMap[g.name] || iconMap[rawName];
    }
    if (Array.isArray(g.proxies)) {
      g.proxies = g.proxies.map(p => emojiMap[p] || p);
    }
  });

  // 2. 规则组按 TARGET 字段精准替换（杜绝误伤规则类型、参数或域名关键字）
  if (Array.isArray(config.rules)) {
    config.rules = config.rules.map(rule => replaceRuleTarget(rule, emojiMap));
  }

  // 3. Rule-Providers 的 proxy 引用更新
  if (config['rule-providers'] && typeof config['rule-providers'] === 'object') {
    Object.values(config['rule-providers']).forEach(rp => {
      if (rp && rp.proxy && emojiMap[rp.proxy]) {
        rp.proxy = emojiMap[rp.proxy];
      }
    });
  }
}

module.exports = {
  stripGroupDecoration,
  buildPresentationMaps,
  applyPresentation
};
