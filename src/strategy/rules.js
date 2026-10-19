/**
 * 路由规则集与 Rule-Providers 组装器
 *
 * 根据开启的服务列表（AI、流媒体、社交、游戏、系统服务等）生成 Mihomo 路由规则与远端规则集配置。
 */

const { FIELDS_BY_KEY } = require('../data');
const { isIPv4, isIPv6, normalizeSubDomains } = require('../infra/ip');
const { buildServiceCatalog, SPECIAL_SERVICES } = require('../config/catalog');
const { DEFAULT_MODE_MAP } = require('./topology-engine');

function dedupe(arr) {
  return [...new Set(arr)];
}

/**
 * 基础网络与常用下载规则集路由定义基线
 */
const BASE_PROVIDER_ROUTES = Object.freeze({
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
});

/**
 * 根据规则集标识与路由定义生成标准 HTTP Rule-Provider 对象
 * @param {string} name 规则集标识
 * @param {string} route 相对路径 (如 geosite/cn) 或绝对 URL (如 https://...)
 * @param {object} [options={}]
 * @param {string} [options.repoBase=''] 远端 CDN 仓库基准地址
 * @param {string} [options.ruleFormat='yaml'] 规则集格式 ('mrs' | 'yaml')
 * @param {string} [options.proxy='DIRECT'] 规则集拉取代理策略
 * @param {number} [options.interval=86400] 规则集自动更新间隔 (秒)
 * @returns {object} Rule-Provider 对象
 */
function createHttpRuleProvider(name, route, options = {}) {
  const {
    repoBase = '',
    ruleFormat = 'yaml',
    proxy = 'DIRECT',
    interval = 86400
  } = options;

  const isExternal = /^https?:\/\//.test(route);
  const url = isExternal ? route : `${repoBase}/geo/${route}.${ruleFormat}`;
  const fmt = isExternal ? (/\.mrs$/i.test(route) ? 'mrs' : 'yaml') : ruleFormat;
  const behavior = isExternal ? 'domain' : (route.includes('geoip') ? 'ipcidr' : 'domain');

  return {
    type: 'http',
    behavior,
    url,
    path: `./ruleset/${name}.${fmt}`,
    interval,
    format: fmt,
    proxy
  };
}

/**
 * 声明式装配指定注册表分类的服务规则与 Rule-Providers
 * @param {object} params
 * @param {object} params.registry 该分类的服务注册表
 * @param {Array<string>} params.activeKeys 激活的服务键名列表
 * @param {Record<string, string>} params.providerBase 收集 Rule-Provider 路由映射的字典
 * @param {Array<string>} params.routingRules 收集路由规则列表
 * @param {function} [params.resolveTarget] 自定义目标策略组名称解析器
 * @param {function} [params.onService] 遍历单个服务时的挂钩回调（用于注入伴生规则集等）
 */
function assembleServiceCategory({ registry, activeKeys, providerBase, routingRules, resolveTarget, onService }) {
  if (!registry || !Array.isArray(activeKeys)) return;
  activeKeys.forEach(key => {
    const item = registry[key];
    if (!item) return;

    const providerKey = item.ruleSet || key;
    if (item.provider) {
      providerBase[providerKey] = item.provider;
    }

    if (typeof onService === 'function') {
      onService(key, item);
    }

    if (typeof resolveTarget === 'function') {
      const target = resolveTarget(key, item);
      routingRules.push(`RULE-SET,${providerKey},${target}`);
    } else if (Array.isArray(item.rules) && item.rules.length > 0) {
      routingRules.push(...item.rules);
    } else {
      routingRules.push(`RULE-SET,${providerKey},${item.name || key}`);
    }
  });
}

/**
 * 展开基于 OS 类型的进程规则
 * @param {object} processLists
 * @param {string[]} processLists.win
 * @param {string[]} processLists.mac
 * @param {string[]} processLists.lin
 * @param {string} target 路由目标
 * @param {object} osInfo
 * @returns {string[]}
 */
