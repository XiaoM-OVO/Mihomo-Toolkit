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
const { GROUP_KEYS, groupName } = require('../data/catalog/identity');
const { PRESET_DEFINITIONS, DEFAULT_ROUTING } = require('../data/default-routing');
const { ADS_GROUPS, SPECIAL_SERVICES, buildServiceCatalog } = require('../config/catalog');
const { DEFAULT_MODE_MAP } = require('./topology-engine');
const { createTargetRegistry, BUILTIN_TARGETS } = require('./target-registry');
const { normalizeSubDomains, isIPv4, isIPv6 } = require('../infra/ip');
const {
  BASE_PROVIDER_ROUTES,
  BT_TRACKER_RULES,
  DOWNLOAD_RULESETS,
  createHttpRuleProvider,
  expandProcessRules,
  pushDownloadRules
} = require('./rules');

function dedupe(list) {
  return [...new Set(list)];
}

/** routing 条目的合法字段（Fail-Closed：未知字段一律报错，杜绝拼错字段被静默忽略） */
const ROUTING_ENTRY_KEYS = new Set(['preset', 'service', 'rule', 'to', 'disabled', 'direction']);

/**
 * 取一条规则的目标字段（`AND,((…)),目标` 单独处理）
 * @param {string} rule 原始规则文本
 * @returns {string|null}
 */
function ruleTargetOf(rule) {
  const text = String(rule).trim();
  if (text.startsWith('AND,')) {
    const matched = text.match(/^AND,\(\(.*\)\),([^,]+)$/);
    return matched ? matched[1].trim() : null;
  }
  const parts = text.split(',').map(p => p.trim());
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  if (last.toLowerCase() === 'no-resolve') {
    return parts.length >= 3 ? parts[parts.length - 2] : null;
  }
  return last;
}

/**
 * 收集规则引用到的目标组（按首次出现顺序去重）
 * @param {string[]} rules 展开后的规则
 * @returns {string[]} 非内置目标名
 */
