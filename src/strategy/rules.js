/**
 * 路由规则集与 Rule-Providers 组装器
 *
 * 根据开启的服务列表（AI、流媒体、社交、游戏、系统服务等）生成 Mihomo 路由规则与远端规则集配置。
 */

function dedupe(arr) {
  return [...new Set(arr)];
}

/**
 * 组装路由规则与规则集提供者
 * @param {object} userConfig
 * @param {object} registries
 * @param {object} [options={}]
 * @param {string} [options.proxyTarget]
 * @returns {object} { rules, providers }
 */
function buildRoutingRules(userConfig, registries, options = {}) {
  const modeMap = {
    auto: '自动选择',
    manual: '手动选择',
    fallback: '故障转移',
    direct: 'DIRECT',
    reject: 'REJECT'
  };
  const effectiveProxyTarget = options.proxyTarget || modeMap[userConfig.defaultProxyMode] || '自动选择';
  const effectiveRegistries = (registries && Object.keys(registries).length > 0)
    ? registries
    : (userConfig.catalog ? userConfig.catalog.toLegacyRegistries() : {});

  const repo = `${userConfig.ruleProviderCDN || 'https://fastly.jsdelivr.net/gh'}/MetaCubeX/meta-rules-dat@meta`;
  const ruleFormat = userConfig.useMRS ? 'mrs' : 'yaml';

  const os = (userConfig.osType || 'windows').toLowerCase();
  const isWin = os === 'windows' || os === 'all';
  const isMac = os === 'mac'     || os === 'all';
  const isLin = os === 'linux'   || os === 'all';

  const providerBase = {
    'lan-domain': 'geosite/private',
    'lan-ip': 'geoip/private',
    'non-cn': 'geosite/geolocation-!cn',
    'cn-domain': 'geosite/cn',
    'cn-ip': 'geoip/cn',
    'bt-trackers-pt': 'geosite/category-pt',
    'bt-trackers-public': 'geosite/category-public-tracker',
    'download-android': 'geosite/category-android-app-download',
    'download-games': 'geosite/category-game-platforms-download',
    'download-games-cn': 'geosite/category-game-platforms-download@cn'
  };

  const routingRules = ['RULE-SET,lan-domain,DIRECT', 'RULE-SET,lan-ip,DIRECT,no-resolve'];
  if (userConfig.enableIPv6) {
    routingRules.push('IP-CIDR6,::1/128,DIRECT,no-resolve', 'IP-CIDR6,fc00::/7,DIRECT,no-resolve', 'IP-CIDR6,fe80::/10,DIRECT,no-resolve');
  }

  // QUIC 分流拦截
  if (userConfig.enableQUICReject) {
    const isReturn = userConfig.enableDomesticGroup && !userConfig.proxyFirst;
    if (isReturn) {
      routingRules.push('AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,cn)),REJECT-DROP');
      routingRules.push('AND,((NETWORK,UDP),(DST-PORT,443),(GEOIP,CN)),REJECT-DROP');
    } else {
      routingRules.push('AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,geolocation-!cn)),REJECT-DROP');
      routingRules.push('AND,((NETWORK,UDP),(DST-PORT,443),(GEOIP,!CN)),REJECT-DROP');
    }
  }

  // 广告拦截
  if (userConfig.enableAdBlock) {
    providerBase['ads'] = 'geosite/category-ads-all';
    routingRules.push('RULE-SET,ads,广告拦截');
  }
  if (userConfig.enableAntiAD) {
    routingRules.push('RULE-SET,anti-ad,🚫 广告拦截');
  }

  // AI 助手服务
  const aiServices = userConfig.aiServices || ['chatgpt', 'gemini', 'claude', 'copilot'];
  if (userConfig.enableAI && aiServices.length && effectiveRegistries.ai) {
    aiServices.forEach(key => {
      const item = effectiveRegistries.ai[key];
      if (item) {
        providerBase[item.ruleSet] = item.provider;
        routingRules.push(`RULE-SET,${item.ruleSet},${item.name}`);
      }
    });
  }

  // 流媒体服务
  const streamingServices = userConfig.streamingServices || ['youtube', 'netflix', 'bilibili', 'disney', 'spotify', 'tiktok', 'bahamut', 'pixiv', 'twitch'];
  if (userConfig.enableStreaming && streamingServices.length && effectiveRegistries.streaming) {
    streamingServices.forEach(key => {
      const item = effectiveRegistries.streaming[key];
      if (item) {
        providerBase[key] = item.provider;
        routingRules.push(`RULE-SET,${key},${item.name}`);
      }
    });
  }

  // 社交平台
  const socialServices = userConfig.socialServices || ['twitter', 'facebook', 'instagram', 'discord'];
  const independentSocial = userConfig.independentSocial || ['twitter'];
  if (userConfig.enableSocial && socialServices.length && effectiveRegistries.social) {
    const nonIndependentKeys = socialServices.filter(k => !independentSocial.includes(k) && effectiveRegistries.social[k]);
    const useCombinedGroup = nonIndependentKeys.length > 1;

    socialServices.forEach(key => {
      const app = effectiveRegistries.social[key];
      if (!app) return;
      const targetGroup = independentSocial.includes(key) ? app.name : (useCombinedGroup ? '💬 社交平台' : app.name);
      providerBase[key] = app.provider;
      routingRules.push(`RULE-SET,${key},${targetGroup}`);
    });
  }

  // 游戏平台
  const gameServices = userConfig.gameServices || ['steam', 'epic', 'riot', 'blizzard', 'nintendo', 'playstation', 'xbox', 'ubisoft', 'origin', 'ea'];
  if (userConfig.enableGame && gameServices.length && effectiveRegistries.game) {
    gameServices.forEach(key => {
      const conf = effectiveRegistries.game[key];
      if (!conf) return;
      providerBase[key] = conf.provider;
      if (key === 'steam' && effectiveRegistries.game['steam-cn']) {
        providerBase['steam-cn'] = effectiveRegistries.game['steam-cn'].provider;
      }
      if (conf.rules) routingRules.push(...conf.rules);
    });
  }

  // 专项服务 (GitHub, 学术, 虚拟币, PayPal, WebRTC)
  if (userConfig.enableScholar) {
    providerBase['scholar'] = 'geosite/category-scholar-!cn';
    routingRules.push('DOMAIN-KEYWORD,sci-hub,🎓 学术网站', 'RULE-SET,scholar,🎓 学术网站');
  }
  if (userConfig.enableGitHub) {
    providerBase['github'] = 'geosite/github';
    routingRules.push('RULE-SET,github,🐱 GitHub');
  }
  if (userConfig.enableCrypto) {
    providerBase['crypto'] = 'geosite/category-cryptocurrency';
    routingRules.push('RULE-SET,crypto,🪙 加密货币');
  }
  if (userConfig.enablePayPal) {
    providerBase['paypal'] = 'geosite/paypal';
    routingRules.push('RULE-SET,paypal,💳 PayPal');
  }
  if (userConfig.enableWebRTC) {
    routingRules.push(
      'DOMAIN-KEYWORD,webrtc,🗣 WebRTC',
      'DOMAIN-KEYWORD,stun,🗣 WebRTC',
      'DOMAIN-KEYWORD,turn,🗣 WebRTC',
      'DST-PORT,3478,🗣 WebRTC',
      'DST-PORT,5349,🗣 WebRTC',
      'DST-PORT,5350,🗣 WebRTC',
      'DST-PORT,19302,🗣 WebRTC'
    );
  }

  // Telegram
  if (userConfig.enableTelegram) {
    if (isWin) routingRules.push('PROCESS-NAME,Telegram.exe,✈️ Telegram');
    if (isMac || isLin) routingRules.push('PROCESS-NAME,Telegram,✈️ Telegram');
    routingRules.push('RULE-SET,telegram,✈️ Telegram', 'RULE-SET,telegram-ip,✈️ Telegram,no-resolve');
    Object.assign(providerBase, { telegram: 'geosite/telegram', 'telegram-ip': 'geoip/telegram' });
  }

  // 系统服务
  const systemServices = userConfig.systemServices || ['microsoft', 'apple', 'google'];
  if (userConfig.enableSystemServices && systemServices.length && effectiveRegistries.system) {
    systemServices.forEach(key => {
      const conf = effectiveRegistries.system[key];
      if (conf) {
        providerBase[key] = conf.provider;
        if (conf.rules) routingRules.push(...conf.rules);
      }
    });
  }

  // 进程防漏与下载软件规则
  const procDirectWin = userConfig.processDirectWin || ['qBittorrent', 'Thunder', 'BitComet', 'uTorrent', 'aria2c'];
  const procDirectMac = userConfig.processDirectMac || ['Thunder', 'BitComet', 'uTorrent', 'qbittorrent', 'aria2c', 'transmission-daemon'];
  const procDirectLin = userConfig.processDirectLin || ['qbittorrent', 'aria2c', 'transmission-daemon'];

  if (userConfig.enableProcessDirect) {
    if (isWin) routingRules.push(...procDirectWin.map(p => `PROCESS-NAME,${p}.exe,DIRECT`));
    if (isMac) routingRules.push(...procDirectMac.map(p => `PROCESS-NAME,${p},DIRECT`));
    if (isLin) routingRules.push(...procDirectLin.map(p => `PROCESS-NAME,${p},DIRECT`));
    routingRules.push('RULE-SET,bt-trackers-pt,DIRECT', 'RULE-SET,bt-trackers-public,DIRECT', 'DOMAIN-KEYWORD,tracker,DIRECT', 'DOMAIN-KEYWORD,announce,DIRECT');
  } else {
    routingRules.push('RULE-SET,bt-trackers-pt,下载策略', 'RULE-SET,bt-trackers-public,下载策略');
  }

  const procProxyWin = userConfig.processProxyWin || ['IDMan', 'fdm'];
  const procProxyMac = userConfig.processProxyMac || ['fdm'];
  const procProxyLin = userConfig.processProxyLin || [];
  if (isWin) routingRules.push(...procProxyWin.map(p => `PROCESS-NAME,${p}.exe,下载策略`));
  if (isMac) routingRules.push(...procProxyMac.map(p => `PROCESS-NAME,${p},下载策略`));
  if (isLin) routingRules.push(...procProxyLin.map(p => `PROCESS-NAME,${p},下载策略`));
  routingRules.push('RULE-SET,download-games-cn,DIRECT', 'RULE-SET,download-games,下载策略', 'RULE-SET,download-android,下载策略');

  // 国内 / 海外路由方向判定
  const isReturn = userConfig.enableDomesticGroup && !userConfig.proxyFirst;
  const cnTarget = userConfig.enableDomesticGroup ? '中国分流' : 'DIRECT';
  const nonCnTarget = isReturn ? 'DIRECT' : effectiveProxyTarget;

  if (userConfig.proxyFirst) {
    routingRules.push(`RULE-SET,non-cn,${nonCnTarget}`, `RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`);
  } else {
    routingRules.push(`RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`, `RULE-SET,non-cn,${nonCnTarget}`);
  }

  if (userConfig.enableIPv6) routingRules.push('IP-CIDR6,::/0,IPv6控制台,no-resolve');
  if (userConfig.enableTrafficAudit) {
    routingRules.push('DST-PORT,53/80/443,漏网之鱼', 'DST-PORT,1-65535,DIRECT');
  }
  if (Array.isArray(userConfig.customRules) && userConfig.customRules.length) {
    routingRules.push(...userConfig.customRules);
  }
  routingRules.push('MATCH,漏网之鱼');

  const rules = dedupe(routingRules);

  const providers = Object.fromEntries(
    Object.entries(providerBase).map(([name, route]) => {
      const isExternal = /^https?:\/\//.test(route);
      const url = isExternal ? route : `${repo}/geo/${route}.${ruleFormat}`;
      const fmt = isExternal ? (/\.mrs$/i.test(route) ? 'mrs' : 'yaml') : ruleFormat;
      const behavior = isExternal ? 'domain' : (route.includes('geoip') ? 'ipcidr' : 'domain');
      return [
        name,
        {
          type: 'http',
          behavior,
          url,
          path: `./ruleset/${name}.${fmt}`,
          interval: 86400,
          format: fmt,
          proxy: 'DIRECT'
        }
      ];
    })
  );

  if (userConfig.enableAntiAD) {
    providers['anti-ad'] = {
      type: 'http',
      behavior: 'domain',
      url: 'https://anti-ad.net/clash.yaml',
      path: './ruleset/anti-ad.yaml',
      interval: 86400,
      format: 'yaml',
      proxy: 'DIRECT'
    };
  }

  if (userConfig.customRuleProviders && typeof userConfig.customRuleProviders === 'object') {
    Object.entries(userConfig.customRuleProviders).forEach(([name, conf]) => {
      const fmt = conf.format || 'yaml';
      providers[name] = {
        type: 'http',
        proxy: 'DIRECT',
        interval: 86400,
        path: `./ruleset/${name}.${fmt}`,
        ...conf
      };
    });
  }

  return { rules, providers };
}

module.exports = {
  buildRoutingRules
};
