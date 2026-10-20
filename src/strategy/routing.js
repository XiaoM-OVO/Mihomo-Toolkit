/**
 * `routing` 表展开引擎（批次 3 两表模型: rules 侧）
 * -----------------------------------------------------------------------------
 * 职责：把**顺序化的 routing 条目**（preset / service / rule）展开成最终的
 * `rules` 与 Rule-Provider 清单。组声明（groups）不在本模块处理。
 *
 * 与旧实现的区别（`src/strategy/rules.js#buildRoutingRules`）：
 *   - 旧实现把顺序写死在代码段里（广告 → AI → … → MATCH）；
 *   - 本实现把顺序交给数据表 `DEFAULT_ROUTING`，条目可调序、可禁用、可覆写目标；
 *   - 两者对同一份默认配置必须产出**逐条相等**的规则（等价测试守护）。
 *
 * 目标（`to`）解析顺序（对应 ROADMAP 10.4）：
 *   1. 内置目标 (DIRECT / REJECT / REJECT-DROP / PASS) 原样大写；
 *   2. `ref` 键 → 目录中的组名（改名不断链）；
 *   3. 其他字符串按自定义组名透传（存在性由 groups 层校验）。
 */

'use strict';

const { FIELDS_BY_KEY } = require('../data');
const { PRESET_DEFINITIONS, DEFAULT_ROUTING } = require('../data/default-routing');
const { ADS_GROUPS, SPECIAL_SERVICES } = require('../config/catalog');
const { DEFAULT_MODE_MAP } = require('./topology-engine');
const { normalizeSubDomains, isIPv4, isIPv6 } = require('../infra/ip');
const {
  BASE_PROVIDER_ROUTES,
  BT_TRACKER_RULES,
  DOWNLOAD_RULESETS,
  createHttpRuleProvider,
  expandProcessRules,
  pushDownloadRules
} = require('./rules');

const BUILTIN_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'MUTE']);

function dedupe(list) {
  return [...new Set(list)];
}

/**
 * 解析 `to` 为目标名
 * @param {string} to 内置目标 / ref 键 / 自定义组名
 * @param {object} ctx 展开上下文
 * @returns {string}
 */
function resolveTo(to, ctx) {
  if (typeof to !== 'string' || !to.trim()) {
    throw new Error('routing: 条目缺少目标 `to`');
  }
  const value = to.trim();
  if (BUILTIN_TARGETS.has(value.toUpperCase())) return value.toUpperCase();
  const refName = ctx.registries.groups?.[value]?.name;
  if (refName) return refName;
  return value;
}

/**
 * 把一条规则的「目标字段」替换为指定目标（保留 `no-resolve`）
 * @param {string} rule 形如 `RULE-SET,x,目标` / `DOMAIN-SUFFIX,a.b,目标,no-resolve`
 * @param {string} target 新目标
 * @returns {string}
 */
function retarget(rule, target) {
  const parts = String(rule).split(',').map(p => p.trim());
  const noResolve = parts.length > 2 && parts[parts.length - 1].toLowerCase() === 'no-resolve';
  const head = noResolve ? parts.slice(0, -1) : parts;
  if (head.length === 2) return [head[0], head[1], target].join(',') + (noResolve ? ',no-resolve' : '');
  if (head.length >= 3) {
    const rebuilt = [...head.slice(0, 2), target];
    return rebuilt.join(',') + (noResolve ? ',no-resolve' : '');
  }
  return String(rule);
}

function createContext(userConfig, registries, options) {
  const config = userConfig || {};
  const os = String(config.osType || 'windows').toLowerCase();
  return {
    config,
    registries: registries || {},
    options: options || {},
    providerBase: { ...BASE_PROVIDER_ROUTES },
    rules: [],
    isReturn: Boolean(config.enableDomesticGroup && !config.proxyFirst),
    proxyTarget: options.proxyTarget
      || DEFAULT_MODE_MAP[config.defaultProxyMode]
      || '自动选择',
    osInfo: {
      isWin: os === 'windows' || os === 'all',
      isMac: os === 'mac' || os === 'all',
      isLin: os === 'linux' || os === 'all'
    }
  };
}

/**
 * 展开订阅直连段（局域网 + 订阅域名 + 可选 IPv6 / QUIC）
 * @param {object} ctx 上下文
 */
