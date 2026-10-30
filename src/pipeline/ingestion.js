/**
 * -----------------------------------------------------------------------------
 * Pipeline Layer: 订阅摄入流水线与安全网关 (Subscription Ingestion Pipeline)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 并发调度多订阅 HTTP 拉取与直接 URI 识别
 * 2. 结合 Stale 缓存实施失败平滑容灾降级
 * 3. 提取订阅信息、识别机场标签、嗅探重置日
 * 4. 控制面净化审计与节点专属资产闭包提取 (applySubscriptionGuards)
 * 5. 树状输出解析统计日志
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseContent, parseSubscriptionInfo, evaluateExpiry, normalizeTimeZone, formatDateInZone, isExpiredNow, isQuotaExhausted } = require('../io/parsers');
const { hasOnlyPlaceholderNodes } = require('../core/notice');
const { markTrustedSynthetic, markTrustedProxyMetadata, sanitizeExternalProxies } = require('../core/node-trust');
const { redactUrl } = require('../io/ssrf');
const { fetchNodes, resolveProxyUrl, checkPortReachable, detectTunInterface, subStaleCache, pruneSubStaleCache, isSubInFetchBackoff, recordSubFetchFailure, clearSubFetchFailure, getSubFetchBackoff } = require('../io/fetcher');
const { normalizeCacheDurations } = require('../io/cache');
const { DEFAULT_REQUEST_LIMITS } = require('../io/limits');
const { createRepeatGate, formatDuration } = require('../core/logger');
const { partitionControlPlane } = require('../core/security/control-plane');
const { sanitizeHosts, sanitizeNameserverPolicy, sanitizeDnsServerList, ROLES } = require('../core/security/dns-sanitizer');
const { resolveNodeDnsPolicies } = require('../core/security/node-dns-policy');
const { effectiveProtectedDomains } = require('../data');
const {
  isDirectNodeSub,
  buildDirectProxy,
  resolveDialerProxy,
  resolveShouldKeepName,
  resolveSubType
} = require('./direct-node');

// 统一解耦 Strategy 层看板逻辑：遵循洋葱模型，由上层 Pipeline 显式注入依赖，杜绝反向 require
function getDashboard(injected) {
  return injected || {};
}

function isSubEnabled(s) {
  if (!s || typeof s !== 'object') return false;
  return s.enabled !== false;
}

/** 归属「到期/停用类」的终态种类：看板渲染 🛑，其余终态仍属拉取失败 */
const EXPIRY_TERMINAL_KINDS = ['expired', 'cutoff', 'stale-expired', 'stale-cutoff'];

/**
 * 校验一次成功拉取的订阅响应：到期 / 流量耗尽 / 空节点 / 纯占位节点均视为异常并抛出带标记的错误。
 * 多订阅与单 URL 两条路径共用，保证「异常响应」判定完全一致。
 * @param {object} rawResult 拉取结果
 * @param {number} [cutoffHours=0] 提前判定停用的小时数（见 evaluateExpiry）
 * @throws {Error} 带 isExpired / isQuotaExhausted / isPlaceholderOnly 标记
 */
function validateFetchedSubscription(rawResult, cutoffHours = 0) {
  if (rawResult.subInfo) {
    const info = parseSubscriptionInfo(rawResult.subInfo);
    // 1. 本次响应明确已到期（含提前 cutoff 判定）：绝不作为健康订阅，拒绝写入缓存
    if (isExpiredNow(info.expire, cutoffHours)) {
      const err = new Error(`Subscription expired at ${new Date(info.expire * 1000).toISOString().split('T')[0]}`);
      err.isExpired = true;
      err.subInfo = rawResult.subInfo;
      throw err;
    }
    // 2. 本次响应明确流量耗尽：绝不作为健康订阅
    if (isQuotaExhausted(info)) {
      const err = new Error('Subscription quota exhausted (upload + download >= total)');
      err.isQuotaExhausted = true;
      err.subInfo = rawResult.subInfo;
      throw err;
    }
  }

  const parsedProxies = sanitizeExternalProxies(parseContent(rawResult.content).proxies || []);
  if (!rawResult.content || parsedProxies.length === 0) {
    throw new Error('Subscription returned no nodes');
  }
  // 有效性检查：若返回的节点全部为无服务能力的占位/续费/提示节点，视为异常响应
  if (hasOnlyPlaceholderNodes(parsedProxies)) {
    const err = new Error('Subscription returned only placeholder/notice nodes');
    err.isPlaceholderOnly = true;
    throw err;
  }
}

/**
 * 由旧缓存的到期信息推导终态种类与中文原因；未失效时返回 null。
 *
 * 提前截断（stale-cutoff）与真实过期（stale-expired）分开表述，
 * 避免在尚未到到期时刻时提前宣称「已到期」。
 */
function describeStaleExpiry(stale, cutoffHours, timeZone = '') {
  const { expire } = parseSubscriptionInfo(stale?.subInfo);
  const expiry = evaluateExpiry(expire, cutoffHours);
  if (!expiry.expired) return null;
  const date = formatDateInZone(expire, timeZone);
  return expiry.cutoffExpired
    ? { kind: 'stale-cutoff', reason: `旧缓存已停用（${date} 到期）` }
    : { kind: 'stale-expired', reason: `旧缓存已失效（${date} 到期）` };
}

/**
 * 拉取失败后的「终态失效判定 + 容灾降级决策」，多订阅与单 URL 两条路径共用。
 *
 * 终态失效（HTTP 401 / 本次到期或提前停用 / 本次流量耗尽 / 旧缓存已过期或已提前停用）
 * 时安全淘汰旧缓存，并给出是否允许回退旧缓存及拒绝原因。安全淘汰严格要求命中请求发起时
 * 捕获的旧条目，防止误删并发新任务刚写入的健康条目。
 *
 * @returns {{ isTerminal: boolean, terminalKind: string, terminalReason: string, fallbackRejectReason: string, allowFallback: boolean, stale: object|null }}
 *   terminalKind — http401 | expired | cutoff | quota | stale-expired | stale-cutoff（非终态为空串）
 */
function evaluateStaleFallback(err, { subKey, initialStale, staleMaxAgeMs, cutoffHours = 0, timeZone = '' }) {
  const stale = subStaleCache.get(subKey);

  // ─── 阶段一：独立判定终态失效（不依赖旧缓存是否存在或是否超期） ───
  let isTerminal = false;
  let terminalKind = '';
  let terminalReason = '';

  const httpStatus = err?.statusCode || err?.status;
  if (httpStatus === 401) {
    isTerminal = true;
    terminalKind = 'http401';
    terminalReason = 'HTTP 401 凭据失效';
  } else if (err?.isExpired) {
    isTerminal = true;
    if (evaluateExpiry(parseSubscriptionInfo(err.subInfo).expire, cutoffHours).cutoffExpired) {
      terminalKind = 'cutoff';
      terminalReason = `订阅已停用（距到期不足 ${cutoffHours} 小时）`;
    } else {
      terminalKind = 'expired';
      terminalReason = '订阅已失效';
    }
  } else if (err?.isQuotaExhausted) {
    isTerminal = true;
    terminalKind = 'quota';
    terminalReason = '流量已耗尽';
  } else if (stale) {
    const staleExpiry = describeStaleExpiry(stale, cutoffHours, timeZone);
    if (staleExpiry) {
      isTerminal = true;
      terminalKind = staleExpiry.kind;
      terminalReason = staleExpiry.reason;
    }
  }

  if (isTerminal) {
    if (typeof subStaleCache.deleteIfMatch === 'function') {
      subStaleCache.deleteIfMatch(subKey, initialStale);
    } else if (initialStale && subStaleCache.get(subKey) === initialStale) {
      subStaleCache.delete(subKey);
    }
  }

  // ─── 阶段二：容灾决策检查（决定是否允许降级兜底） ───
  let allowFallback = false;
  let fallbackRejectReason = '';

  if (isTerminal) {
    fallbackRejectReason = `${terminalReason}，拒绝回退旧缓存`;
  } else if (!stale) {
    fallbackRejectReason = '无历史缓存';
  } else if (Date.now() - stale.timestamp >= staleMaxAgeMs) {
    fallbackRejectReason = '缓存超过保留期限 (fetchStaleTtl)';
  } else {
    // 网络超时、连接错误、5xx 或经论证的异常，允许降级
    allowFallback = true;
  }

  return { isTerminal, terminalKind, terminalReason, fallbackRejectReason, allowFallback, stale };
}

/**
 * 判定退避期内的订阅是否可直接复用旧缓存（不发起网络请求）。
 *
 * 旧缓存已过期时按终态处理并安全淘汰，避免退避期把死数据无限续命。
 *
 * @param {string} subKey
 * @param {object|null} initialStale 请求发起时捕获的旧条目快照
 * @param {number} staleMaxAgeMs
 * @returns {{ state: object, stale: object|null, usable: boolean, expired: boolean, staleExpiry: object|null } | null}
 */
