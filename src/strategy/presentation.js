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

function resolveIconUrl(iconFile, repo, userConfig = {}) {
  const iconOrz = userConfig.iconRepoOrz || 'https://fastly.jsdelivr.net/gh/Orz-3/mini@master/Color/';
  const iconKoolson = userConfig.iconRepoKoolson || 'https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/';
  const iconLige47 = userConfig.iconRepoLige47 || 'https://fastly.jsdelivr.net/gh/lige47/lige_icon@main/icon/';
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
    }
  });

  CONTINENT_DEFS.forEach(c => {
    if (c.name && c.icon) {
      const cleanName = `${c.name}节点`;
      const fullName = `${c.icon} ${cleanName}`;
      emojiMap[cleanName] = fullName;
    }
  });

  // 3. 业务服务注册表 (AI, Streaming, Dev, System 等)
  const effectiveRegistries = (registries && Object.keys(registries).length > 0)
    ? registries
    : (userConfig.catalog ? userConfig.catalog.toLegacyRegistries() : {});

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

  return { emojiMap, iconMap };
}

/**
 * 在流水线终末执行展示层装配
 * @param {object} config 待交付的 Mihomo 配置对象
 * @param {object} [userConfig={}] 用户全局配置
 * @param {object} [registries={}] 服务注册表
 */
function applyPresentation(config, userConfig = {}, registries = {}) {
  const mode = userConfig.groupIconMode || 'emoji';
  const { emojiMap, iconMap } = buildPresentationMaps(userConfig, registries);

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
    if (emojiMap[g.name]) {
      g.name = emojiMap[g.name];
    }
    if (needIcons && iconMap[g.name] && !g.icon) {
      g.icon = iconMap[g.name];
    }
    if (Array.isArray(g.proxies)) {
      g.proxies = g.proxies.map(p => emojiMap[p] || p);
    }
  });

  // 2. 规则组按逗号精准分词替换
  if (Array.isArray(config.rules)) {
    config.rules = config.rules.map(rule => {
      if (typeof rule !== 'string') return rule;
      return rule.split(',').map(token => {
        const trimmed = token.trim();
        return emojiMap[trimmed] || token;
      }).join(',');
    });
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
  SKELETON_GROUPS,
  buildPresentationMaps,
  applyPresentation
};
