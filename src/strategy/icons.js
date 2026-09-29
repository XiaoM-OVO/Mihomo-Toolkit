/**
 * 策略组在线图标与显示模式装配器
 *
 * 根据 groupIconMode ("emoji" | "both" | "icon") 为策略组装配在线图标 (g.icon) 并处理纯净图标模式重命名。
 */

function applyGroupIcons(config, userConfig = {}, registries = {}) {
  const mode = userConfig.groupIconMode;
  if (!mode || mode === 'emoji') return;

  const effectiveRegistries = (registries && Object.keys(registries).length > 0)
    ? registries
    : (userConfig.catalog ? userConfig.catalog.toLegacyRegistries() : {});

  const iconOrz = userConfig.iconRepoOrz || 'https://fastly.jsdelivr.net/gh/Orz-3/mini@master/Color/';
  const iconKoolson = userConfig.iconRepoKoolson || 'https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/';
  const iconLige47 = userConfig.iconRepoLige47 || 'https://fastly.jsdelivr.net/gh/lige47/lige_icon@main/icon/';

  const iconMapping = {
    '📍 手动选择': { icon: `${iconOrz}Static.png`, newName: '手动选择' },
    '🚀 自动选择': { icon: `${iconOrz}Urltest.png`, newName: '自动选择' },
    '♻️ 故障转移': { icon: `${iconOrz}Available.png`, newName: '故障转移' },
    '⏬ 下载策略': { icon: `${iconOrz}Roundrobin.png`, newName: '下载策略' },
    '🏠 家宽优选': { icon: `${iconLige47}05icon/home.png`, newName: '家宽优选' },
    '🚀 高倍率优选': { icon: `${iconKoolson}Speedtest.png`, newName: '高倍率优选' },
    '📊 订阅与状态看板': { icon: `${iconKoolson}Airport.png`, newName: '订阅与状态看板' },
    '🧪 实验节点': { icon: `${iconKoolson}Lab.png`, newName: '实验节点' },
    '🇨🇳 中国分流': { icon: `${iconKoolson}China_Map.png`, newName: '中国分流' },
    '🪙 加密货币': { icon: `${iconKoolson}Cryptocurrency.png`, newName: '加密货币' },
    '💳 PayPal': { icon: `${iconKoolson}PayPal.png`, newName: 'PayPal' },
    '🎮 游戏服务': { icon: `${iconKoolson}Game.png`, newName: '游戏服务' },
    '🎮 游戏下载': { icon: `${iconKoolson}Game.png`, newName: '游戏下载' },
    '💬 社交平台': { icon: `${iconKoolson}Discord.png`, newName: '社交平台' },
    '✈️ Telegram': { icon: `${iconKoolson}Telegram.png`, newName: 'Telegram' },
    '🚫 广告拦截': { icon: `${iconKoolson}Reject.png`, newName: '广告拦截' },
    '🌐 IPv6控制台': { icon: `${iconKoolson}Direct.png`, newName: 'IPv6控制台' },
    '🐟 漏网之鱼': { icon: `${iconKoolson}Final.png`, newName: '漏网之鱼' },
    '🌐 其他节点': { icon: `${iconKoolson}Global.png`, newName: '其他节点' },
    '🗑️ 未知识别': { icon: `${iconKoolson}Cydia.png`, newName: '未知识别' }
  };

  // 动态合并 catalog/registries 策略组图标
  for (const catServices of Object.values(effectiveRegistries)) {
    if (catServices && typeof catServices === 'object') {
      Object.values(catServices).forEach(item => {
        if (item && item.name && item.iconUrl) {
          iconMapping[item.name] = { icon: item.iconUrl, newName: item.cleanName || item.name };
        }
      });
    }
  }

  const useIconOnly = mode === 'icon';
  const renameMap = {};

  (config['proxy-groups'] || []).forEach(g => {
    if (iconMapping[g.name]) {
      g.icon = iconMapping[g.name].icon;
      if (useIconOnly) {
        renameMap[g.name] = iconMapping[g.name].newName;
        g.name = iconMapping[g.name].newName;
      }
    }
  });

  if (useIconOnly && Object.keys(renameMap).length > 0) {
    if (config.rules) {
      config.rules = config.rules.map(r => r.split(',').map(p => renameMap[p] || p).join(','));
    }
    (config['proxy-groups'] || []).forEach(g => {
      if (g.proxies) g.proxies = g.proxies.map(p => renameMap[p] || p);
    });
    Object.values(config['rule-providers'] || {}).forEach(p => {
      if (p.proxy) p.proxy = renameMap[p.proxy] || p.proxy;
    });
  }
}

module.exports = {
  applyGroupIcons
};