function expandSubscription(ctx) {
  const { config, rules } = ctx;
  rules.push('RULE-SET,lan-domain,DIRECT', 'RULE-SET,lan-ip,DIRECT,no-resolve');
  if (config.enableIPv6) {
    rules.push(
      'IP-CIDR6,::1/128,DIRECT,no-resolve',
      'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
      'IP-CIDR6,fe80::/10,DIRECT,no-resolve'
    );
  }
  for (const item of normalizeSubDomains(config.subDomain)) {
    if (isIPv4(item)) {
      rules.push(`IP-CIDR,${item}/32,DIRECT,no-resolve`);
    } else if (isIPv6(item)) {
      rules.push(`IP-CIDR6,${item}/128,DIRECT,no-resolve`);
    } else if (item.startsWith('+.') || item.startsWith('*.')) {
      rules.push(`DOMAIN-SUFFIX,${item.replace(/^(\+\.|\*\.)/, '')},DIRECT`);
    } else {
      rules.push(`DOMAIN,${item},DIRECT`);
    }
  }
  // QUIC 拦截：默认关闭；旧实现把它放在自定义组之后、广告之前，默认配置下与此处等价
  if (config.enableQUICReject) {
    if (ctx.isReturn) {
      rules.push('AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,cn)),REJECT-DROP');
      rules.push('AND,((NETWORK,UDP),(DST-PORT,443),(GEOIP,CN)),REJECT-DROP');
    } else {
      rules.push('AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,geolocation-!cn)),REJECT-DROP');
      rules.push('AND,((NETWORK,UDP),(DST-PORT,443),(GEOIP,!CN)),REJECT-DROP');
    }
  }
}

/**
 * 展开广告拦截段（`ADS_GROUPS` 逐条按开关）
 * @param {object} ctx 上下文
 * @param {string} [to] 统一目标覆写
 */
function expandAds(ctx, to) {
  const target = to === undefined ? null : resolveTo(to, ctx);
  for (const [refKey, ads] of Object.entries(ADS_GROUPS)) {
    if (!ctx.config[ads.configKey]) continue;
    const entry = (ctx.registries.groups || {})[refKey] || ads;
    for (const [name, path] of Object.entries(entry.providers || {})) {
      ctx.providerBase[name] = path;
    }
    const list = entry.rules || [];
    ctx.rules.push(...(target ? list.map(r => retarget(r, target)) : list));
  }
}

/**
 * 展开单个服务条目
 * @param {object} ctx 上下文
 * @param {string} key 服务键
 * @param {object} item 注册表条目
 * @param {string} [to] 目标覆写
 */
function expandService(ctx, key, item, to) {
  if (!item) return;
  const providerKey = item.ruleSet || key;
  if (item.provider) ctx.providerBase[providerKey] = item.provider;
  const target = to === undefined ? null : resolveTo(to, ctx);
  if (Array.isArray(item.rules) && item.rules.length > 0) {
    ctx.rules.push(...(target ? item.rules.map(r => retarget(r, target)) : item.rules));
    return;
  }
  ctx.rules.push(`RULE-SET,${providerKey},${target || item.name || key}`);
}

/**
 * 展开分类预设（AI / 流媒体 / 社交 / 游戏 / 系统）
 * @param {object} ctx 上下文
 * @param {object} preset 预设定义
 * @param {string} [to] 目标覆写
 */
function expandCategory(ctx, preset, to) {
  const registry = ctx.registries[preset.registry];
  if (!registry) return;
  if (preset.switchKey && ctx.config[preset.switchKey] === false) return;
  const base = Array.isArray(ctx.config[preset.listField])
    ? ctx.config[preset.listField]
    : Object.keys(registry);
  const customKeys = Object.keys(ctx.config.customServices?.[preset.registry] || {});
  const activeKeys = [...new Set([...base, ...customKeys])];
  for (const key of activeKeys) {
    const item = registry[key];
    if (!item) continue;
    // 游戏平台：steam 伴随规则集 steam-cn（下载域名的目标在条目 rules 里）
    if (preset.registry === 'game' && key === 'steam' && registry['steam-cn']) {
      ctx.providerBase['steam-cn'] = registry['steam-cn'].provider;
    }
    expandService(ctx, key, item, to);
  }
}

/**
 * 展开开发者 / 学术预设（逐服务开关）
 * @param {object} ctx 上下文
 * @param {object} preset 预设定义
 * @param {string} [to] 目标覆写
 */