function expandProcessRules(processLists, target, osInfo) {
  const { isWin, isMac, isLin } = osInfo;
  const rules = [];
  if (isWin && Array.isArray(processLists.win)) {
    rules.push(...processLists.win.map(p => {
      const exeName = p.toLowerCase().endsWith('.exe') ? p : `${p}.exe`;
      return `PROCESS-NAME,${exeName},${target}`;
    }));
  }
  if (isMac && Array.isArray(processLists.mac)) {
    rules.push(...processLists.mac.map(p => `PROCESS-NAME,${p},${target}`));
  }
  if (isLin && Array.isArray(processLists.lin)) {
    rules.push(...processLists.lin.map(p => `PROCESS-NAME,${p},${target}`));
  }
  return rules;
}

/**
 * 组装路由规则与规则集提供者
 * @param {object} [userConfig={}]
 * @param {object} [registries={}]
 * @param {object} [options={}]
 * @param {string} [options.proxyTarget]
 * @returns {object} { rules, providers }
 */
function buildRoutingRules(userConfig = {}, registries = {}, options = {}) {
  const effectiveProxyTarget = options.proxyTarget || DEFAULT_MODE_MAP[userConfig.defaultProxyMode] || '自动选择';

  let effectiveRegistries = (registries && Object.keys(registries).length > 0) ? registries : null;
  if (!effectiveRegistries && userConfig.catalog && typeof userConfig.catalog.toRegistries === 'function') {
    effectiveRegistries = userConfig.catalog.toRegistries();
  }
  if (!effectiveRegistries && userConfig.registries && Object.keys(userConfig.registries).length > 0) {
    effectiveRegistries = userConfig.registries;
  }
  if (!effectiveRegistries) {
    try {
      effectiveRegistries = buildServiceCatalog(userConfig).toRegistries();
    } catch {
      effectiveRegistries = {};
    }
  }

  const cdnBase = userConfig.ruleProviderCDN || FIELDS_BY_KEY.ruleProviderCDN.default;
  const repo = `${cdnBase}/MetaCubeX/meta-rules-dat@meta`;
  const ruleFormat = userConfig.useMRS ? 'mrs' : 'yaml';

  const os = (userConfig.osType || 'windows').toLowerCase();
  const osInfo = {
    isWin: os === 'windows' || os === 'all',
    isMac: os === 'mac'     || os === 'all',
    isLin: os === 'linux'   || os === 'all'
  };

  const providerBase = { ...BASE_PROVIDER_ROUTES };

  const routingRules = ['RULE-SET,lan-domain,DIRECT', 'RULE-SET,lan-ip,DIRECT,no-resolve'];
  if (userConfig.enableIPv6) {
    routingRules.push('IP-CIDR6,::1/128,DIRECT,no-resolve', 'IP-CIDR6,fc00::/7,DIRECT,no-resolve', 'IP-CIDR6,fe80::/10,DIRECT,no-resolve');
  }

  // 1. 订阅服务与面板节点直连注入（防止客户端刷新订阅走代理产生延迟叠加或死锁）
  const subDomains = normalizeSubDomains(userConfig.subDomain);
  for (const item of subDomains) {
    if (isIPv4(item)) {
      routingRules.push(`IP-CIDR,${item}/32,DIRECT,no-resolve`);
    } else if (isIPv6(item)) {
      routingRules.push(`IP-CIDR6,${item}/128,DIRECT,no-resolve`);
    } else if (item.startsWith('+.') || item.startsWith('*.')) {
      routingRules.push(`DOMAIN-SUFFIX,${item.replace(/^(\+\.|\*\.)/, '')},DIRECT`);
    } else {
      routingRules.push(`DOMAIN,${item},DIRECT`);
    }
  }

  // 2. 用户自定义私域分流规则（最高业务优先级，确保私域策略不被通用分流拦截）
  if (Array.isArray(userConfig.customRules) && userConfig.customRules.length) {
    routingRules.push(...userConfig.customRules);
  }

  // 3. 用户声明式策略组 (customGroups) 绑定规则注入
  if (Array.isArray(userConfig.customGroups) && userConfig.customGroups.length) {
    for (const g of userConfig.customGroups) {
      if (!g || !g.name || !g.rules) continue;
      const targetName = g.name;
      const rulesList = Array.isArray(g.rules) ? g.rules : [g.rules];
      for (const r of rulesList) {
        if (!r || typeof r !== 'string') continue;
        const trimmed = r.trim();
        if (trimmed.includes(',')) {
          const parts = trimmed.split(',');
          if (parts.length === 2) {
            routingRules.push(`${parts[0].trim()},${parts[1].trim()},${targetName}`);
          } else {
            routingRules.push(trimmed);
          }
        } else {
          const ruleSetName = trimmed.replace(/^(geosite|geoip):/i, '');
          const providerPath = trimmed.includes(':') ? trimmed.replace(':', '/') : `geosite/${trimmed}`;
          providerBase[ruleSetName] = providerPath;
          routingRules.push(`RULE-SET,${ruleSetName},${targetName}`);
        }
      }
    }
  }

  // 4. QUIC 分流拦截
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

  // 5. 广告拦截
  if (userConfig.enableAdBlock) {
    providerBase['ads'] = 'geosite/category-ads-all';
    routingRules.push('RULE-SET,ads,广告拦截');
  }
  if (userConfig.enableAntiAD) {
    providerBase['anti-ad'] = 'https://anti-ad.net/clash.yaml';
    routingRules.push('RULE-SET,anti-ad,广告拦截');
  }

  // 6. AI 助手服务
  if (userConfig.enableAI && effectiveRegistries.ai) {
    const customAiKeys = Object.keys(userConfig.customServices?.ai || {});
    const baseActive = userConfig.aiServices || Object.keys(effectiveRegistries.ai);
    const activeKeys = [...new Set([...baseActive, ...customAiKeys])];
    assembleServiceCategory({
      registry: effectiveRegistries.ai,
      activeKeys,
      providerBase,
      routingRules
    });
  }

  // 7. 流媒体服务
  if (userConfig.enableStreaming && effectiveRegistries.streaming) {
    const customStreamingKeys = Object.keys(userConfig.customServices?.streaming || {});
    const baseActive = userConfig.streamingServices || Object.keys(effectiveRegistries.streaming);
    const activeKeys = [...new Set([...baseActive, ...customStreamingKeys])];
    assembleServiceCategory({
      registry: effectiveRegistries.streaming,
      activeKeys,
      providerBase,
      routingRules
    });
  }

  // 8. 社交平台
  if (userConfig.enableSocial && effectiveRegistries.social) {
    const customSocialKeys = Object.keys(userConfig.customServices?.social || {});
    const baseActive = userConfig.socialServices || Object.keys(effectiveRegistries.social);
    const socialServices = [...new Set([...baseActive, ...customSocialKeys])];
    const independentSocial = userConfig.independentSocial || ['twitter'];
    const nonIndependentKeys = socialServices.filter(k => !independentSocial.includes(k) && effectiveRegistries.social[k]);
    const useCombinedGroup = nonIndependentKeys.length > 1;

    assembleServiceCategory({
      registry: effectiveRegistries.social,
      activeKeys: socialServices,
      providerBase,
      routingRules,
      resolveTarget: (key, item) => {
        return independentSocial.includes(key) ? item.name : (useCombinedGroup ? '社交平台' : item.name);
      }
    });
  }

  // 9. 游戏平台 (按需激活: gameServices 声明列表 + customServices.game 扩展)
  if (userConfig.enableGame && effectiveRegistries.game) {
    const customGameKeys = Object.keys(userConfig.customServices?.game || {});
    const baseActive = userConfig.gameServices || Object.keys(effectiveRegistries.game);
    const activeKeys = [...new Set([...baseActive, ...customGameKeys])];
    assembleServiceCategory({
      registry: effectiveRegistries.game,
      activeKeys,
      providerBase,
      routingRules,
      onService: (key) => {
        if (key === 'steam' && effectiveRegistries.game['steam-cn']) {
          providerBase['steam-cn'] = effectiveRegistries.game['steam-cn'].provider;
        }
      }
    });
  }

  // 10. 开发者与学术服务 (按 devActive 驱动，消除硬编码分支)
  if (effectiveRegistries.dev) {
    const devActive = Array.isArray(userConfig.devServices)
      ? userConfig.devServices
      : Object.keys(effectiveRegistries.dev);
    const activeKeys = devActive.filter(k => {
      if (k === 'github' && userConfig.enableGitHub === false) return false;
      if (k === 'scholar' && userConfig.enableScholar === false) return false;
      return true;
    });
    assembleServiceCategory({
      registry: effectiveRegistries.dev,
      activeKeys,
      providerBase,
      routingRules
    });
  }

  // 11. 专项独立服务 (Crypto, PayPal, WebRTC, Telegram)
  const specializedMap = effectiveRegistries.specialized || SPECIAL_SERVICES;
  for (const spec of Object.values(specializedMap)) {
    if (userConfig[spec.configKey]) {
      if (spec.providers) {
        Object.assign(providerBase, spec.providers);
      }
      if (spec.process) {
        routingRules.push(...expandProcessRules(spec.process, spec.name, osInfo));
      }
      if (Array.isArray(spec.rules)) {
        routingRules.push(...spec.rules);
      }
    }
  }

  // 12. 系统服务
  if (userConfig.enableSystemServices && effectiveRegistries.system) {
    const customSystemKeys = Object.keys(userConfig.customServices?.system || {});
    const baseActive = userConfig.systemServices || Object.keys(effectiveRegistries.system);
    const activeKeys = [...new Set([...baseActive, ...customSystemKeys])];
    assembleServiceCategory({
      registry: effectiveRegistries.system,
      activeKeys,
      providerBase,
      routingRules
    });
  }

  // 13. 进程防漏与下载软件规则
  const procDirectLists = {
    win: userConfig.processDirectWin || FIELDS_BY_KEY.processDirectWin.default,
    mac: userConfig.processDirectMac || FIELDS_BY_KEY.processDirectMac.default,
    lin: userConfig.processDirectLin || FIELDS_BY_KEY.processDirectLin.default
  };

  if (userConfig.enableProcessDirect) {
    routingRules.push(...expandProcessRules(procDirectLists, 'DIRECT', osInfo));
    routingRules.push('RULE-SET,bt-trackers-pt,DIRECT', 'RULE-SET,bt-trackers-public,DIRECT', 'DOMAIN-KEYWORD,tracker,DIRECT', 'DOMAIN-KEYWORD,announce,DIRECT');
  } else {
    routingRules.push('RULE-SET,bt-trackers-pt,下载策略', 'RULE-SET,bt-trackers-public,下载策略');
  }

  const procProxyLists = {
    win: userConfig.processProxyWin || FIELDS_BY_KEY.processProxyWin.default,
    mac: userConfig.processProxyMac || FIELDS_BY_KEY.processProxyMac.default,
    lin: userConfig.processProxyLin || FIELDS_BY_KEY.processProxyLin.default
  };
  routingRules.push(...expandProcessRules(procProxyLists, '下载策略', osInfo));
  routingRules.push('RULE-SET,download-games-cn,DIRECT', 'RULE-SET,download-games,下载策略', 'RULE-SET,download-android,下载策略');

  // 14. 国内 / 海外路由方向判定
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
  routingRules.push('MATCH,漏网之鱼');

  const rules = dedupe(routingRules);

  const providers = Object.fromEntries(
    Object.entries(providerBase).map(([name, route]) => [
      name,
      createHttpRuleProvider(name, route, {
        repoBase: repo,
        ruleFormat
      })
    ])
  );

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
  BASE_PROVIDER_ROUTES,
  SPECIAL_SERVICES,
  createHttpRuleProvider,
  assembleServiceCategory,
  buildRoutingRules
};