function resolveBackoffStale(subKey, initialStale, staleMaxAgeMs, cutoffHours = 0, timeZone = '') {
  const state = getSubFetchBackoff(subKey);
  if (!state) return null;

  const stale = subStaleCache.get(subKey);
  const staleExpiry = stale ? describeStaleExpiry(stale, cutoffHours, timeZone) : null;
  const expired = !!staleExpiry;

  if (expired) {
    if (typeof subStaleCache.deleteIfMatch === 'function') {
      subStaleCache.deleteIfMatch(subKey, initialStale);
    } else if (initialStale && subStaleCache.get(subKey) === initialStale) {
      subStaleCache.delete(subKey);
    }
  }

  const usable = !!stale && !expired && (Date.now() - stale.timestamp < staleMaxAgeMs);
  return { state, stale, usable, expired, staleExpiry };
}

/**
 * 格式化控制面沙箱告警，去除内部枚举 ID 并以分级树形分支展示。
 * @param {object} report partitionControlPlane 审计报告
 * @param {number} [repeatCount=1] 同一来源 + 同一审计结果的第几次出现（1 表示首次发现）
 */
function formatControlPlaneWarning(report, repeatCount = 1) {
  if (!report || !Array.isArray(report.hostile) || report.hostile.length === 0) return null;

  const critical = [];
  const config = [];
  const unknown = [];

  for (const h of report.hostile) {
    if (h.severity === 'critical') {
      critical.push(h.key);
    } else if (h.id === 'CP-UNKNOWN') {
      unknown.push(h.key);
    } else {
      config.push(h.key);
    }
  }

  const count = report.hostile.length;
  // 重复检测：同一来源在缓存复用/退避复用时再次审计到相同字段。
  // 实际剥离仍已执行，仅在日志级别降噪，因此必须保留「重复次数 + 实际剥离」信息。
  if (repeatCount > 1) {
    const keys = report.hostile.map(h => h.key);
    const preview = keys.slice(0, 8).join(', ') + (keys.length > 8 ? ', …' : '');
    return `🛡️ 控制面沙箱：订阅 [${report.tag}] 重复检测（第 ${repeatCount} 次 · 相同 ${count} 项越权字段，本次仍已实际剥离：${preview}）`;
  }

  // 若剥离项极少（1~2 项）且无严重夺权风险，采用单行紧凑模式
  if (count <= 2 && critical.length === 0) {
    const keys = report.hostile.map(h => h.key).join(', ');
    return `🛡️ 控制面沙箱：订阅 [${report.tag}] 首次发现并已实际剥离 ${count} 项配置字段（${keys}）`;
  }

  // 存在夺权威胁或多项改写时，采用树形分支结构化展示
  const lines = [`🛡️ 控制面沙箱：订阅 [${report.tag}] 首次发现越权字段，已实际剥离 ${count} 项控制字段：`];
  const branches = [];
  if (critical.length > 0) {
    branches.push(`🚨 夺权风险：${critical.join(', ')}`);
  }
  if (config.length > 0) {
    branches.push(`⚙️ 配置改写：${config.join(', ')}`);
  }
  if (unknown.length > 0) {
    branches.push(`❓ 未知字段：${unknown.join(', ')}`);
  }

  branches.forEach((b, idx) => {
    const isLast = idx === branches.length - 1;
    lines.push(`${isLast ? '└──' : '├──'} ${b}`);
  });

  return lines.join('\n');
}

/**
 * 本次数据来源的唯一映射：图标 + 文案。
 * 必须把「L1 订阅快照」「订阅级容灾缓存」「L2 组装产物缓存」区分开，禁止统一说成「缓存」。
 * 注：L2（SWR 陈旧缓存）不进入解析阶段，由 engine 单独记录，不在此处出现。
 */
const ORIGIN_META = {
  fetch: { icon: '🌐', label: '回源' },
  snapshot: { icon: '⚡', label: '复用快照' },
  'fallback-stale': { icon: '⚠️', label: '缓存兜底' },
  'backoff-reuse': { icon: '⏳', label: '退避跳过 · 复用缓存兜底' },
  'backoff-skip': { icon: '⏳', label: '退避跳过 · 无可用缓存' },
  file: { icon: '📄', label: '本地文件' },
  uri: { icon: '📌', label: 'URI 节点' },
  direct: { icon: '📌', label: '直连节点' },
  terminal: { icon: '🛑', label: '终态失效' },
  'fetch-failed': { icon: '❌', label: '回源失败' }
};

function describeOrigin(origin) {
  return ORIGIN_META[origin] || { icon: '❓', label: '未知来源' };
}

/** 把退避时长格式化为日志可读文本（30s / 2m / 6h），避免终端长冷却时出现 21600s */

/** 提取节点资产域名（用于专属依赖闭包识别） */
function extractAssetDomains(proxies = [], subUrl = '') {
  const domains = new Set();
  if (subUrl && typeof subUrl === 'string' && subUrl.startsWith('http')) {
    try {
      const u = new URL(subUrl);
      if (u.hostname) domains.add(u.hostname.toLowerCase());
    } catch {}
  }
  for (const p of proxies) {
    if (!p || typeof p !== 'object') continue;
    if (p.server && typeof p.server === 'string') {
      const s = p.server.replace(/^\[|\]$/g, '').trim().toLowerCase();
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(s) && !s.includes(':')) {
        domains.add(s);
      }
    }
    // 注意：严禁将 sni 与 servername 作为订阅专属资产域！
    // 伪装 SNI 通常为 apple.com、bilibili.com、hoyoverse.com 等公共 CDN，
    // 若识别为资产域，会误将订阅中的公共域名 Hosts/Policy/Fake-IP 规则穿透继承，造成劫持或绕行。
  }
  return domains;
}

/**
 * 判定是否属于该订阅资产（节点域名）自身或其子域。
 *
 * 两条边界：
 *   - 向下继承：`cdn.node.example.com` 受资产 `node.example.com` 覆盖（合法用途）。
 *   - 向上覆盖：订阅自己的 `+.example.com` 可以覆盖资产 `node.example.com`，
 *     但**必须比 TLD 更窄**（至少两个 label）。历史实现无条件允许父域方向，
 *     于是 `hosts: { "+.com": "6.6.6.6" }` 把整个 TLD 纳入闭包——节点域名永远是
 *     `something.com`，`com` 就成了它的「父域」；而 `sanitizeHosts` 的受保护域名
 *     判定只查子域方向，拦不住单 label 域名，产物里就出现整域劫持。
 *     单 label 的向上覆盖没有任何正当用途，一律拒绝。
 */
function matchesAssetDomain(domainOrPattern, assetDomains) {
  if (!domainOrPattern || typeof domainOrPattern !== 'string') return false;
  const raw = domainOrPattern.trim().toLowerCase();
  const isWildcard = /^(\+|\*)\./.test(raw);
  const clean = raw.replace(/^\+?\./, '').replace(/^\*\./, '');
  for (const asset of assetDomains) {
    if (asset === clean || clean.endsWith('.' + asset)) {
      return true;
    }
    if (isWildcard && clean.includes('.') && asset.endsWith('.' + clean)) {
      return true;
    }
  }
  return false;
}

/**
 * 订阅配置统一安全网关 (Subscription Security Gateway)
 *
 * 对「单个订阅源」的原始配置执行两步处理，供多订阅与单 URL/本地文件两条输入路径**共用**，
 * 杜绝净化逻辑分叉 —— 历史上单 URL 路径完全没有调用净化，导致订阅的控制面字段直接进入产物。
 *
 *   1. 控制面净化审计：报告并记录夺权/开放入站/隧道注入等越权字段（产物侧再由交付契约收口）；
 *   2. 节点专属资产闭包提取 (Dependency Tracing)：只把「指向自身节点资产域」的
 *      Hosts / Nameserver-Policy / Fake-IP-Filter 收编，其余一律丢弃。
 *
 * 本函数只做「审计与提取」，提取结果以**返回值**交给调用方，
 * 绝不挂载到配置对象上 —— 配置对象是产物，不应兼作跨模块的隐式消息通道。
 *
 * @param {object} subConfig 订阅源解析出的原始配置对象
 * @param {object} [options={}]
 * @param {Array}   [options.proxies=[]] 该订阅的节点列表（用于推导资产域）
 * @param {string}  [options.subUrl=''] 订阅源地址（其 hostname 亦计入资产域）
 * @param {string}  [options.identityUrl=''] 订阅身份种子（URL/URI，仅用于 SHA256 短哈希，不进入日志）
 * @param {string}  [options.tag=''] 订阅标识（审计用）
 * @param {object}  [options.logger] 日志器
 * @param {string}  [options.assetClosureMode='standard'] 资产闭包强度：
 *                  standard — 允许订阅为其自称的节点域名下发 hosts/policy（依赖受保护域名清单兜底）
 *                  strict   — 仅允许 assetDomainAllowlist 中显式声明的注册域被继承
 *                  off      — 完全不继承（DNS 面 100% 由本工具重建）
 * @param {string[]} [options.assetDomainAllowlist=[]] strict 模式下的允许域名列表
 * @param {string[]} [options.protectedDomains=[]] 用户在受保护域名基线上追加的域名
 * @param {string}  [options.outputMode='config'] 交付形态 (config | nodes | report)；
 *                  assets 仅在 config 模式由 src/strategy/dns.js 消费，nodes 模式下会被丢弃，
 *                  此时对已提取的资产改为告警而非静默继承
 * @returns {{ strippedCount: number, hosts: string[], policies: string[], fakeIpFilters: string[],
 *            assets: { hosts: object, policies: object, fakeIpFilters: string[] } }}
 *          hosts/policies/fakeIpFilters 为键名清单（供审计日志），assets 为实体载荷（供装配阶段合并）
 */

