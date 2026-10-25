/**
 * -----------------------------------------------------------------------------
 * Pipeline Layer: 订阅摄入流水线与安全网关 (Subscription Ingestion Pipeline)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 并发调度多订阅 HTTP 抓取与直接 URI 识别
 * 2. 结合 Stale 缓存实施失败平滑容灾降级
 * 3. 提取订阅信息、识别机场标签、嗅探重置日
 * 4. 控制面净化审计与节点专属资产闭包提取 (applySubscriptionGuards)
 * 5. 树状输出解析统计日志
 */

const fs = require('fs');
const path = require('path');
const { parseContent, parseSubscriptionInfo, isExpiredNow, isQuotaExhausted } = require('../io/parsers');
const { hasOnlyPlaceholderNodes } = require('../core/notice');
const { markTrustedSynthetic, markTrustedProxyMetadata, sanitizeExternalProxies } = require('../core/node-trust');
const { redactUrl } = require('../io/ssrf');
const { fetchNodes, resolveProxyUrl, checkPortReachable, detectTunInterface, subStaleCache, pruneSubStaleCache, isSubInFetchBackoff, recordSubFetchFailure, clearSubFetchFailure, getSubFetchBackoff } = require('../io/fetcher');
const { DEFAULT_REQUEST_LIMITS } = require('../io/limits');
const { partitionControlPlane } = require('../core/security/control-plane');
const { sanitizeHosts, sanitizeNameserverPolicy } = require('../core/security/dns-sanitizer');
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

/**
 * 校验一次成功抓取的订阅响应：到期 / 流量耗尽 / 空节点 / 纯占位节点均视为异常并抛出带标记的错误。
 * 多订阅与单 URL 两条路径共用，保证「异常响应」判定完全一致。
 * @throws {Error} 带 isExpired / isQuotaExhausted / isPlaceholderOnly 标记
 */