function expandDev(ctx, preset, to) {
  const registry = ctx.registries[preset.registry];
  if (!registry) return;
  const base = Array.isArray(ctx.config[preset.listField])
    ? ctx.config[preset.listField]
    : Object.keys(registry);
  for (const key of base) {
    const switchKey = preset.switches?.[key];
    if (switchKey && ctx.config[switchKey] === false) continue;
    expandService(ctx, key, registry[key], to);
  }
}

/**
 * 展开专项服务（Crypto / PayPal / WebRTC / Telegram）
 * @param {object} ctx 上下文
 * @param {string} [to] 目标覆写
 */
function expandSpecialized(ctx, to) {
  const map = ctx.registries.specialized || SPECIAL_SERVICES;
  for (const spec of Object.values(map)) {
    if (!ctx.config[spec.configKey]) continue;
    if (spec.providers) Object.assign(ctx.providerBase, spec.providers);
    if (spec.process) {
      ctx.rules.push(...expandProcessRules(spec.process, spec.name, ctx.osInfo));
    }
    if (Array.isArray(spec.rules)) {
      const target = to === undefined ? null : resolveTo(to, ctx);
      ctx.rules.push(...(target ? spec.rules.map(r => retarget(r, target)) : spec.rules));
    }
  }
}

/**
 * 展开进程直连 / BT / 下载软件段
 * @param {object} ctx 上下文
 */
function expandProcess(ctx) {
  const {
    processDirectWin, processDirectMac, processDirectLin,
    processProxyWin, processProxyMac, processProxyLin,
    enableProcessDirect
  } = ctx.config;
  const processDirect = Boolean(enableProcessDirect);

  if (processDirect) {
    ctx.rules.push(...expandProcessRules({
      win: processDirectWin || FIELDS_BY_KEY.processDirectWin.default,
      mac: processDirectMac || FIELDS_BY_KEY.processDirectMac.default,
      lin: processDirectLin || FIELDS_BY_KEY.processDirectLin.default
    }, 'DIRECT', ctx.osInfo));
  }
  pushDownloadRules(ctx.rules, BT_TRACKER_RULES, processDirect);
  ctx.rules.push(...expandProcessRules({
    win: processProxyWin || FIELDS_BY_KEY.processProxyWin.default,
    mac: processProxyMac || FIELDS_BY_KEY.processProxyMac.default,
    lin: processProxyLin || FIELDS_BY_KEY.processProxyLin.default
  }, '下载策略', ctx.osInfo));
}

/**
 * 展开下载规则集段
 * @param {object} ctx 上下文
 */
function expandDownload(ctx) {
  pushDownloadRules(ctx.rules, DOWNLOAD_RULESETS, Boolean(ctx.config.enableProcessDirect));
}

/**
 * 展开国内 / 海外路由方向段
 * @param {object} ctx 上下文
 */
function expandDomestic(ctx) {
  const cnTarget = ctx.config.enableDomesticGroup ? '中国分流' : 'DIRECT';
  const nonCnTarget = ctx.isReturn ? 'DIRECT' : ctx.proxyTarget;
  if (ctx.config.proxyFirst) {
    ctx.rules.push(
      `RULE-SET,non-cn,${nonCnTarget}`,
      `RULE-SET,cn-domain,${cnTarget}`,
      `RULE-SET,cn-ip,${cnTarget},no-resolve`
    );
  } else {
    ctx.rules.push(
      `RULE-SET,cn-domain,${cnTarget}`,
      `RULE-SET,cn-ip,${cnTarget},no-resolve`,
      `RULE-SET,non-cn,${nonCnTarget}`
    );
  }
}

/**
 * 展开兜底段（IPv6 / 流量审计 / MATCH）
 * @param {object} ctx 上下文
 */
function expandFinal(ctx) {
  if (ctx.config.enableIPv6) ctx.rules.push('IP-CIDR6,::/0,IPv6控制台,no-resolve');
  if (ctx.config.enableTrafficAudit) {
    ctx.rules.push('DST-PORT,53/80/443,漏网之鱼', 'DST-PORT,1-65535,DIRECT');
  }
  ctx.rules.push('MATCH,漏网之鱼');
}

/**
 * 展开一条 `rule` 型条目
 * @param {object} ctx 上下文
 * @param {object} entry 条目 ({ rule, to })
 */