// 控制面审计日志去重：按「订阅来源 + 同一组越权字段」隔离计数。
// 仅用于降低缓存复用/退避复用时重复告警的噪声；安全检查与字段剥离始终执行，不因去重跳过。
const controlPlaneAuditGate = createRepeatGate(200);

// 节点域名解析器冲突日志去重：按域名计数，首次 warn、重复 debug。
// 去重只影响日志级别，冲突域名在任何一次构建中都始终不写入映射。
const nodeDnsConflictGate = createRepeatGate(100);

/**
 * 解析控制面审计的来源身份。
 *
 * 优先使用订阅 URL（sha256 摘要作为内部键，原始 URL 含凭据且绝不进入日志），
 * 避免不同订阅复用同一显示 tag 时错误共享去重计数；URL 缺失（本地文件 / URI）时退回 tag。
 */
function resolveAuditSourceId({ subUrl = '', tag = '' } = {}) {
  if (subUrl) {
    const digest = crypto.createHash('sha256').update(String(subUrl)).digest('hex');
    return `url:${digest.slice(0, 16)}`;
  }
  return tag || 'anonymous';
}

/**
 * 输出节点域名解析器冲突告警（脱敏）。
 *
 * 冲突域名整体退出映射并由 DNS 装配层回退默认解析链；日志只包含域名与订阅数量，
 * 绝不输出订阅 URL、解析器地址或 token。首次 warn，重复 debug 并保留次数。
 */
function logNodeDnsConflicts(conflicts = [], logger) {
  if (!logger || !Array.isArray(conflicts)) return;
  for (const conflict of conflicts) {
    const seenTimes = nodeDnsConflictGate(conflict.domain);
    const base = `🛡️ 节点解析器冲突：域名 ${conflict.domain} 来自 ${conflict.subscriptions} 个订阅且解析器不同，本次不写入该域名映射（回退默认 DNS）`;
    if (seenTimes > 1) {
      logger.debug(`${base}（第 ${seenTimes} 次 · 本次仍未写入映射）`);
    } else {
      logger.warn(base);
    }
  }
}

function applySubscriptionGuards(subConfig, options = {}) {
  const {
    proxies = [], subUrl = '', identityUrl = '', tag = '', logger,
    assetClosureMode = 'standard', assetDomainAllowlist = [], protectedDomains = [],
    outputMode = 'config'
  } = options;
  const result = {
    strippedCount: 0,
    hosts: [],
    policies: [],
    fakeIpFilters: [],
    proxyResolvers: [],
    resolverCandidates: [],
    assets: { hosts: {}, policies: {}, fakeIpFilters: [], proxyResolvers: [], resolverCandidates: [] }
  };

  if (!subConfig || typeof subConfig !== 'object') return result;

  // 1. 控制面净化审计（记录越权字段，供日志与审计统计使用）
  const { report } = partitionControlPlane(subConfig, { tag });
  result.strippedCount = (report.hostile && report.hostile.length) || 0;
  if (result.strippedCount > 0 && logger) {
    // 去重键 = 订阅来源 + 本次审计结果；不同订阅绝不共享同一条目。
    const sourceId = resolveAuditSourceId({ subUrl, tag });
    const auditSignature = report.hostile.map(h => h.key).sort().join(',');
    const seenTimes = controlPlaneAuditGate(`${sourceId}|${auditSignature}`);
    const warnMsg = formatControlPlaneWarning(report, seenTimes);
    if (warnMsg) {
      if (seenTimes > 1) logger.debug(warnMsg);
      else logger.warn(warnMsg);
    }
  }

  // 2. 资产闭包强度判定
  //    背景：节点 server 字段由订阅控制，因此「自己的节点域名」这一说法天然可被伪造，
  //    订阅可借 hosts/nameserver-policy 劫持任意非受保护域名。此处提供可收紧的开关，
  //    并对外显式审计每一次继承（透明化是这一机制唯一可靠的兜底）。
  const closureOff = assetClosureMode === 'off' || assetClosureMode === false;
  if (closureOff) return result;

  const strictList = assetClosureMode === 'strict'
    ? (Array.isArray(assetDomainAllowlist) ? assetDomainAllowlist : []).map(d => String(d).toLowerCase().trim()).filter(Boolean)
    : null;

  const assetDomains = extractAssetDomains(proxies, subUrl);
  const isInheritable = (key) => {
    if (!matchesAssetDomain(key, assetDomains)) return false;
    if (strictList) return strictList.some(d => matchesAssetDomain(key, [d]));
    return true;
  };

  // 3. 专属 Hosts 提取（优选 IP 闭包保留，排除公共资产劫持与私网重定向）
  if (subConfig.hosts && typeof subConfig.hosts === 'object') {
    const scopedHosts = {};
    for (const [hostKey, hostVal] of Object.entries(subConfig.hosts)) {
      if (isInheritable(hostKey)) {
        scopedHosts[hostKey] = hostVal;
      }
    }
    const { hosts: cleanHosts } = sanitizeHosts(scopedHosts, {
      allowInternal: false,
      // 与 dns.js 用户 hosts 路径共用同一份生效清单：基线 ∪ 用户追加。
      // 否则用户新增的受保护域名在这条「节点资产闭包」通道上会被绕过。
      protectedDomains: effectiveProtectedDomains(protectedDomains)
    });
    if (cleanHosts && Object.keys(cleanHosts).length > 0) {
      result.assets.hosts = { ...result.assets.hosts, ...cleanHosts };
      result.hosts = Object.keys(cleanHosts);
    }
  }

  // 4. 专属 Nameserver-Policy 提取（节点私有 DoH 依赖闭包保留）
  const rawPolicy = (subConfig.dns && subConfig.dns['nameserver-policy']) || subConfig['nameserver-policy'];
  if (rawPolicy && typeof rawPolicy === 'object') {
    const scopedPolicy = {};
    for (const [polKey, polVal] of Object.entries(rawPolicy)) {
      if (isInheritable(polKey)) {
        scopedPolicy[polKey] = polVal;
      }
    }
    const { policy: cleanPolicy } = sanitizeNameserverPolicy(scopedPolicy, { trustedSource: true });
    if (cleanPolicy && Object.keys(cleanPolicy).length > 0) {
      result.assets.policies = { ...result.assets.policies, ...cleanPolicy };
      result.policies = Object.keys(cleanPolicy);
    }
  }

  // 5. Fake-IP Filter 节点专属过滤继承
  const rawFakeFilters = subConfig.dns && subConfig.dns['fake-ip-filter'];
  if (Array.isArray(rawFakeFilters)) {
    const kept = [];
    for (const f of rawFakeFilters) {
      if (typeof f === 'string' && isInheritable(f)) kept.push(f);
    }
    if (kept.length > 0) {
      result.assets.fakeIpFilters.push(...kept);
      result.fakeIpFilters = kept;
    }
  }

  // 6. 节点专属解析器继承（proxy-server-nameserver）
  //    这里只登记「该订阅的节点域名 → 该订阅的 DoH」候选，不直接写最终映射。
  //    多订阅若出现同名域名，必须由上层全局冲突决议后再生成 nameserver-policy，
  //    避免后处理无法撤销已写入条目、或按遍历顺序静默择一。
  //    仅允许加密 DNS（DoH/DoT/DoQ）；strict 模式仅映射白名单内的节点域名。
  const rawProxyResolvers = (subConfig.dns && subConfig.dns['proxy-server-nameserver'])
    || subConfig['proxy-server-nameserver'];
  if (rawProxyResolvers) {
    const clean = sanitizeDnsServerList(rawProxyResolvers, {
      role: ROLES.PROXY_SERVER,
      allowDomainProxyServer: true
    }).servers.slice(0, 4);
    const resolverDomains = clean.length > 0
      ? [...extractAssetDomains(proxies, '')].filter(d => isInheritable(d))
      : [];
    if (resolverDomains.length > 0) {
      const sourceId = resolveAuditSourceId({ subUrl: identityUrl || subUrl, tag });
      result.assets.proxyResolvers = clean;
      result.proxyResolvers = clean;
      result.resolverCandidates = resolverDomains.map(domain => ({ domain, resolvers: clean, sourceId }));
      result.assets.resolverCandidates = result.resolverCandidates;
    }
  }

  // 6. 继承审计：让使用者看得见「订阅为我挂载了哪些 DNS 依赖」
  //    这些资产只在 config 模式由 src/strategy/dns.js 消费；nodes 产物结构上没有 dns 段，
  //    资产会随 Checkpoint 早退被静默丢弃 —— 对「节点域名只能靠订阅私货解析」的来源，
  //    产物里的节点将无法连接，故此处必须显式告警而非仅 info。
  if (logger && typeof logger.info === 'function') {
    // 分类计数替代逐项罗列：依赖可达数十项，全量展开会淹没日志；解析器 URL 含 token，绝不进入日志。
    const counts = [
      ['解析器', result.proxyResolvers.length],
      ['域名', result.resolverCandidates.length],
      ['策略', result.policies.length],
      ['Hosts', result.hosts.length],
      ['fake-ip', result.fakeIpFilters.length]
    ].filter(([, n]) => n > 0);
    const total = counts.reduce((sum, [, n]) => sum + n, 0);
    if (total > 0) {
      const breakdown = counts.map(([label, n]) => `${label} ${n}`).join(' · ');
      if (outputMode === 'nodes' && typeof logger.warn === 'function') {
        logger.warn(
          `⚠️ 解析依赖：订阅 [${tag}] 携带 ${total} 项节点专属 DNS 依赖（${breakdown}），` +
          `但 nodes 产物不含 dns 段，这些依赖会被丢弃；若相关节点域名需靠其解析，节点将无法连接`
        );
      } else {
        logger.info(
          `🛡️ 资产闭包：订阅 [${tag}] 继承 ${total} 项节点专属 DNS 依赖（${breakdown}）`
        );
      }
    }
  }

  return result;
}