function validateFetchedSubscription(rawResult) {
  if (rawResult.subInfo) {
    const info = parseSubscriptionInfo(rawResult.subInfo);
    // 1. 本次响应明确已到期：绝不作为健康订阅，拒绝写入缓存
    if (isExpiredNow(info.expire)) {
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
 * 抓取失败后的「终态失效判定 + 容灾降级决策」，多订阅与单 URL 两条路径共用。
 *
 * 终态失效（HTTP 401 / 本次到期 / 本次流量耗尽 / 旧缓存已过期）时安全淘汰旧缓存，
 * 并给出是否允许回退旧缓存及拒绝原因。安全淘汰严格要求命中请求发起时捕获的旧条目，
 * 防止误删并发新任务刚写入的健康条目。
 *
 * @returns {{ isTerminal: boolean, terminalReason: string, fallbackRejectReason: string, allowFallback: boolean, stale: object|null }}
 */
function evaluateStaleFallback(err, { subKey, initialStale, staleMaxAgeMs }) {
  const stale = subStaleCache.get(subKey);

  // ─── 阶段一：独立判定终态失效（不依赖旧缓存是否存在或是否超期） ───
  let isTerminal = false;
  let terminalReason = '';

  const httpStatus = err?.statusCode || err?.status;
  if (httpStatus === 401) {
    isTerminal = true;
    terminalReason = 'HTTP 401 凭据失效';
  } else if (err?.isExpired) {
    isTerminal = true;
    terminalReason = '本次响应确认已到期';
  } else if (err?.isQuotaExhausted) {
    isTerminal = true;
    terminalReason = '本次响应确认流量已耗尽';
  } else if (stale) {
    const staleParsedInfo = parseSubscriptionInfo(stale.subInfo);
    if (staleParsedInfo && isExpiredNow(staleParsedInfo.expire)) {
      isTerminal = true;
      terminalReason = `旧缓存已于 ${new Date(staleParsedInfo.expire * 1000).toISOString().split('T')[0]} 到期`;
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

  return { isTerminal, terminalReason, fallbackRejectReason, allowFallback, stale };
}

/**
 * 判定退避期内的订阅是否可直接复用旧缓存（不发起网络请求）。
 *
 * 旧缓存已过期时按终态处理并安全淘汰，避免退避期把死数据无限续命。
 *
 * @param {string} subKey
 * @param {object|null} initialStale 请求发起时捕获的旧条目快照
 * @param {number} staleMaxAgeMs
 * @returns {{ state: object, stale: object|null, usable: boolean, expired: boolean } | null}
 */
function resolveBackoffStale(subKey, initialStale, staleMaxAgeMs) {
  const state = getSubFetchBackoff(subKey);
  if (!state) return null;

  const stale = subStaleCache.get(subKey);
  const staleInfo = stale ? parseSubscriptionInfo(stale.subInfo) : null;
  const expired = !!(staleInfo && isExpiredNow(staleInfo.expire));

  if (expired) {
    if (typeof subStaleCache.deleteIfMatch === 'function') {
      subStaleCache.deleteIfMatch(subKey, initialStale);
    } else if (initialStale && subStaleCache.get(subKey) === initialStale) {
      subStaleCache.delete(subKey);
    }
  }

  const usable = !!stale && !expired && (Date.now() - stale.timestamp < staleMaxAgeMs);
  return { state, stale, usable, expired };
}

/** 格式化控制面沙箱告警，去除内部枚举 ID 并以分级树形分支展示 */
function formatControlPlaneWarning(report) {
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
  // 若剥离项极少（1~2 项）且无严重夺权风险，采用单行紧凑模式
  if (count <= 2 && critical.length === 0) {
    const keys = report.hostile.map(h => h.key).join(', ');
    return `🛡️ 控制面沙箱: 订阅 [${report.tag}] 已安全剥离 ${count} 项配置字段 (${keys})`;
  }

  // 存在夺权威胁或多项改写时，采用树形分支结构化展示
  const lines = [`🛡️ 控制面沙箱: 订阅 [${report.tag}] 触发越权防御，已物理剥离 ${count} 项控制字段:`];
  const branches = [];
  if (critical.length > 0) {
    branches.push(`🚨 夺权风险: ${critical.join(', ')}`);
  }
  if (config.length > 0) {
    branches.push(`⚙️ 配置改写: ${config.join(', ')}`);
  }
  if (unknown.length > 0) {
    branches.push(`❓ 未知字段: ${unknown.join(', ')}`);
  }

  branches.forEach((b, idx) => {
    const isLast = idx === branches.length - 1;
    lines.push(`${isLast ? '└──' : '├──'} ${b}`);
  });

  return lines.join('\n');
}

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
function applySubscriptionGuards(subConfig, options = {}) {
  const {
    proxies = [], subUrl = '', tag = '', logger,
    assetClosureMode = 'standard', assetDomainAllowlist = [], protectedDomains = [],
    outputMode = 'config'
  } = options;
  const result = {
    strippedCount: 0,
    hosts: [],
    policies: [],
    fakeIpFilters: [],
    assets: { hosts: {}, policies: {}, fakeIpFilters: [] }
  };

  if (!subConfig || typeof subConfig !== 'object') return result;

  // 1. 控制面净化审计（记录越权字段，供日志与审计统计使用）
  const { report } = partitionControlPlane(subConfig, { tag });
  result.strippedCount = (report.hostile && report.hostile.length) || 0;
  if (result.strippedCount > 0 && logger) {
    const warnMsg = formatControlPlaneWarning(report);
    if (warnMsg) logger.warn(warnMsg);
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

  // 6. 继承审计：让使用者看得见「订阅为我挂载了哪些 DNS 依赖」
  //    这些资产只在 config 模式由 src/strategy/dns.js 消费；nodes 产物结构上没有 dns 段，
  //    资产会随 Checkpoint 早退被静默丢弃 —— 对「节点域名只能靠订阅私货解析」的来源，
  //    产物里的节点将无法连接，故此处必须显式告警而非仅 info。
  if (logger && typeof logger.info === 'function') {
    const inherited = [
      ...result.hosts.map(h => `hosts:${h}`),
      ...result.policies.map(p => `dns-policy:${p}`),
      ...result.fakeIpFilters.map(f => `fake-ip-filter:${f}`)
    ];
    if (inherited.length > 0) {
      const preview = inherited.slice(0, 6).join(', ');
      const tail = inherited.length > 6 ? ', …' : '';
      if (outputMode === 'nodes' && typeof logger.warn === 'function') {
        logger.warn(
          `⚠️ 解析依赖: 订阅 [${tag}] 携带 ${inherited.length} 项节点专属 DNS 依赖 (${preview}${tail})，` +
          `但 nodes 产物不含 dns 段，这些依赖会被丢弃 —— 若相关节点域名需靠其解析，节点将无法连接`
        );
      } else {
        logger.info(
          `🛡️ 资产闭包: 订阅 [${tag}] 继承 ${inherited.length} 项节点专属 DNS 依赖 ` +
          `(${preview}${tail})`
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
  const createFetchErrorNode = dsh.createFetchErrorNode || ((tag, msg) => markTrustedSynthetic({ name: `❌ [${tag}] 拉取失败：${msg}`, type: 'direct', server: '1.0.0.1', port: 80, isSyntheticInfo: true }));
  const showFullUrl = userConfig.redactLevel === 'off';
  const debug = !!options.debug || userConfig.logLevel === 'debug';
  const enableDashboard = userConfig.enableDashboard !== false;
  const fetchRetry = typeof userConfig.fetchRetry === 'number' ? userConfig.fetchRetry : 2;
  const fetchTimeoutSec = typeof userConfig.fetchTimeout === 'number' ? userConfig.fetchTimeout : 15;
  const staleMaxAgeMs = (typeof userConfig.fetchStaleTtl === 'number' ? userConfig.fetchStaleTtl : 24) * 60 * 60 * 1000;
  // 用户显式强制刷新（非后台 Revalidate）时绕过单订阅退避，便于主动探测订阅是否恢复；
  // 后台定时刷新/预热仍遵守退避，避免死订阅反复拖慢整轮构建。
  const bypassSubBackoff = !!options.forceRefresh && !options.isRevalidating;
  const securityLimits = (userConfig.security && typeof userConfig.security === 'object') ? userConfig.security : {};
  const maxSubscriptionBytes = typeof securityLimits.maxSubscriptionBytes === 'number'
    ? securityLimits.maxSubscriptionBytes
    : DEFAULT_REQUEST_LIMITS.maxSubscriptionBytes;

  let sourceSkeleton = { proxies: [] };
  /** 订阅携带的节点专属 DNS 资产闭包累积容器（显式值通道，最终由 strategy 层消费） */
  const dnsAssets = { hosts: {}, policies: {}, fakeIpFilters: [] };
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
    logger.debug(`🛡️ 系统网络: 检测到活跃的 TUN 虚拟网卡 (${tunInterface})，流量将自动由内核接管`);
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
      if (logger) logger.debug(`🔌 抓取代理: 127.0.0.1:${proxyPort} (已就绪 · 策略: ${proxyStrategy})`);
    } else {
      isProxyAvailable = false;
      if (tunInterface) {
        if (logger) logger.warn(`💡 本地代理端口 127.0.0.1:${proxyPort} 未监听，已切换为系统 TUN 虚拟网卡 (${tunInterface}) 接管`);
      } else {
        if (logger) logger.warn(`⚠️ 本地抓取代理 127.0.0.1:${proxyPort} 连通失败 (服务未启动或端口填写有误)，已降级为直连拉取`);
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
      expired: isExpiredNow(expire)
    });
  }

  // 1. 多订阅并发抓取分支
  if (subscriptions && Array.isArray(subscriptions) && subscriptions.length > 0) {
    const fetchTasks = subscriptions.map(async (sub) => {
      if (!isSubEnabled(sub)) {
        return { sub, rawResult: null, error: null, disabled: true, terminal: false };
      }
      const isDirectNode = isDirectNodeSub(sub);
      if (!sub.url && !sub.uri && !isDirectNode) return { sub, rawResult: null, error: null, skipped: true, terminal: false };
      let isTerminal = false;
      try {
        let rawResult;
        if (isDirectNode) {
          rawResult = { directProxies: [buildDirectProxy(sub)], subInfo: null };
        } else if (sub.uri) {
          rawResult = { content: sub.uri, subInfo: null };
        } else {
          const subKey = sub.url;
          const initialStale = (typeof subStaleCache.getSnapshot === 'function')
            ? subStaleCache.getSnapshot(subKey)
            : subStaleCache.get(subKey);
          const localSubPath = path.resolve(process.cwd(), sub.url);
          if (!/^https?:\/\//i.test(sub.url) && fs.existsSync(localSubPath) && fs.statSync(localSubPath).isFile()) {
            logger.debug(`📄 读取本地订阅文件: ${sub.url}`);
            rawResult = { content: fs.readFileSync(localSubPath, 'utf-8'), subInfo: null };
          } else if (!bypassSubBackoff && isSubInFetchBackoff(subKey)) {
            // 退避期内不再发起网络请求：有可用旧缓存直接复用，否则快速失败
            const backoff = resolveBackoffStale(subKey, initialStale, staleMaxAgeMs);
            if (backoff && backoff.usable) {
              logger.warn(`⏳ 订阅处于失败退避期，直接复用上次成功数据: ${redactUrl(sub.url, showFullUrl)}`);
              rawResult = { content: backoff.stale.content, subInfo: backoff.stale.subInfo, stale: true };
            } else {
              if (backoff && (backoff.expired || backoff.state.terminal)) isTerminal = true;
              const nextRetryAt = backoff ? backoff.state.nextRetryAt : Date.now() + 30000;
              const retryInSec = Math.max(1, Math.ceil((nextRetryAt - Date.now()) / 1000));
              const skipErr = new Error(`Subscription fetch skipped (failure backoff, retry in ${retryInSec}s)`);
              skipErr.isBackoff = true;
              skipErr.retryable = false;
              throw skipErr;
            }
          } else {
            try {
              rawResult = await fetchNodes(sub.url, {
                showFullUrl, debug, logger,
                proxyUrl: effectiveProxyUrl,
                strategy: effectiveStrategy,
                perSubProxy: isProxyAvailable ? sub.proxy : false,
                retry: typeof sub.retry === 'number' ? sub.retry : fetchRetry,
                timeoutMs: fetchTimeoutSec * 1000,
                maxBytes: maxSubscriptionBytes
              });

              // 校验成功响应（到期 / 流量耗尽 / 空节点 / 纯占位节点 → 抛错）
              validateFetchedSubscription(rawResult);
              clearSubFetchFailure(subKey);
            } catch (e) {
              const decision = evaluateStaleFallback(e, { subKey, initialStale, staleMaxAgeMs });

              // 只要确认终态失效，无论旧缓存是否存在均必须上报终态信号
              if (decision.isTerminal) isTerminal = true;
              // 失败退避：记录失败次数与终态语义，供后续构建在退避期内快速跳过网络
              if (!e.isBackoff) recordSubFetchFailure(subKey, e, isTerminal);

              if (decision.allowFallback) {
                logger.warn(`⚠️ 订阅拉取失败，降级使用上次成功数据: ${e.message}`);
                rawResult = { content: decision.stale.content, subInfo: decision.stale.subInfo, stale: true };
              } else {
                if (decision.fallbackRejectReason && logger && (options.debug || userConfig.logLevel === 'debug')) {
                  logger.debug(`🛡️ 拒绝容灾兜底 [${redactUrl(sub.url, showFullUrl)}]: ${decision.fallbackRejectReason}`);
                }
                throw e;
              }
            }
            if (rawResult && !rawResult.stale) {
              subStaleCache.set(subKey, { content: rawResult.content, subInfo: rawResult.subInfo, timestamp: Date.now() });
              pruneSubStaleCache(staleMaxAgeMs);
            }
          }
        }
        return { sub, rawResult, error: null, terminal: isTerminal };
      } catch (e) {
        return { sub, rawResult: null, error: e, terminal: isTerminal };
      }
    });

    const fetchedResults = await Promise.all(fetchTasks);
    const subSummaries = [];

    for (const { sub, rawResult, error, disabled, skipped, terminal } of fetchedResults) {
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
          logger.debug(`📌 摄入单节点: ${nameHint}${sub.tag ? ` [${sub.tag}]` : ''}`);
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
          ? generateInfoNodes(rawResult.subInfo, effectiveTag, { isStale: !!rawResult.stale })
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
        subStatuses.push({
          tag: sub.tag || effectiveTag,
          status: rawResult.stale ? 'stale' : 'ok',
          nodeCount
        });
        subSummaries.push({
          type: subType,
          nameHint: isDirect ? (subProxies[0] ? subProxies[0].name : '未知') : '',
          tag: sub.tag || effectiveTag,
          total: nodeCount,
          filtered: filteredCount,
          synth: synthNodes.length,
          stripped: strippedCount
        });
      } catch (e) {
        const subId = isDirect ? (sub.name || sub.tag || 'direct-node') : redactUrl(sub.url, showFullUrl);
        logger.error(`❌ 订阅解析异常 [${subId}]: ${e.message}`);

        let effectiveTag = sub.tag;
        if (!effectiveTag && sub.url && sub.url.startsWith('http')) {
          try { effectiveTag = new URL(sub.url).hostname; } catch {}
        }
        if (!effectiveTag) effectiveTag = '订阅';

        if (enableDashboard) {
          const failNode = createFetchErrorNode(effectiveTag, e.message);
          sourceSkeleton.proxies.push(failNode);
        }

        let shortMsg = e.message || '抓取失败';
        if (/fetch failed/i.test(shortMsg)) shortMsg = '网络连接失败';
        else if (/timeout/i.test(shortMsg)) shortMsg = '拉取超时';
        else if (/HTTP Error: (\d+)/i.test(shortMsg)) shortMsg = `HTTP ${shortMsg.match(/HTTP Error: (\d+)/i)[1]}`;
        else if (/no nodes/i.test(shortMsg)) shortMsg = '未解析到有效节点';
        else if (/expired/i.test(shortMsg)) shortMsg = '订阅已到期';
        else if (/quota exhausted/i.test(shortMsg)) shortMsg = '流量已耗尽';

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
          failReason: shortMsg
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

    if (subSummaries.length > 0 && logger) {
      const lines = [`📡 订阅源抓取与解析完成 (${subSummaries.length} 个源):`];
      subSummaries.forEach((s, idx) => {
        const isLast = idx === subSummaries.length - 1;
        const branch = isLast ? '└──' : '├──';
        if (s.disabled) {
          lines.push(`${branch} ⏸️ [${s.tag}]: 已停用 (跳过)`);
        } else if (s.failed) {
          lines.push(`${branch} ❌ [${s.tag}]: 拉取失败 (${s.failReason})`);
        } else {
          const icon = s.type === 'uri' ? '📌' : '🌐';
          const details = [];
          if (s.filtered > 0) details.push(`过滤 ${s.filtered} 说明节点`);
          if (s.synth > 0) details.push(`合成 ${s.synth} 看板`);
          if (s.stripped > 0) details.push(`🛡️ 剥离 ${s.stripped} 越权`);
          const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
          const namePart = s.type === 'uri' ? `${s.nameHint}${s.tag ? ` [${s.tag}]` : ''}` : `[${s.tag}]`;
          lines.push(`${branch} ${icon} ${namePart}: ${s.total} 个节点${detailStr}`);
        }
      });
      logger.info(lines.join('\n'));
    }

    // 仅在多订阅 (>=2 个有流量的有效源) 且启用看板时，在最顶部注入一组「全局总额」配对节点（流量 + 到期）
    const activeSubsWithTraffic = collectedSubInfos.filter(s => !s.expired && s.total > 0);
    if (enableDashboard && activeSubsWithTraffic.length > 1) {
      const agg = typeof dsh.aggregateSubscriptions === 'function'
        ? dsh.aggregateSubscriptions(collectedSubInfos, { expireAggregation: userConfig.expireAggregation, logger })
        : null;
      if (agg && agg.globalTotal > 0 && typeof dsh.buildGlobalDashboardNodes === 'function') {
        const topNodes = dsh.buildGlobalDashboardNodes({
          globalUpload: agg.globalUpload,
          globalDownload: agg.globalDownload,
          globalTotal: agg.globalTotal,
          globalExpire: agg.globalExpire,
          expireAggregation: userConfig.expireAggregation
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
    let fallbackRejectReason = '';
    let fetchError = null;
    let subStatus = 'ok';
    const localFilePath = path.resolve(process.cwd(), url);
    if (!/^https?:\/\//i.test(url) && !/^(vless|vmess|trojan|ss):\/\//i.test(url)) {
      if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
        logger.info(`📄 读取本地配置/节点文件: ${url}`);
        rawResult = { content: fs.readFileSync(localFilePath, 'utf-8'), subInfo: null };
      } else {
        throw new Error(`Subscription file not found or invalid URL: ${url}`);
      }
    } else if (/^(vless|vmess|trojan|ss):\/\//i.test(url)) {
      logger.debug(`📌 解析 URI 节点: ${url.split('#').pop() || '未知'}`);
      rawResult = { content: url, subInfo: null };
    } else {
      const subKey = url;
      const initialStale = (typeof subStaleCache.getSnapshot === 'function')
        ? subStaleCache.getSnapshot(subKey)
        : subStaleCache.get(subKey);

      if (!bypassSubBackoff && isSubInFetchBackoff(subKey)) {
        // 退避期内不再发起网络请求：有可用旧缓存直接复用，否则快速失败
        const backoff = resolveBackoffStale(subKey, initialStale, staleMaxAgeMs);
        if (backoff && backoff.usable) {
          logger.warn(`⏳ 订阅处于失败退避期，直接复用上次成功数据: ${redactUrl(url, showFullUrl)}`);
          rawResult = { content: backoff.stale.content, subInfo: backoff.stale.subInfo, stale: true };
          subStatus = 'stale';
        } else {
          if (backoff && (backoff.expired || backoff.state.terminal)) {
            isTerminal = true;
            subStatus = 'terminal';
            fallbackRejectReason = '旧缓存已过期';
          }
          const nextRetryAt = backoff ? backoff.state.nextRetryAt : Date.now() + 30000;
          const retryInSec = Math.max(1, Math.ceil((nextRetryAt - Date.now()) / 1000));
          const skipErr = new Error(`Subscription fetch skipped (failure backoff, retry in ${retryInSec}s)`);
          skipErr.isBackoff = true;
          skipErr.retryable = false;
          throw skipErr;
        }
      } else {
        try {
          rawResult = await fetchNodes(url, {
            showFullUrl, debug, logger,
            proxyUrl: effectiveProxyUrl,
            strategy: effectiveStrategy,
            retry: fetchRetry,
            timeoutMs: fetchTimeoutSec * 1000,
            maxBytes: maxSubscriptionBytes
          });

          // 校验成功响应（到期 / 流量耗尽 / 空节点 / 纯占位节点 → 抛错）
          validateFetchedSubscription(rawResult);
          clearSubFetchFailure(subKey);
        } catch (e) {
          fetchError = e;
          const decision = evaluateStaleFallback(e, { subKey, initialStale, staleMaxAgeMs });
          isTerminal = decision.isTerminal;
          fallbackRejectReason = decision.fallbackRejectReason;

          // 失败退避：记录失败次数与终态语义，供后续构建在退避期内快速跳过网络
          if (!e.isBackoff) recordSubFetchFailure(subKey, e, isTerminal);

          if (decision.allowFallback) {
            logger.warn(`⚠️ 订阅拉取失败，降级使用上次成功数据: ${e.message}`);
            rawResult = { content: decision.stale.content, subInfo: decision.stale.subInfo, stale: true };
            subStatus = 'stale';
          } else {
            if (e?.subInfo) {
              recordSubInfo(e.subInfo, '');
            }
            if (fallbackRejectReason && logger && (options.debug || userConfig.logLevel === 'debug')) {
              logger.debug(`🛡️ 拒绝容灾兜底 [${redactUrl(url, showFullUrl)}]: ${fallbackRejectReason}`);
            }
            // 单 URL 模式下若因终态失效拒绝，构造空骨架以交付并保留元数据，与多订阅模式保持一致
            if (isTerminal) {
              subStatus = 'terminal';
              rawResult = { content: '', subInfo: e?.subInfo || null };
            } else {
              subStatus = 'failed';
              throw e;
            }
          }
        }

        if (rawResult && !rawResult.stale && !isTerminal) {
          subStaleCache.set(subKey, { content: rawResult.content, subInfo: rawResult.subInfo, timestamp: Date.now() });
          pruneSubStaleCache(staleMaxAgeMs);
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
    logger.info(`📡 节点解析完成: ${nodeCount} 个节点`);
    if (enableDashboard) {
      if (isTerminal) {
        const effectiveTag = (url && url.startsWith('http')) ? new URL(url).hostname : '订阅';
        const failNode = createFetchErrorNode(effectiveTag, fallbackRejectReason || '订阅已到期');
        sourceSkeleton.proxies.push(failNode);
      }
      const effectiveSubInfo = rawResult?.subInfo || (fetchError?.subInfo || null);
      const { nodes: synthNodes } = generateInfoNodes(effectiveSubInfo, '');
      if (synthNodes.length > 0) {
        sourceSkeleton.proxies.unshift(...synthNodes);
      }
    }
  } else {
    throw new Error('No URL or subscriptions provided.');
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