function collectTargets(rules) {
  const targets = [];
  for (const rule of rules) {
    const target = ruleTargetOf(rule);
    if (target && !BUILTIN_TARGETS.includes(target.toUpperCase())) targets.push(target);
  }
  return dedupe(targets);
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
  return ctx.targets.resolve(to.trim());
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

  // 与旧实现同源的回退口径：未显式传入 registries 时，从 catalog / 配置投影现场构建
  let effective = (registries && Object.keys(registries).length > 0) ? registries : null;
  if (!effective && config.catalog && typeof config.catalog.toRegistries === 'function') {
    effective = config.catalog.toRegistries();
  }
  if (!effective && config.registries && Object.keys(config.registries).length > 0) {
    effective = config.registries;
  }
  if (!effective) {
    try {
      effective = buildServiceCatalog(config).toRegistries();
    } catch {
      effective = {};
    }
  }

  // 方向：默认按 `trafficDirection` 推导；校验层会按条目自身 direction 显式指定
  const direction = options.direction === 'return' || options.direction === 'split'
    ? options.direction
    : (userConfig && userConfig.trafficDirection === 'return' ? 'return' : 'split');
  const disabledRefs = Array.isArray(options.disabledRefs)
    ? options.disabledRefs
    : (Array.isArray(config.disabledGroupRefs) ? config.disabledGroupRefs : []);
  return {
    config,
    registries: effective,
    options: options || {},
    // 组关闭状态由配置归一化阶段显式产出，不读目录对象上的隐式标记
    disabledRefs: new Set(disabledRefs),
    // 目标合法性唯一真相源：解析、校验与剪枝共用同一张注册表
    targets: createTargetRegistry({ config, registries: effective, direction, disabledRefs }),
    providerBase: { ...BASE_PROVIDER_ROUTES },
    rules: [],
    direction,
    isReturn: direction === 'return',
    proxyTarget: options.proxyTarget
      || DEFAULT_MODE_MAP[config.defaultProxyMode]
      || groupName(GROUP_KEYS.auto),
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
  // QUIC 拦截由独立的 `quic` 预设展开（顺序见 `DEFAULT_ROUTING`），
  // 这样 `customRules` 仍排在它前面，与旧实现的优先级一致。
}

/**
 * 展开 QUIC 拦截段（表里有这一条即启用，默认表不含）
 * @param {object} ctx 上下文
 * @param {string} [to] 统一目标覆写（默认 REJECT-DROP）
 */
function expandQuic(ctx, to) {
  const target = to === undefined ? 'REJECT-DROP' : resolveTo(to, ctx);
  const cnSuffix = ctx.isReturn
    ? ['(GEOSITE,cn)', '(GEOIP,CN)']
    : ['(GEOSITE,geolocation-!cn)', '(GEOIP,!CN)'];
  for (const suffix of cnSuffix) {
    ctx.rules.push(`AND,((NETWORK,UDP),(DST-PORT,443),${suffix}),${target}`);
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
    // 规则来源只认 ADS_GROUPS；组名允许用户通过 groups 声明覆写
    const declaredName = ctx.registries.groups?.[refKey]?.name;
    for (const [name, path] of Object.entries(ads.providers || {})) {
      ctx.providerBase[name] = path;
    }
    const effectiveTarget = target || declaredName || ads.name;
    ctx.rules.push(...ads.rules.map(r => retarget(r, effectiveTarget)));
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
  // 游戏平台：steam 的下载域名规则依赖伴随规则集 steam-cn（逐条点名与整段展开都要注册）
  const companion = key === 'steam' ? ctx.registries.game?.['steam-cn'] : null;
  if (companion && companion.provider) ctx.providerBase['steam-cn'] = companion.provider;
  for (const [name, path] of Object.entries(item.providers || {})) {
    ctx.providerBase[name] = path;
  }
  if (item.provider) ctx.providerBase[providerKey] = item.provider;
  const target = to === undefined ? null : resolveTo(to, ctx);
  const effectiveTarget = target || item.name || key;
  if (item.process && typeof item.process === 'object') {
    ctx.rules.push(...expandProcessRules(item.process, effectiveTarget, ctx.osInfo));
  }
  if (Array.isArray(item.rules) && item.rules.length > 0) {
    ctx.rules.push(...(target ? item.rules.map(r => retarget(r, target)) : item.rules));
    return;
  }
  ctx.rules.push(`RULE-SET,${providerKey},${effectiveTarget}`);
}

/**
 * 展开分类预设（AI / 流媒体 / 社交 / 游戏 / 系统）
 *
 * 预设 = 「该分类下全部服务 + 用户自定义服务」，不再受开关或服务清单字段影响：
 * 表里写这一条就是全都要，只要一部分就改用逐条 `{ service }`。
 * @param {object} ctx 上下文
 * @param {object} preset 预设定义
 * @param {string} [to] 目标覆写
 */
function expandCategory(ctx, preset, to) {
  const registry = ctx.registries[preset.registry];
  if (!registry) return;
  const customKeys = Object.keys(ctx.config.customServices?.[preset.registry] || {});
  const activeKeys = [...new Set([...Object.keys(registry), ...customKeys])];
  for (const key of activeKeys) {
    const item = registry[key];
    if (!item || item.providerOnly) continue;
    expandService(ctx, key, item, to);
  }
}

/**
 * 展开开发者 / 学术预设（分类下全部服务 + 自定义服务）
 * @param {object} ctx 上下文
 * @param {object} preset 预设定义
 * @param {string} [to] 目标覆写
 */
function expandDev(ctx, preset, to) {
  const registry = ctx.registries[preset.registry];
  if (!registry) return;
  const customKeys = Object.keys(ctx.config.customServices?.[preset.registry] || {});
  const keys = [...new Set([...Object.keys(registry), ...customKeys])];
  for (const key of keys) {
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
  const target = to === undefined ? null : resolveTo(to, ctx);
  for (const spec of Object.values(map)) {
    const effectiveTarget = target || spec.name;
    if (spec.providers) Object.assign(ctx.providerBase, spec.providers);
    if (spec.process) {
      ctx.rules.push(...expandProcessRules(spec.process, effectiveTarget, ctx.osInfo));
    }
    if (Array.isArray(spec.rules)) {
      ctx.rules.push(...spec.rules.map(r => retarget(r, effectiveTarget)));
    }
  }
}

/**
 * 展开进程直连段
 *
 * 只保留「强制直连进程」（BT 客户端、迅雷等）；BT 追踪器与下载软件进程
 * 属于「BT 段」，可整段改道，见 `expandBt`。
 * @param {object} ctx 上下文
 */
function expandProcess(ctx) {
  const {
    processDirectWin, processDirectMac, processDirectLin
  } = ctx.config;

  ctx.rules.push(...expandProcessRules({
    win: processDirectWin || FIELDS_BY_KEY.processDirectWin.default,
    mac: processDirectMac || FIELDS_BY_KEY.processDirectMac.default,
    lin: processDirectLin || FIELDS_BY_KEY.processDirectLin.default
  }, 'DIRECT', ctx.osInfo));
}

/**
 * 展开 BT 段（追踪器 + BT 下载软件进程）
 * @param {object} ctx 上下文
 * @param {string} [to] 目标覆写（默认直连）
 */
function expandBt(ctx, to) {
  const target = to === undefined ? 'DIRECT' : resolveTo(to, ctx);
  const {
    processProxyWin, processProxyMac, processProxyLin
  } = ctx.config;

  pushDownloadRules(ctx.rules, BT_TRACKER_RULES, target);
  ctx.rules.push(...expandProcessRules({
    win: processProxyWin || FIELDS_BY_KEY.processProxyWin.default,
    mac: processProxyMac || FIELDS_BY_KEY.processProxyMac.default,
    lin: processProxyLin || FIELDS_BY_KEY.processProxyLin.default
  }, target, ctx.osInfo));
}

/**
 * 展开下载规则集段
 * @param {object} ctx 上下文
 * @param {string} [to] 目标覆写（默认走「下载策略」）
 */
function expandDownload(ctx, to) {
  const target = to === undefined ? null : resolveTo(to, ctx);
  pushDownloadRules(ctx.rules, DOWNLOAD_RULESETS, target);
}

/**
 * 展开国内 / 海外路由方向段
 *
 * 顺序固定为「海外 → 国内域名 → 国内 IP」，两侧目标由 `trafficDirection` 与条目 `to` 决定：
 *   - `split`（默认）：海外走代理，国内走 `to ?? DIRECT`（`to` 可指向「中国分流」组）
 *   - `return`（回国）：国内走代理，海外走 `to ?? DIRECT`
 * 两侧规则集互不相交，因此内部顺序只影响产物文本，不影响命中结果。
 * @param {object} ctx 上下文
 * @param {string} [to] 直连侧目标覆写
 */
function expandDomestic(ctx, to) {
  const sideTarget = to === undefined ? 'DIRECT' : resolveTo(to, ctx);
  const cnTarget = ctx.isReturn ? ctx.proxyTarget : sideTarget;
  const foreignTarget = ctx.isReturn ? sideTarget : ctx.proxyTarget;
  ctx.rules.push(
    `RULE-SET,non-cn,${foreignTarget}`,
    `RULE-SET,cn-domain,${cnTarget}`,
    `RULE-SET,cn-ip,${cnTarget},no-resolve`
  );
}

/**
 * 展开兜底段（IPv6 / 流量审计 / MATCH）
 * @param {object} ctx 上下文
 */
function expandFinal(ctx) {
  if (ctx.config.enableIPv6) {
    ctx.rules.push(`IP-CIDR6,::/0,${groupName(GROUP_KEYS.ipv6)},no-resolve`);
  }
  if (ctx.config.enableTrafficAudit) {
    ctx.rules.push(
      `DST-PORT,53/80/443,${groupName(GROUP_KEYS.final)}`,
      'DST-PORT,1-65535,DIRECT'
    );
  }
  ctx.rules.push(`MATCH,${groupName(GROUP_KEYS.final)}`);
}

/**
 * 展开一条 `rule` 型条目
 * @param {object} ctx 上下文
 * @param {object} entry 条目 ({ rule, to })
 */
function expandRule(ctx, entry) {
  const base = entry.rule.trim();

  // 规则集简写：`geosite:google` / `geoip:cn`——自动登记默认 Provider 路径并生成 RULE-SET 规则
  const shorthand = /^(geosite|geoip):([A-Za-z0-9_.!-]+)$/i.exec(base);
  if (shorthand) {
    const kind = shorthand[1].toLowerCase();
    const name = shorthand[2];
    if (!ctx.providerBase[name]) ctx.providerBase[name] = `${kind}/${name}`;
    ctx.rules.push(`RULE-SET,${name},${resolveTo(entry.to, ctx)}`);
    return;
  }

  if (entry.to !== undefined) {
    ctx.rules.push(retarget(base, resolveTo(entry.to, ctx)));
    return;
  }
  ctx.rules.push(base);
}

/**
 * 计算 routing 条目的稳定键：preset / service / rule 原文，并叠加方向
 *
 * 同键条目视为「同一个槽位」：开关状态取该槽位最后一次出现的声明，
 * `disabled` 会关闭同键的全部条目。include 合并后片段在前、主文件在后，
 * 因此主文件的关闭 / 重新启用在合并清单上稳定生效。方向参与键，保证
 * split / return 两条同名规则互不误伤（见 CONFIGURATION 4 节）。
 *
 * @param {object} entry routing 条目
 * @returns {string|null}
 */
function routingEntryKey(entry) {
  if (!entry || typeof entry !== 'object') return null;
  let key = null;
  if (entry.preset) key = `preset:${entry.preset}`;
  else if (entry.service) key = `service:${entry.service}`;
  else if (entry.rule) key = `rule:${String(entry.rule).trim()}`;
  if (!key) return null;
  const direction = entry.direction === 'split' || entry.direction === 'return'
    ? entry.direction
    : 'both';
  return `${key}|${direction}`;
}

/**
 * 校验单个 routing 条目（fail-closed）
 *
 * 无论方向与 disabled 状态如何，凡是出现在 `routing` 表里的条目都必须全量校验：
 * 未知字段 / 字段组合 / 预设与服务的存在性 / 规则形状。`disabled` 或方向不符只负责
 * 「是否生成」，不豁免拼写错误——否则关闭的写错条目会被静默吞掉，用户无法排查。
 *
 * @param {object} ctx 展开上下文（用于目标解析）
 * @param {object} entry routing 条目
 * @param {number} idx 条目序号（用于报错路径 `routing[i]`）
 */
function validateRoutingEntry(ctx, entry, idx) {
  const path = `routing[${idx}]`;
  if (!entry || typeof entry !== 'object') {
    throw new Error(`${path}: 条目必须是对象`);
  }
  // 1. 顶层字段白名单：未知字段 fail-closed
  for (const key of Object.keys(entry)) {
    if (!ROUTING_ENTRY_KEYS.has(key)) {
      const allowed = [...ROUTING_ENTRY_KEYS].join(' / ');
      throw new Error(`${path}: 未知字段「${key}」，routing 条目支持: ${allowed}`);
    }
  }
  // 2. 三选一：preset / service / rule 互斥，任一出现即认定入口
  const modeFields = ['preset', 'service', 'rule'].filter(k => entry[k] !== undefined && entry[k] !== null && entry[k] !== '');
  if (modeFields.length === 0) {
    throw new Error(`${path}: 条目需要 preset / service / rule 之一`);
  }
  if (modeFields.length > 1) {
    throw new Error(`${path}: preset / service / rule 只能出现其一，收到 ${modeFields.join(' / ')}`);
  }
  // 3. disabled / direction 取值合法性
  if (entry.disabled !== undefined && entry.disabled !== true && entry.disabled !== false) {
    throw new Error(`${path}.disabled: 仅支持 true / false，收到 ${JSON.stringify(entry.disabled)}`);
  }
  if (entry.direction !== undefined && entry.direction !== 'split' && entry.direction !== 'return') {
    throw new Error(`${path}.direction: 仅支持 split / return，收到 ${JSON.stringify(entry.direction)}`);
  }
  // 4. 入口具体校验：预设 / 服务存在性（方向不符的条目同样校验，防止关闭侧拼错被吞）
  const disabled = entry.disabled === true;
  if (entry.preset !== undefined && entry.preset !== null && entry.preset !== '') {
    const preset = PRESET_DEFINITIONS[entry.preset];
    if (!preset) throw new Error(`${path}.preset: 未知预设 "${entry.preset}"`);
  }
  if (entry.service !== undefined && entry.service !== null && entry.service !== '') {
    const found = findService(ctx.registries, entry.service);
    if (!found) throw new Error(`${path}.service: 未知服务 "${entry.service}"`);
  }
  if (entry.rule !== undefined && entry.rule !== null && entry.rule !== '') {
    if (typeof entry.rule !== 'string' || !entry.rule.trim()) {
      throw new Error(`${path}.rule: 期望非空匹配表达式`);
    }
    // 规则目标论证：自表达式缺目标且未提供 `to` 时 fail-closed。
    // 例外：`disabled: true` 的条目只是「关闭同键槽位」，允许省略 `to`（该条目本身不产出规则）。
    const base = entry.rule.trim();
    if (!disabled && entry.to === undefined) {
      const shorthand = /^(geosite|geoip):/i.test(base);
      if (shorthand) {
        throw new Error(`${path}: 规则集简写缺少目标 \`to\`：${base}`);
      }
      if (base.split(',').filter(Boolean).length < 3) {
        throw new Error(`${path}: 规则缺少目标且未提供 \`to\`：${base}`);
      }
    }
  }
  // 5. `to` 目标解析：按条目自身 direction 取目标表（未生效方向的条目同样校验目标合法性）
  if (entry.to !== undefined) {
    if (typeof entry.to !== 'string' || !entry.to.trim()) {
      throw new Error(`${path}.to: 条目缺少目标 \`to\``);
    }
    try {
      ctx.targets.resolve(entry.to.trim());
    } catch (err) {
      throw new Error(`${path}.to: ${String(err.message).replace(/^routing:\s*/, '')}`);
    }
  }
}

/**
 * 校验整张 routing 表（fail-closed）
 *
 * 方向参与校验上下文选择：`direction: return` 的条目在 `split` 构建时也会被校验，
 * 但它的 `to` 必须按 `return` 方向的目标表判定，否则「只属于另一方向的合法配置」
 * 会被误杀。缺省方向（双向生效）沿用当前构建方向。
 *
 * @param {Array<object>} routing 顺序化条目
 * @param {object} userConfig 合并后的用户配置
 * @param {object} registries `ServiceCatalog#toRegistries()` 的结果
 * @param {object} [options={}] 展开选项（disabledRefs 等）
 */
function validateRouting(routing, userConfig, registries, options = {}) {
  if (!Array.isArray(routing)) {
    throw new TypeError('routing: 期望条目对象数组（数组顺序即匹配优先级）');
  }
  if (routing.length === 0) {
    throw new Error('routing: 配置为空，至少需要一条 `{ preset: final }`（否则产物没有 MATCH 兜底）');
  }
  const contexts = new Map();
  const contextFor = direction => {
    const cacheKey = direction === 'split' || direction === 'return' ? direction : 'current';
    if (!contexts.has(cacheKey)) {
      const scoped = cacheKey === 'current' ? options : { ...options, direction: cacheKey };
      contexts.set(cacheKey, createContext(userConfig, registries, scoped));
    }
    return contexts.get(cacheKey);
  };
  routing.forEach((entry, idx) => {
    const direction = entry && typeof entry === 'object' ? entry.direction : undefined;
    validateRoutingEntry(contextFor(direction), entry, idx);
  });
}

/**
 * 展开单个 routing 条目
 * @param {object} ctx 上下文
 * @param {object} entry routing 条目
 */
function expandEntry(ctx, entry) {
  if (entry.disabled === true) return;
  if (entry.direction !== undefined && entry.direction !== ctx.direction) {
    // 方向不符的条目不生成：每条只保留一个目标，不引入「同一条目两套目标」的分支状态。
    // 结构校验已在 validateRouting 完成，此处只做「是否生成」的方向过滤。
    return;
  }
  if (entry.preset !== undefined && entry.preset !== null && entry.preset !== '') {
    const preset = PRESET_DEFINITIONS[entry.preset];
    expandPreset(ctx, preset, entry);
    return;
  }
  if (entry.service !== undefined && entry.service !== null && entry.service !== '') {
    const key = entry.service;
    const found = findService(ctx.registries, key);
    expandService(ctx, key, found.item, entry.to);
    return;
  }
  if (entry.rule !== undefined && entry.rule !== null && entry.rule !== '') {
    expandRule(ctx, entry);
    return;
  }
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
  // 聚合组：规则来源在聚合条目上（组目录只承载声明）
  const aggregate = Object.values(registries.aggregates || {})
    .find(item => item && (item.refKey || item.key) === key);
  if (aggregate) return { category: 'aggregates', item: aggregate };
  // 独立单组规则来源（广告拦截）：规则与 Provider 由 ADS_GROUPS 提供
  const ads = ADS_GROUPS[key];
  if (ads) {
    const declaredName = registries.groups?.[key]?.name;
    return { category: 'groups', item: declaredName ? { ...ads, name: declaredName } : ads };
  }
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
    case 'quic': return expandQuic(ctx, to);
    case 'ads': return expandAds(ctx, to);
    case 'category': return expandCategory(ctx, preset, to);
    case 'dev': return expandDev(ctx, preset, to);
    case 'specialized': return expandSpecialized(ctx, to);
    case 'process': return expandProcess(ctx);
    case 'bt': return expandBt(ctx, to);
    case 'download': return expandDownload(ctx, to);
    case 'domestic': return expandDomestic(ctx, to);
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
 * @returns {{ rules: string[], providers: object, targets: string[] }}
 */
function expandRouting(userConfig = {}, registries = {}, options = {}) {
  const ctx = createContext(userConfig, registries, options);
  const routing = Array.isArray(options.routing)
    ? options.routing
    : (Array.isArray(userConfig.routing) ? userConfig.routing : DEFAULT_ROUTING);
  // 装配前先过同一份 schema 校验（与装载期共用单一实现）：
  // 空表 / 结构 / 字段组合 / 预设与服务存在性 / 目标合法性全部在此 fail-closed。
  validateRouting(routing, userConfig, registries, options);

  const cdnBase = userConfig.ruleProviderCDN || FIELDS_BY_KEY.ruleProviderCDN.default;
  const repo = `${cdnBase}/MetaCubeX/meta-rules-dat@meta`;
  const ruleFormat = userConfig.useMRS ? 'mrs' : 'yaml';

  // 规则只有一个来源：`routing` 表按数组顺序展开。组声明（`groups`）不再顺带产出规则。
  // `disabled` 先按「同键最后一次出现」结算成关闭键集合，再统一过滤：
  // 与 groups 的「位置靠后者胜」一致；include 合并后主文件位于片段之后，其写法稳定生效。
  const finalState = new Map();
  for (const entry of routing) {
    if (!entry || typeof entry !== 'object') continue;
    const key = routingEntryKey(entry);
    if (key) finalState.set(key, { disabled: entry.disabled === true });
  }
  const disabledKeys = new Set(
    [...finalState.entries()].filter(([, state]) => state.disabled).map(([key]) => key)
  );
  for (const entry of routing) {
    if (entry && typeof entry === 'object' && entry.disabled !== true) {
      const key = routingEntryKey(entry);
      if (key && disabledKeys.has(key)) continue;
    }
    expandEntry(ctx, entry);
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

  return { rules, providers, targets: collectTargets(rules) };
}

module.exports = {
  expandRouting,
  validateRouting,
  resolveTo,
  retarget,
  collectTargets,
  ruleTargetOf,
  DEFAULT_ROUTING,
  PRESET_DEFINITIONS
};