/** 合并单个订阅提取出的 DNS 资产闭包到累积容器（多订阅 / 单 URL 两条路径共用） */
function mergeDnsAssets(into, from) {
  Object.assign(into.hosts, from.hosts);
  Object.assign(into.policies, from.policies);
  into.fakeIpFilters.push(...from.fakeIpFilters);
  into.proxyResolvers = [...new Set([...into.proxyResolvers, ...from.proxyResolvers])].slice(0, 4);
  // 候选只做累积，绝不在合并阶段做域名并集；同名域名的取舍由全局冲突决议统一处理。
  into.resolverCandidates.push(...(from.resolverCandidates || []));
  return into;
}

/**
 * 处理所有订阅源或单 URL，并完成前置解析与看板合成
 */
async function processSubscriptionSources({ subscriptions, url, userConfig = {}, options = {}, logger, dashboard, outputMode = 'config' }) {
  const dsh = getDashboard(dashboard);
  const extractResetText = dsh.extractResetText || (() => '');
  const filterRawInfoNodes = dsh.filterRawInfoNodes || ((p) => p);
  const generateInfoNodes = dsh.generateInfoNodes || (() => ({ nodes: [], expireDays: -1 }));
  const sortDashboardNodes = dsh.sortDashboardNodes || (nodes => nodes);
  const createFetchErrorNode = dsh.createFetchErrorNode || ((tag, msg) => markTrustedSynthetic({ name: `❌ [${tag}] 拉取失败：${msg}`, type: 'direct', server: '1.0.0.1', port: 80, isSyntheticInfo: true }));

  /**
   * 渲染终态看板节点：到期 / 提前停用（含旧缓存命中）统一转为 🛑 套餐看板，
   * 其余终态（401 / 流量耗尽 / 无法判定）渲染 ❌ 拉取失败占位。
   * 多订阅 catch 与单 URL 收尾共用，避免两条路径各写一套分支。
   */
  function buildTerminalNodes({ terminalKind = '', terminalReason = '', subInfo = null, tag = '', errorTag = tag, errorMessage = '', cutoffHours = 0, timeZone = '' }) {
    if (subInfo && EXPIRY_TERMINAL_KINDS.includes(terminalKind)) {
      const { nodes } = generateInfoNodes(subInfo, tag, { cutoffHours, timeZone });
      if (nodes.length > 0) return nodes;
    }
    return [createFetchErrorNode(errorTag, terminalReason || errorMessage)];
  }
  const showFullUrl = userConfig.redactLevel === 'off';
  const debug = !!options.debug || userConfig.logLevel === 'debug';
  const enableDashboard = userConfig.enableDashboard !== false;
  const fetchRetry = typeof userConfig.fetchRetry === 'number' ? userConfig.fetchRetry : 2;
  const fetchTimeoutSec = typeof userConfig.fetchTimeout === 'number' ? userConfig.fetchTimeout : 15;
  const staleMaxAgeMs = (typeof userConfig.fetchStaleTtl === 'number' ? userConfig.fetchStaleTtl : 24) * 60 * 60 * 1000;
  // 原始订阅快照（L1）的新鲜期复用 cacheTtl：与 Profile 快照（L2，按 Host 隔离）共用同一时间口径，
  // 不额外引入配置字段。L1 只与订阅 URL 相关，因此预热写入的内容可被任意 Host 的首次请求复用。
  const { freshTtlMs: subFreshTtlMs } = normalizeCacheDurations(userConfig);
  // 到期前 N 小时判定已停用的小时数：默认 24（到期时刻前 24h 停用），显式 0 表示关闭提前截断
  const expireCutoffHours = (typeof userConfig.expireCutoffHours === 'number' && userConfig.expireCutoffHours >= 0)
    ? userConfig.expireCutoffHours
    : 24;
  // 看板日期时区：留空跟随系统，可填 IANA 名称（如 Asia/Shanghai）；非法值告警后回退本地时区
  let displayTimeZone = normalizeTimeZone(userConfig.timezone);
  if (displayTimeZone === null) {
    if (logger) logger.warn(`⚠️ timezone「${userConfig.timezone}」不是合法 IANA 时区，已回退为系统本地时区`);
    displayTimeZone = '';
  }
  // 用户显式强制刷新（非后台 Revalidate）时绕过单订阅退避，便于主动探测订阅是否恢复；
  // 后台定时刷新/预热仍遵守退避，避免死订阅反复拖慢整轮构建。
  const bypassSubBackoff = !!options.forceRefresh && !options.isRevalidating;
  const securityLimits = (userConfig.security && typeof userConfig.security === 'object') ? userConfig.security : {};
  const maxSubscriptionBytes = typeof securityLimits.maxSubscriptionBytes === 'number'
    ? securityLimits.maxSubscriptionBytes
    : DEFAULT_REQUEST_LIMITS.maxSubscriptionBytes;

  let sourceSkeleton = { proxies: [] };
  /** 订阅携带的节点专属 DNS 资产闭包累积容器（显式值通道，最终由 strategy 层消费） */
  const dnsAssets = {
    hosts: {}, policies: {}, fakeIpFilters: [], proxyResolvers: [],
    resolverCandidates: [], resolverPolicies: {}, hasResolverCandidates: false
  };
  let hasFailedSub = false;
  let hasTerminalFailure = false;
  const collectedSubInfos = [];
  /** 每个已评估订阅的可用性快照：ok | stale | failed | terminal | disabled */
  let subStatuses = [];
  /** 产出可用内容的订阅数（ok + stale）；为 0 时上层不得写入 Profile 缓存 */
  let usableSubCount = 0;
  /** 单订阅节点数统计，用于资源配额校验 (perSubscriptionMaxNodes) */
  const perSubCounts = {};

  // 前置自检本地代理端口与 TUN 虚拟网卡状态
  const proxyPort = userConfig.fetchProxyPort;
  const proxyStrategy = userConfig.fetchProxyStrategy || 'direct';
  const tunInterface = detectTunInterface();

  if (tunInterface && logger && (options.debug || userConfig.logLevel === 'debug')) {
    logger.debug(`🌐 系统网络：检测到活跃的 TUN 虚拟网卡（${tunInterface}），流量将自动由内核接管`);
  }

  let isProxyAvailable = true;
  const enabledSubs = Array.isArray(subscriptions) ? subscriptions.filter(isSubEnabled) : [];
  const needsProxyCheck = Boolean(proxyPort && enabledSubs.some(s => {
    const isRemoteUrl = s.url && /^https?:\/\//i.test(s.url);
    if (!isRemoteUrl) return false;
    if (s.proxy === true) return true;
    if (s.proxy === false) return false;
    return proxyStrategy !== 'direct';
  }));

  if (needsProxyCheck) {
    const isReachable = await checkPortReachable(proxyPort);
    if (isReachable) {
      isProxyAvailable = true;
      if (logger) logger.debug(`🔌 拉取代理：127.0.0.1:${proxyPort}（已就绪 · 策略 ${proxyStrategy}）`);
    } else {
      isProxyAvailable = false;
      if (tunInterface) {
        if (logger) logger.warn(`🌐 本地代理端口 127.0.0.1:${proxyPort} 未监听，已切换为系统 TUN 虚拟网卡（${tunInterface}）接管`);
      } else {
        if (logger) logger.warn(`⚠️ 本地拉取代理 127.0.0.1:${proxyPort} 连通失败（服务未启动或端口填写有误），已降级为直连`);
      }
    }
  }

  const effectiveProxyUrl = isProxyAvailable ? resolveProxyUrl(userConfig) : '';
  const effectiveStrategy = isProxyAvailable ? userConfig.fetchProxyStrategy : 'direct';

  function recordSubInfo(subInfo, subTag) {
    if (!subInfo) return;
    const { upload, download, total, expire } = parseSubscriptionInfo(subInfo);
    collectedSubInfos.push({
      tag: subTag,
      upload,
      download,
      total,
      expire,
      expired: isExpiredNow(expire, expireCutoffHours)
    });
  }

  // 1. 多订阅并发拉取分支
  if (subscriptions && Array.isArray(subscriptions) && subscriptions.length > 0) {
    const fetchTasks = subscriptions.map(async (sub) => {
      if (!isSubEnabled(sub)) {
        return { sub, rawResult: null, error: null, disabled: true, terminal: false };
      }
      const isDirectNode = isDirectNodeSub(sub);
      if (!sub.url && !sub.uri && !isDirectNode) return { sub, rawResult: null, error: null, skipped: true, terminal: false };
      let isTerminal = false;
      let terminalKind = '';
      let terminalReason = '';
      let terminalSubInfo = null;
      try {
        let rawResult;
        if (isDirectNode) {
          rawResult = { directProxies: [buildDirectProxy(sub)], subInfo: null, origin: 'direct' };
        } else if (sub.uri) {
          rawResult = { content: sub.uri, subInfo: null, origin: 'uri' };
        } else {
          const subKey = sub.url;
          const initialStale = (typeof subStaleCache.getSnapshot === 'function')
            ? subStaleCache.getSnapshot(subKey)
            : subStaleCache.get(subKey);
          const localSubPath = path.resolve(process.cwd(), sub.url);
          if (!/^https?:\/\//i.test(sub.url) && fs.existsSync(localSubPath) && fs.statSync(localSubPath).isFile()) {
            logger.debug(`📄 读取本地订阅文件：${sub.url}`);
            rawResult = { content: fs.readFileSync(localSubPath, 'utf-8'), subInfo: null, origin: 'file' };
          } else if (!bypassSubBackoff && isSubInFetchBackoff(subKey)) {
            // 退避期内不再发起网络请求：有可用旧缓存直接复用，否则快速失败
            const backoff = resolveBackoffStale(subKey, initialStale, staleMaxAgeMs, expireCutoffHours, displayTimeZone);
            if (backoff && backoff.usable) {
              logger.warn(`⏳ ${sub.tag ? `[${sub.tag}] ` : ''}退避中跳过回源，复用缓存兜底：${redactUrl(sub.url, showFullUrl)}`);
              rawResult = { content: backoff.stale.content, subInfo: backoff.stale.subInfo, stale: true, lastSuccessAt: backoff.stale.timestamp, origin: 'backoff-reuse' };
            } else {
              if (backoff && (backoff.expired || backoff.state.terminal)) {
                isTerminal = true;
                if (backoff.staleExpiry) {
                  terminalKind = backoff.staleExpiry.kind;
                  terminalReason = backoff.staleExpiry.reason;
                  terminalSubInfo = backoff.stale ? backoff.stale.subInfo : null;
                }
              }
              const nextRetryAt = backoff ? backoff.state.nextRetryAt : Date.now() + 30000;
              const retryInSec = Math.max(1, Math.ceil((nextRetryAt - Date.now()) / 1000));
              const skipErr = new Error(`Subscription fetch skipped (failure backoff, retry in ${retryInSec}s)`);
              skipErr.isBackoff = true;
              skipErr.retryable = false;
              throw skipErr;
            }
          } else {
            // L1 原始订阅快照命中：新鲜期内直接复用，跳过网络请求。
            // 该层与订阅 URL 绑定、不含 subDomain，因此预热（fetchOnly）写入的内容
            // 可被任意 Host 的首次请求直接复用，无需再向订阅上游回源。
            // 强制刷新（?refresh=1 / 预热 / 定时轮询 / SWR revalidate）一律绕过 L1，
            // 保证「主动与后台更新」总是真实回源，只有用户请求的缓存 Miss 才复用快照。
            const freshSnapshot = (!options.noCache && !options.forceRefresh)
              ? subStaleCache.getFresh(subKey, subFreshTtlMs)
              : null;
            if (freshSnapshot) {
              logger.debug(`⚡ 复用快照：${redactUrl(sub.url, showFullUrl)}`);
              rawResult = { content: freshSnapshot.content, subInfo: freshSnapshot.subInfo, cached: true, lastSuccessAt: freshSnapshot.timestamp, origin: 'snapshot' };
            } else {
              try {
                rawResult = await fetchNodes(sub.url, {
                  showFullUrl, debug, logger,
                  tag: sub.tag || '',
                  proxyUrl: effectiveProxyUrl,
                  strategy: effectiveStrategy,
                  perSubProxy: isProxyAvailable ? sub.proxy : false,
                  retry: typeof sub.retry === 'number' ? sub.retry : fetchRetry,
                  timeoutMs: fetchTimeoutSec * 1000,
                  maxBytes: maxSubscriptionBytes
                });

                // 校验成功响应（到期 / 流量耗尽 / 空节点 / 纯占位节点 → 抛错）
                validateFetchedSubscription(rawResult, expireCutoffHours);
                rawResult.origin = 'fetch';
                clearSubFetchFailure(subKey);
              } catch (e) {
                const decision = evaluateStaleFallback(e, { subKey, initialStale, staleMaxAgeMs, cutoffHours: expireCutoffHours, timeZone: displayTimeZone });

                // 只要确认终态失效，无论旧缓存是否存在均必须上报终态信号
                if (decision.isTerminal) {
                  isTerminal = true;
                  terminalKind = decision.terminalKind;
                  terminalReason = decision.terminalReason;
                  // 旧缓存命中终态时错误对象无 subInfo，须从决策快照取，用于渲染 🛑 看板
                  terminalSubInfo = e?.subInfo || decision.stale?.subInfo || null;
                }
                // 失败退避：记录失败次数与终态语义，供后续构建在退避期内快速跳过网络
                if (!e.isBackoff) recordSubFetchFailure(subKey, e, isTerminal);

                if (decision.allowFallback) {
                  logger.warn(`⚠️ ${sub.tag ? `[${sub.tag}] ` : ''}回源失败，已启用缓存兜底：${e.message}`);
                  rawResult = { content: decision.stale.content, subInfo: decision.stale.subInfo, stale: true, lastSuccessAt: decision.stale.timestamp, origin: 'fallback-stale' };
                } else {
                  if (decision.fallbackRejectReason && logger && (options.debug || userConfig.logLevel === 'debug')) {
                    logger.debug(`🛡️ 兜底被拒绝 [${redactUrl(sub.url, showFullUrl)}]：${decision.fallbackRejectReason}`);
                  }
                  throw e;
                }
              }
              // 仅真实拉取成功才刷新 L1 时间戳；命中快照（cached）不得回写，否则新鲜期会被无限续期
              if (rawResult && !rawResult.stale && !rawResult.cached) {
                subStaleCache.set(subKey, { content: rawResult.content, subInfo: rawResult.subInfo, timestamp: Date.now() });
                pruneSubStaleCache(staleMaxAgeMs);
              }
            }
          }
        }
        return { sub, rawResult, error: null, terminal: isTerminal, terminalKind, terminalReason, terminalSubInfo };
      } catch (e) {
        return { sub, rawResult: null, error: e, terminal: isTerminal, terminalKind, terminalReason, terminalSubInfo };
      }
    });

    const fetchedResults = await Promise.all(fetchTasks);
    const subSummaries = [];

    for (const { sub, rawResult, error, disabled, skipped, terminal, terminalKind, terminalReason, terminalSubInfo } of fetchedResults) {
      const isDirect = isDirectNodeSub(sub) || Boolean(sub?.uri);
      const subType = resolveSubType(sub);
      if (disabled) {
        const tag = sub.tag || (sub.url ? redactUrl(sub.url, showFullUrl) : (sub.name || '自建'));
        subSummaries.push({ disabled: true, tag, type: subType });
        subStatuses.push({ tag, status: 'disabled', nodeCount: 0 });
        continue;
      }
      if (skipped) continue;
      if (!rawResult && !error) continue;
      try {
        if (error) throw error;
        recordSubInfo(rawResult.subInfo, sub.tag);
        let subConfig = { proxies: [] };
        let subProxies = [];
        if (rawResult.directProxies) {
          subProxies = sanitizeExternalProxies(rawResult.directProxies);
          subConfig = { proxies: subProxies };
        } else {
          subConfig = parseContent(rawResult.content);
          subProxies = sanitizeExternalProxies(subConfig.proxies || []);
        }

        if (sub.name && subProxies.length === 1) {
          subProxies[0].name = sub.name;
        }

        // 覆盖/指定单节点类型 (如配置了 type: 'http')
        if (sub.type && subProxies.length === 1) {
          subProxies[0].type = String(sub.type).toLowerCase();
        }

        // 注入链式代理 (dialerProxy / dialer-proxy)
        const dialerProxyTarget = resolveDialerProxy(sub);
        if (dialerProxyTarget) {
          subProxies.forEach(p => {
            p['dialer-proxy'] = dialerProxyTarget;
          });
        }

        if (isDirect) {
          const nameHint = subProxies[0] ? subProxies[0].name : '未知';
          logger.debug(`📌 摄入单节点：${nameHint}${sub.tag ? ` [${sub.tag}]` : ''}`);
        }

        // 记录内部属性到元数据存储（不污染 proxy 节点对象）
        const shouldKeepName = resolveShouldKeepName(sub);
        const effectiveGroupTags = (Array.isArray(sub.groups) && sub.groups.length > 0) ? [...sub.groups] : [];

        let effectiveTag = sub.tag;
        const effectiveIndexPrefix = sub.indexPrefix;
        if (!effectiveTag) {
          const reg = /^\[([^\]]{1,12})\]/i;
          const tagCounts = {};
          for (const p of subProxies) {
            if (p.name) {
              const m = p.name.match(reg);
              if (m) {
                const tag = m[1].trim();
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
              }
            }
          }
          let bestTag = '';
          let maxCount = 0;
          for (const [t, c] of Object.entries(tagCounts)) {
            if (c > maxCount) { maxCount = c; bestTag = t; }
          }
          effectiveTag = bestTag;
          if (!effectiveTag && sub.url && sub.url.startsWith('http')) {
            try { effectiveTag = new URL(sub.url).hostname; } catch {}
          }
          if (!effectiveTag) effectiveTag = '订阅';
        }

        const resetText = extractResetText(sub, subProxies);
        const rawCount = subProxies.length;
        if (userConfig.removeInfoNodes !== false) {
          subProxies = filterRawInfoNodes(subProxies, logger);
        }
        const filteredCount = rawCount - subProxies.length;

        // Record only metadata assigned by this trusted subscription processor into WeakMap.
        // Node objects remain 100% pure Mihomo schema without property pollution.
        subProxies.forEach(p => markTrustedProxyMetadata(p, {
          subTag: sub.tag || effectiveTag,
          indexPrefix: effectiveIndexPrefix || '',
          keepName: shouldKeepName,
          groupTags: effectiveGroupTags,
          rawName: p.name || ''
        }));

        const { nodes: synthNodes, expireDays } = enableDashboard
          ? generateInfoNodes(rawResult.subInfo, effectiveTag, { isStale: !!rawResult.stale, cutoffHours: expireCutoffHours, timeZone: displayTimeZone })
          : { nodes: [], expireDays: -1 };

        if (enableDashboard && resetText && (expireDays === -1 || expireDays > 30)) {
          synthNodes.push(markTrustedSynthetic({
            name: `🔄 [${effectiveTag}] ${resetText}`,
            type: 'direct',
            server: '1.0.0.1',
            port: 80,
            isSyntheticInfo: true
          }));
        }

        if (synthNodes.length > 0) {
          synthNodes.forEach(n => logger.debug(`📊 [合成看板] 「${n.name}」`));
          subProxies.unshift(...synthNodes);
        }

        // 统一安全网关：控制面净化审计 + 节点专属资产闭包提取（详见 applySubscriptionGuards）
        const { strippedCount, assets } = applySubscriptionGuards(subConfig, {
          proxies: subProxies,
          subUrl: sub.url,
          identityUrl: sub.url || sub.uri || '',
          tag: sub.tag || effectiveTag,
          assetClosureMode: userConfig.assetClosure,
          assetDomainAllowlist: userConfig.assetDomainAllowlist,
          protectedDomains: userConfig.protectedDomains,
          outputMode,
          logger
        });
        mergeDnsAssets(dnsAssets, assets);

        sourceSkeleton.proxies = sourceSkeleton.proxies.concat(subProxies);

        const nodeCount = subProxies.length;
        perSubCounts[isDirect ? `direct:${sub.tag || effectiveTag}` : String(sub.url)] = nodeCount;
        // 单一时钟：输入的有效期 = 最后一次成功拉取时刻 + fetchStaleTtl
        // 对 sticky 的 stale 数据，lastSuccessAt 保持为真实成功时刻，不随复用而刷新
        const lastSuccessAt = Number.isFinite(rawResult.lastSuccessAt) ? rawResult.lastSuccessAt : Date.now();
        subStatuses.push({
          tag: sub.tag || effectiveTag,
          status: rawResult.stale ? 'stale' : 'ok',
          nodeCount,
          lastSuccessAt,
          validUntil: lastSuccessAt + staleMaxAgeMs
        });
        subSummaries.push({
          type: subType,
          nameHint: isDirect ? (subProxies[0] ? subProxies[0].name : '未知') : '',
          tag: sub.tag || effectiveTag,
          total: nodeCount,
          filtered: filteredCount,
          synth: synthNodes.length,
          stripped: strippedCount,
          // 本次数据的真实来源（回源 / 复用快照 / 缓存兜底 / 退避跳过 / 本地文件 / URI / 直连节点）
          origin: rawResult.origin || (rawResult.stale ? 'fallback-stale' : rawResult.cached ? 'snapshot' : 'fetch'),
          // 命中 L1 原始快照表示本次未回源，汇总树需如实标注，避免被误读为重新回源
          cached: !!rawResult.cached,
          // 使用缓存兜底说明本轮数据来自上次成功快照，与正常回源区分开
          stale: !!rawResult.stale
        });
      } catch (e) {
        const subId = isDirect ? (sub.name || sub.tag || 'direct-node') : redactUrl(sub.url, showFullUrl);
        const expiryTerminal = EXPIRY_TERMINAL_KINDS.includes(terminalKind);
        // BackoffSkipped 是主动跳过请求，不是 FetchFailed；两者日志必须区分。
        const isBackoffSkip = e?.isBackoff === true;
        const backoffState = sub.url && /^https?:\/\//i.test(sub.url) ? getSubFetchBackoff(sub.url) : null;
        const retryInSec = backoffState ? Math.max(1, Math.ceil((backoffState.nextRetryAt - Date.now()) / 1000)) : 0;
        const backoffFailures = backoffState ? backoffState.failures : 0;
        const backoffTotalSec = backoffState && Number.isFinite(backoffState.delayMs) ? Math.round(backoffState.delayMs / 1000) : 0;
        // 逐源明细仅在 debug 输出；info 级由下方「订阅源解析完成」汇总树保留每源一行
        logger.debug(expiryTerminal
          ? `🛑 [${subId}] ${terminalReason}`
          : isBackoffSkip
            ? `⏳ [${subId}] 退避中跳过回源（${backoffState ? `第 ${backoffFailures} 次失败 · 退避 ${formatDuration(backoffState.delayMs)} · 剩余 ${formatDuration(backoffState.nextRetryAt - Date.now())}` : `${retryInSec}s 后重试`}）`
            : `❌ [${subId}] 拉取失败：${terminalReason || e.message}`);

        let effectiveTag = sub.tag;
        if (!effectiveTag && sub.url && sub.url.startsWith('http')) {
          try { effectiveTag = new URL(sub.url).hostname; } catch {}
        }
        if (!effectiveTag) effectiveTag = '订阅';

        if (enableDashboard) {
          // 到期/提前停用（含旧缓存命中）渲染为 🛑 套餐看板，而非误导性的「拉取失败」❌
          sourceSkeleton.proxies.push(...buildTerminalNodes({
            terminalKind,
            terminalReason,
            subInfo: terminalSubInfo,
            tag: effectiveTag,
            errorMessage: e.message,
            cutoffHours: expireCutoffHours,
            timeZone: displayTimeZone
          }));
        }

        let shortMsg = terminalReason || e.message || '拉取失败';
        if (/fetch failed/i.test(shortMsg)) shortMsg = '网络连接失败';
        else if (/timeout/i.test(shortMsg)) shortMsg = '拉取超时';
        else if (/HTTP Error: (\d+)/i.test(shortMsg)) shortMsg = `HTTP ${shortMsg.match(/HTTP Error: (\d+)/i)[1]}`;
        else if (/no nodes/i.test(shortMsg)) shortMsg = '未解析到有效节点';
        else if (/expired/i.test(shortMsg)) shortMsg = '订阅已失效';
        else if (/quota exhausted/i.test(shortMsg)) shortMsg = '流量已耗尽';
        else if (/SSRF 预检失败/i.test(shortMsg)) shortMsg = /解析失败|DNS/i.test(shortMsg) ? 'DNS 解析失败' : 'SSRF 策略拦截';
        else if (/failure backoff/i.test(shortMsg)) shortMsg = '拉取退避中';

        if (e?.subInfo) {
          recordSubInfo(e.subInfo, sub.tag);
        }

        subStatuses.push({
          tag: effectiveTag,
          status: terminal ? 'terminal' : 'failed',
          nodeCount: 0
        });

        subSummaries.push({
          type: subType,
          nameHint: '',
          tag: effectiveTag,
          total: 0,
          failed: true,
          // 主动跳过请求（BackoffSkipped）与真实请求失败（FetchFailed）在日志上分开呈现；
          // 两者在业务健康度上仍统一计入 failed，不改变 subStatuses 语义。
          skipped: isBackoffSkip && !terminal,
          origin: terminal ? 'terminal' : (isBackoffSkip ? 'backoff-skip' : 'fetch-failed'),
          terminalKind,
          failReason: shortMsg,
          retryInSec,
          backoffFailures,
          backoffTotalSec
        });
      }
    }

    // 根据逐订阅状态推导整体健康度：
    // - hasFailedSub: 任一订阅非 ok（stale 也算降级失败，但仍有可用内容）
    // - hasTerminalFailure: 可用订阅为 0，且所有已评估订阅均为终态失效
    usableSubCount = subStatuses.filter(s => s.status === 'ok' || s.status === 'stale').length;
    const evaluatedStatuses = subStatuses.filter(s => s.status !== 'disabled');
    const terminalCount = evaluatedStatuses.filter(s => s.status === 'terminal').length;
    hasFailedSub = subStatuses.some(s => s.status === 'stale' || s.status === 'failed' || s.status === 'terminal');
    hasTerminalFailure = usableSubCount === 0 && terminalCount > 0 && terminalCount === evaluatedStatuses.length;

    // 仅当「全部源都命中 L1 快照」时才把来源汇总降级为 debug：
    // 命中快照未回源，再打一份来源清单会让每个新 Host 的首次组装都刷一遍噪声。
    // 本地文件 / URI / direct 节点、以及缓存兜底与失败源都不属于快照复用，仍应保留汇总。
    const allSnapshotReuse = subSummaries.length > 0 && subSummaries.every(s => s.cached);
    if (subSummaries.length > 0 && logger && !allSnapshotReuse) {
      // 标题只陈述「解析完成」这一既定结果：命中 L1 快照的源并未回源，
      // 用「拉取与解析完成」会让读者误以为整轮又重新回源了一遍。
      const lines = [`📡 订阅源解析完成（${subSummaries.length} 个源）：`];
      subSummaries.forEach((s, idx) => {
        const isLast = idx === subSummaries.length - 1;
        const branch = isLast ? '└──' : '├──';
        if (s.disabled) {
          lines.push(`${branch} ⏸️ ${s.tag ? `[${s.tag}] ` : ''}：订阅已禁用（跳过回源）`);
        } else if (s.failed) {
          const expiryLabel = { expired: '已失效', 'stale-expired': '已失效', cutoff: '已停用', 'stale-cutoff': '已停用' }[s.terminalKind];
          if (expiryLabel) {
            lines.push(`${branch} 🛑 [${s.tag}]：${expiryLabel}`);
          } else if (s.skipped) {
            lines.push(`${branch} ⏳ [${s.tag}]：退避中跳过回源（无可用缓存${s.backoffFailures ? ` · 第 ${s.backoffFailures} 次失败` : ''}${s.backoffTotalSec ? ` · 退避 ${formatDuration(s.backoffTotalSec * 1000)}` : ''}${s.retryInSec > 0 ? ` · 剩余 ${formatDuration(s.retryInSec * 1000)}` : ''}）`);
          } else {
            lines.push(`${branch} ❌ [${s.tag}]：拉取失败（${s.failReason}）${s.backoffFailures ? ` · 第 ${s.backoffFailures} 次失败` : ''}${s.backoffTotalSec ? ` · 退避 ${formatDuration(s.backoffTotalSec * 1000)}` : ''}${s.retryInSec > 0 ? ` · 剩余 ${formatDuration(s.retryInSec * 1000)}` : ''}`);
          }
        } else {
          const origin = describeOrigin(s.origin);
          const details = [`来源：${origin.label}`];
          if (s.filtered > 0) details.push(`过滤 ${s.filtered} 说明节点`);
          if (s.synth > 0) details.push(`合成 ${s.synth} 看板`);
          if (s.stripped > 0) details.push(`🛡️ 剥离 ${s.stripped} 越权`);
          const detailStr = `（${details.join(' · ')}）`;
          const singleNode = s.type === 'uri' || s.origin === 'direct';
          const namePart = singleNode ? `${s.nameHint}${s.tag ? ` [${s.tag}]` : ''}` : `[${s.tag}]`;
          lines.push(`${branch} ${origin.icon} ${namePart}：${s.total} 个节点${detailStr}`);
        }
      });
      logger.info(lines.join('\n'));
    } else if (subSummaries.length > 0 && logger) {
      // 全部源复用快照：info 级保持安静，但 debug 仍需逐订阅标明本次数据来源。
      if (typeof logger.debug === 'function') {
        const lines = [`📡 全部订阅源复用快照，未发起回源（${subSummaries.length} 个源）：`];
        subSummaries.forEach((s, idx) => {
          const branch = idx === subSummaries.length - 1 ? '└──' : '├──';
          lines.push(`${branch} ⚡ [${s.tag}]：${s.total} 个节点（来源：复用快照）`);
        });
        logger.debug(lines.join('\n'));
      }
    }

    // 仅在多订阅 (>=2 个有流量的有效源) 且启用看板时，在最顶部注入一组「全局总额」配对节点（流量 + 到期）
    const activeSubsWithTraffic = collectedSubInfos.filter(s => !s.expired && s.total > 0);
    if (enableDashboard && activeSubsWithTraffic.length > 1) {
      // 此处仅取聚合数值用于注入全局看板；「过期订阅跳过流量聚合」告警统一由最终配置组装输出一次
      const agg = typeof dsh.aggregateSubscriptions === 'function'
        ? dsh.aggregateSubscriptions(collectedSubInfos, { expireAggregation: userConfig.expireAggregation, logger, warnExpiredSubs: false })
        : null;
      if (agg && agg.globalTotal > 0 && typeof dsh.buildGlobalDashboardNodes === 'function') {
        const topNodes = dsh.buildGlobalDashboardNodes({
          globalUpload: agg.globalUpload,
          globalDownload: agg.globalDownload,
          globalTotal: agg.globalTotal,
          globalExpire: agg.globalExpire,
          expireAggregation: userConfig.expireAggregation,
          cutoffHours: expireCutoffHours,
          timeZone: displayTimeZone
        });
        if (topNodes && topNodes.length > 0) {
          topNodes.forEach(n => logger.debug(`📊 [全局看板] 「${n.name}」`));
          sourceSkeleton.proxies.unshift(...topNodes);
        }
      }
    }
  } else if (url) {
    // 2. 单 URL / URI / 本地文件路径 分支
    let rawResult;
    let isTerminal = false;
    let terminalKind = '';
    let terminalReason = '';
    let terminalSubInfo = null;
    let fallbackRejectReason = '';
    let fetchError = null;
    let subStatus = 'ok';
    // 本轮数据来源（仅用于日志，不参与业务判定）
    let singleOrigin = 'fetch';
    const localFilePath = path.resolve(process.cwd(), url);
    if (!/^https?:\/\//i.test(url) && !/^(vless|vmess|trojan|ss):\/\//i.test(url)) {
      if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
        logger.info(`📄 读取本地配置/节点文件：${url}`);
        rawResult = { content: fs.readFileSync(localFilePath, 'utf-8'), subInfo: null };
        singleOrigin = 'file';
      } else {
        throw new Error(`Subscription file not found or invalid URL: ${url}`);
      }
    } else if (/^(vless|vmess|trojan|ss):\/\//i.test(url)) {
      logger.debug(`📌 解析 URI 节点：${url.split('#').pop() || '未知'}`);
      rawResult = { content: url, subInfo: null };
      singleOrigin = 'uri';
    } else {
      const subKey = url;
      const initialStale = (typeof subStaleCache.getSnapshot === 'function')
        ? subStaleCache.getSnapshot(subKey)
        : subStaleCache.get(subKey);

      if (!bypassSubBackoff && isSubInFetchBackoff(subKey)) {
        // 退避期内不再发起网络请求：有可用旧缓存直接复用，否则快速失败
        const backoff = resolveBackoffStale(subKey, initialStale, staleMaxAgeMs, expireCutoffHours, displayTimeZone);
        if (backoff && backoff.usable) {
          logger.warn(`⏳ 退避中跳过回源，复用缓存兜底：${redactUrl(url, showFullUrl)}`);
          rawResult = { content: backoff.stale.content, subInfo: backoff.stale.subInfo, stale: true, lastSuccessAt: backoff.stale.timestamp };
          singleOrigin = 'backoff-reuse';
          subStatus = 'stale';
        } else {
          if (backoff && (backoff.expired || backoff.state.terminal)) {
            isTerminal = true;
            subStatus = 'terminal';
            fallbackRejectReason = '旧缓存已失效（不可复用）';
          }
          const nextRetryAt = backoff ? backoff.state.nextRetryAt : Date.now() + 30000;
          const retryInSec = Math.max(1, Math.ceil((nextRetryAt - Date.now()) / 1000));
          const backoffFailures = backoff ? backoff.state.failures : 1;
          const backoffTotalSec = backoff && Number.isFinite(backoff.state.delayMs) ? Math.round(backoff.state.delayMs / 1000) : 30;
          // 主动跳过请求，并非真实回源失败；在抛错前显式记录本次行为。
          logger.warn(`⏳ ${isTerminal ? '订阅已终态失效，' : ''}退避中跳过回源（无可用缓存 · 第 ${backoffFailures} 次失败 · 退避 ${formatDuration(backoffTotalSec * 1000)} · 剩余 ${formatDuration(retryInSec * 1000)}）：${redactUrl(url, showFullUrl)}`);
          const skipErr = new Error(`Subscription fetch skipped (failure backoff, retry in ${retryInSec}s)`);
          skipErr.isBackoff = true;
          skipErr.retryable = false;
          throw skipErr;
        }
      } else {
        // L1 原始订阅快照命中：新鲜期内直接复用，跳过网络请求（与多订阅路径同语义）
        const freshSnapshot = (!options.noCache && !options.forceRefresh)
          ? subStaleCache.getFresh(subKey, subFreshTtlMs)
          : null;
        if (freshSnapshot) {
          logger.debug(`⚡ 复用快照：${redactUrl(url, showFullUrl)}`);
          rawResult = { content: freshSnapshot.content, subInfo: freshSnapshot.subInfo, cached: true, lastSuccessAt: freshSnapshot.timestamp };
          singleOrigin = 'snapshot';
        } else {
          try {
            rawResult = await fetchNodes(url, {
              showFullUrl, debug, logger,
              tag: /^https?:\/\//i.test(url) ? redactUrl(url, showFullUrl) : '',
              proxyUrl: effectiveProxyUrl,
              strategy: effectiveStrategy,
              retry: fetchRetry,
              timeoutMs: fetchTimeoutSec * 1000,
              maxBytes: maxSubscriptionBytes
            });

            // 校验成功响应（到期 / 流量耗尽 / 空节点 / 纯占位节点 → 抛错）
            validateFetchedSubscription(rawResult, expireCutoffHours);
            singleOrigin = 'fetch';
            clearSubFetchFailure(subKey);
          } catch (e) {
            fetchError = e;
            const decision = evaluateStaleFallback(e, { subKey, initialStale, staleMaxAgeMs, cutoffHours: expireCutoffHours, timeZone: displayTimeZone });
            isTerminal = decision.isTerminal;
            terminalKind = decision.terminalKind;
            terminalReason = decision.terminalReason;
            terminalSubInfo = e?.subInfo || decision.stale?.subInfo || null;
            fallbackRejectReason = decision.fallbackRejectReason;

            // 失败退避：记录失败次数与终态语义，供后续构建在退避期内快速跳过网络
            if (!e.isBackoff) recordSubFetchFailure(subKey, e, isTerminal);

            if (decision.allowFallback) {
              logger.warn(`⚠️ 回源失败，已启用缓存兜底：${e.message}`);
              rawResult = { content: decision.stale.content, subInfo: decision.stale.subInfo, stale: true, lastSuccessAt: decision.stale.timestamp };
              singleOrigin = 'fallback-stale';
              subStatus = 'stale';
            } else {
              if (e?.subInfo) {
                recordSubInfo(e.subInfo, '');
              }
              if (fallbackRejectReason && logger && (options.debug || userConfig.logLevel === 'debug')) {
                logger.debug(`🛡️ 兜底被拒绝 [${redactUrl(url, showFullUrl)}]：${fallbackRejectReason}`);
              }
              // 单 URL 模式下若因终态失效拒绝，构造空骨架以交付并保留元数据，与多订阅模式保持一致
              if (isTerminal) {
                subStatus = 'terminal';
                // 旧缓存命中终态时无 e.subInfo，须带上决策快照，供看板渲染 🛑
                rawResult = { content: '', subInfo: terminalSubInfo };
              } else {
                subStatus = 'failed';
                throw e;
              }
            }
          }

          // 仅真实拉取成功才刷新 L1 时间戳；命中快照（cached）不得回写，否则新鲜期会被无限续期
          if (rawResult && !rawResult.stale && !isTerminal && !rawResult.cached) {
            subStaleCache.set(subKey, { content: rawResult.content, subInfo: rawResult.subInfo, timestamp: Date.now() });
            pruneSubStaleCache(staleMaxAgeMs);
          }
        }
      }
    }
    if (rawResult && !isTerminal) {
      recordSubInfo(rawResult.subInfo, '');
    }

    // 关键：单 URL/本地文件同样属于「外部不可信输入」，输出骨架必须重建为纯数据面对象，
    // 严禁直接复用订阅顶层配置（否则 external-controller / script / tunnels 等会随产物下发）。
    const rawSubConfig = parseContent(rawResult.content);
    let singleProxies = sanitizeExternalProxies(Array.isArray(rawSubConfig.proxies) ? rawSubConfig.proxies : []);
    if (userConfig.removeInfoNodes !== false) {
      singleProxies = filterRawInfoNodes(singleProxies, logger);
    }
    sourceSkeleton = { proxies: singleProxies };

    // 与多订阅路径共用同一套控制面净化审计 + 节点专属资产闭包（保持两条路径行为一致）
    const { assets } = applySubscriptionGuards(rawSubConfig, {
      proxies: singleProxies,
      subUrl: /^https?:\/\//i.test(url) ? url : '',
      identityUrl: String(url),
      tag: /^https?:\/\//i.test(url) ? redactUrl(url, showFullUrl) : String(url),
      assetClosureMode: userConfig.assetClosure,
      assetDomainAllowlist: userConfig.assetDomainAllowlist,
      protectedDomains: userConfig.protectedDomains,
      outputMode,
      logger
    });
    mergeDnsAssets(dnsAssets, assets);
    perSubCounts[String(url)] = singleProxies.length;

    let singleTag = '订阅';
    if (/^https?:\/\//i.test(url)) {
      try { singleTag = new URL(url).hostname; } catch {}
    }
    subStatuses = [{ tag: singleTag, status: subStatus, nodeCount: singleProxies.length }];
    usableSubCount = (subStatus === 'ok' || subStatus === 'stale') ? 1 : 0;
    hasFailedSub = subStatus !== 'ok';
    hasTerminalFailure = subStatus === 'terminal';

    const nodeCount = sourceSkeleton.proxies.length;
    // 单 URL 路径与多订阅路径使用同一句标题，保证同一阶段在不同入口下措辞一致
    const singleSource = isTerminal ? describeOrigin('terminal') : describeOrigin(singleOrigin);
    logger.info(`📡 订阅源解析完成：${nodeCount} 个节点（来源：${singleSource.label}）`);
    if (enableDashboard) {
      const effectiveTag = (url && url.startsWith('http')) ? new URL(url).hostname : '订阅';
      const effectiveSubInfo = rawResult?.subInfo || (fetchError?.subInfo || null);
      const { nodes: synthNodes } = generateInfoNodes(effectiveSubInfo, '', { cutoffHours: expireCutoffHours, timeZone: displayTimeZone });
      if (isTerminal) {
        // 到期/停用（含旧缓存命中）渲染 🛑 套餐看板；其余终态（401/流量耗尽等）保留 ❌ 占位
        sourceSkeleton.proxies.push(...buildTerminalNodes({
          terminalKind,
          terminalReason,
          subInfo: effectiveSubInfo,
          tag: '',
          errorTag: effectiveTag,
          errorMessage: fallbackRejectReason || '订阅已失效',
          cutoffHours: expireCutoffHours,
          timeZone: displayTimeZone
        }));
      } else if (synthNodes.length > 0) {
        sourceSkeleton.proxies.unshift(...synthNodes);
      }
    }
  } else {
    throw new Error('No URL or subscriptions provided.');
  }

  // 2 列网格对齐：看板节点按「到期 + 流量」成对排列，状态类节点统一置底
  sourceSkeleton.proxies = sortDashboardNodes(sourceSkeleton.proxies);

  // 3. 节点域名解析器归属决议：先收集全部订阅候选，再做一次全局冲突决议，
  //    最后才生成映射。冲突域名整体退出映射（不 union、不按顺序择一），
  //    由 DNS 装配层回退默认解析链；nodes/report 产物不含 dns 段，无需输出冲突告警。
  if (dnsAssets.resolverCandidates.length > 0) {
    const { policies, conflicts } = resolveNodeDnsPolicies(
      dnsAssets.resolverCandidates,
      { fold: userConfig.dnsNodePolicyFold !== false }
    );
    dnsAssets.resolverPolicies = policies;
    dnsAssets.hasResolverCandidates = true;
    if (outputMode === 'config') logNodeDnsConflicts(conflicts, logger);
  }

  return {
    sourceSkeleton,
    dnsAssets,
    collectedSubInfos,
    hasFailedSub,
    hasTerminalFailure,
    perSubCounts,
    subStatuses,
    usableSubCount
  };
}

module.exports = {
  isSubEnabled,
  processSubscriptionSources,
  applySubscriptionGuards
};