function expandRule(ctx, entry) {
  if (typeof entry.rule !== 'string' || !entry.rule.trim()) {
    throw new Error('routing: `rule` 条目缺少匹配表达式');
  }
  const base = entry.rule.trim();
  if (entry.to) {
    ctx.rules.push(retarget(base, resolveTo(entry.to, ctx)));
    return;
  }
  if (base.split(',').filter(Boolean).length < 3) {
    throw new Error(`routing: 规则缺少目标且未提供 \`to\`：${base}`);
  }
  ctx.rules.push(base);
}

/**
 * 展开单个 routing 条目
 * @param {object} ctx 上下文
 * @param {object} entry routing 条目
 */
function expandEntry(ctx, entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('routing: 条目必须是对象');
  }
  if (entry.disabled === true) return;
  if (entry.preset) {
    const preset = PRESET_DEFINITIONS[entry.preset];
    if (!preset) throw new Error(`routing: 未知预设 "${entry.preset}"`);
    expandPreset(ctx, preset, entry);
    return;
  }
  if (entry.service) {
    const key = entry.service;
    const found = findService(ctx.registries, key);
    if (!found) throw new Error(`routing: 未知服务 "${key}"`);
    expandService(ctx, key, found.item, entry.to);
    return;
  }
  if (entry.rule) {
    expandRule(ctx, entry);
    return;
  }
  throw new Error('routing: 条目需要 preset / service / rule 之一');
}

/**
 * 在分类注册表中查找服务
 * @param {object} registries 注册表集合
 * @param {string} key 服务键
 * @returns {{category: string, item: object}|null}
 */
function findService(registries, key) {
  for (const category of ['ai', 'streaming', 'social', 'game', 'dev', 'system']) {
    const item = registries[category]?.[key];
    if (item) return { category, item };
  }
  const spec = registries.specialized?.[key];
  if (spec) return { category: 'specialized', item: spec };
  return null;
}

/**
 * 按预设展开
 * @param {object} ctx 上下文
 * @param {object} preset 预设定义
 * @param {object} entry 条目（可带 `to`）
 */
function expandPreset(ctx, preset, entry) {
  const to = entry.to;
  switch (preset.kind) {
    case 'subscription': return expandSubscription(ctx);
    case 'ads': return expandAds(ctx, to);
    case 'category': return expandCategory(ctx, preset, to);
    case 'dev': return expandDev(ctx, preset, to);
    case 'specialized': return expandSpecialized(ctx, to);
    case 'process': return expandProcess(ctx);
    case 'download': return expandDownload(ctx);
    case 'domestic': return expandDomestic(ctx);
    case 'final': return expandFinal(ctx);
    default:
      throw new Error(`routing: 预设 "${preset.label || '?'}" 的 kind "${preset.kind}" 未被支持`);
  }
}

/**
 * 展开 routing 表，产出规则与 Rule-Provider
 * @param {object} userConfig 合并后的用户配置
 * @param {object} registries `ServiceCatalog#toRegistries()` 的结果
 * @param {object} [options={}]
 * @param {Array<object>} [options.routing] 顺序化条目（默认 `DEFAULT_ROUTING`）
 * @param {string} [options.proxyTarget] 代理目标（默认按 `defaultProxyMode` 推导）
 * @returns {{ rules: string[], providers: object }}
 */
function expandRouting(userConfig = {}, registries = {}, options = {}) {
  const ctx = createContext(userConfig, registries, options);
  const routing = Array.isArray(options.routing) ? options.routing : DEFAULT_ROUTING;

  const cdnBase = userConfig.ruleProviderCDN || FIELDS_BY_KEY.ruleProviderCDN.default;
  const repo = `${cdnBase}/MetaCubeX/meta-rules-dat@meta`;
  const ruleFormat = userConfig.useMRS ? 'mrs' : 'yaml';

  for (const entry of routing) expandEntry(ctx, entry);

  if (Array.isArray(userConfig.customRules) && userConfig.customRules.length) {
    ctx.rules.push(...userConfig.customRules);
  }

  const rules = dedupe(ctx.rules);
  const providers = Object.fromEntries(
    Object.entries(ctx.providerBase).map(([name, route]) => [
      name,
      createHttpRuleProvider(name, route, { repoBase: repo, ruleFormat })
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
  expandRouting,
  resolveTo,
  retarget,
  DEFAULT_ROUTING,
  PRESET_DEFINITIONS
};
