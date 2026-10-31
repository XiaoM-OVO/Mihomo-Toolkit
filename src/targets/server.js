/**
 * -----------------------------------------------------------------------------
 * Target: HTTP 订阅转换与策略构建服务端
 * -----------------------------------------------------------------------------
 */

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('yaml');
const { buildProfile, normalizeOutputMode, getProfileCacheStats } = require('../pipeline/engine');
const { createLogger, createRepeatGate, formatDuration } = require('../core/logger');
const { safeFetchText } = require('../io/fetcher');
const { isAllowedUrlAsync, redactUrl } = require('../io/ssrf');
const { validateRequestLimits, DEFAULT_REQUEST_LIMITS } = require('../io/limits');
const { hardenRemoteConfig } = require('../core/security/remote-config');
const { absolutizeMountPaths } = require('../config/mounts');
const { expandIncludes } = require('../config/include');
const { normalizeSubDomains, normalizeProxyRules, isTrustedProxy } = require('../infra/ip');
const pkg = require('../../package.json');

// 远程配置审计去重：按「配置来源 URL + 同一组被忽略字段」隔离计数；
// 加固与剥离行为始终执行，去重只影响日志级别。
const remoteConfigAuditGate = createRepeatGate(100);

/** 回环地址判定（仅这些地址可视为「本机可信接入」） */
function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || h.startsWith('127.');
}

/** 恒定时间字符串比较，避免 Token 被逐字节时序探测 */
function safeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/**
 * 将引擎通知的缓存状态归一化为标准的 HTTP X-Cache 响应头值
 * @param {string} status 引擎通知的状态 (fresh | stale | miss | force | bypass)
 * @returns {string} HTTP X-Cache 响应头取值
 */
function mapCacheStatusToHeader(status) {
  switch (status) {
    case 'fresh': return 'HIT';
    case 'stale': return 'STALE';
    case 'miss':  return 'MISS';
    case 'force':
    case 'bypass':
    default:
      return 'BYPASS';
  }
}

/** 提取客户端真实 IP（优先读取反向代理投递的 X-Forwarded-For / X-Real-IP） */
function getClientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  const realIp = req.headers && req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  const raw = req.socket?.remoteAddress || '';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw || '127.0.0.1';
}

/** 归一化 socket 地址/IP 片段：仅接受合法 IP，丢弃 "unknown" 等无效值 */
function normalizeSocketAddress(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const mapped = text.startsWith('::ffff:') ? text.slice(7) : text;
  return net.isIP(mapped) ? mapped : '';
}

/**
 * 解析请求的真实来源 IP（带反代信任边界）。
 *
 * X-Forwarded-For / X-Real-IP 属于客户端可伪造的头，只有当「直连 socket 地址」本身
 * 命中 trustedProxies 时才会被采信；否则一律使用直连地址，避免日志与后续限流被伪造。
 * 采信时从右向左跳过受信代理，返回第一个不可信地址（即最接近真实客户端的节点）。
 *
 * @param {object} req
 * @param {string[]} [trustedProxies] 已归一化的受信代理规则（见 normalizeProxyRules）
 * @returns {string}
 */
function resolveClientIp(req, trustedProxies = []) {
  const rules = Array.isArray(trustedProxies) ? trustedProxies : [];
  const direct = normalizeSocketAddress(req.socket?.remoteAddress) || '127.0.0.1';
  if (rules.length === 0 || !isTrustedProxy(direct, rules)) return direct;

  const xff = req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const hops = xff.split(',').map(part => normalizeSocketAddress(part)).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      if (isTrustedProxy(hops[i], rules)) continue;
      return hops[i];
    }
  }

  const realIp = normalizeSocketAddress(req.headers && req.headers['x-real-ip']);
  if (realIp && !isTrustedProxy(realIp, rules)) return realIp;

  return direct;
}

/** 提取客户端请求的目标 Host（仅依据经过反向代理绑定的标准 Host 请求头，防止外部通过 X-Forwarded-Host 伪造投毒） */
function getRequestHost(req) {
  const host = req.headers && req.headers['host'];
  if (typeof host === 'string' && host.trim()) {
    return host.trim();
  }
  return null;
}

// ─── Host 白名单与缓存键收敛 ──────────────────────────────────────────────
// Host 请求头是客户端可控输入，而 subDomain 会注入产物直连规则并参与 L2 缓存键。
// 不加约束时，任意 Host 都能制造新的缓存条目并触发整轮重建（缓存投毒 + 放大攻击）。
// 策略：
//   - 配置 allowedHosts → 仅白名单内的 Host 参与 subDomain 推导；
//   - 未配置 allowedHosts 且监听非回环地址 → 已通过 authToken 鉴权的请求允许自动嗅探，
//     未鉴权请求的 Host 一律不参与推导（fail-closed）；
//   - 未配置 allowedHosts 且监听回环地址 → 保持兼容，本机请求视为可信。
// 无论何种路径，请求侧 Host 在合并前统一排序，确保同一 Host 集合收敛到同一缓存键。
const hostPolicyAuditGate = createRepeatGate(100);

/** 通配规则（`*.` / `+.`）按 DOMAIN-SUFFIX 语义匹配：含裸域与任意级子域 */
function hostMatchesAllowedHost(host, rule) {
  if (!host || !rule) return false;
  const h = String(host).trim().toLowerCase();
  const r = String(rule).trim().toLowerCase();
  if (!h || !r) return false;
  if (r.startsWith('*.') || r.startsWith('+.')) {
    const suffix = r.slice(2);
    return h === suffix || h.endsWith(`.${suffix}`);
  }
  return h === r;
}

/** 判定单个主机名是否命中白名单 */
function isHostAllowed(host, allowedHosts) {
  return Array.isArray(allowedHosts) && allowedHosts.some(rule => hostMatchesAllowedHost(host, rule));
}

 /**
 * 解析本次请求可信的 Host 派生 subDomain。
 *
 * 信任层级（从高到低）：
 *   1. 配置了 allowedHosts → 仅命中白名单的 Host；
 *   2. 已通过 authToken 鉴权 → 请求方是持票人，允许自动嗅探 Host（保持原有直连规则自适应）；
 *   3. 监听回环地址 → 本机请求视为可信；
 *   4. 其余（非回环监听 + 未鉴权）→ 一律忽略，fail-closed 防缓存投毒。
 *
 * @param {object} params
 * @param {string|null} params.rawHost 原始 Host 请求头
 * @param {string[]} [params.allowedHosts] 已归一化的白名单规则
 * @param {boolean} [params.boundLoopback] 服务是否监听回环地址
 * @param {boolean} [params.authenticated] 本次请求是否已通过 authToken 鉴权
 * @returns {{ hosts: string[], rejected: string[], reason: string|null }}
 *   reason='not-allowed' 表示命中白名单拒绝；'untrusted-host' 表示非回环监听且请求未鉴权、未配置白名单
 */
function resolveRequestHosts({ rawHost, allowedHosts = [], boundLoopback = true, authenticated = false }) {
  const candidates = normalizeSubDomains(rawHost).sort();
  if (candidates.length === 0) return { hosts: [], rejected: [], reason: null };
  if (allowedHosts.length > 0) {
    const hosts = candidates.filter(h => isHostAllowed(h, allowedHosts));
    const rejected = candidates.filter(h => !isHostAllowed(h, allowedHosts));
    return { hosts, rejected, reason: rejected.length > 0 ? 'not-allowed' : null };
  }
  if (!boundLoopback && !authenticated) {
    return { hosts: [], rejected: candidates, reason: 'untrusted-host' };
  }
  return { hosts: candidates, rejected: [], reason: null };
}

function startServer(options = {}) {
  const PORT = options.port !== undefined ? options.port : (process.env.PORT || 3000);
  // 默认仅监听回环：常驻服务承载「可发起外部请求 + 可读取本地订阅文件」的能力，
  // 默认暴露到全网卡会让局域网/公网直接获得一个开放订阅中继。
  const HOST = options.host || process.env.HOST || '127.0.0.1';
  const CONFIG_PATH = options.configPath || process.env.CONFIG_PATH || path.resolve(process.cwd(), 'config.yaml');

  /**
   * 解析配置文件内容并展开包含片段与挂载路径
   */
  function parseConfigContent(content, configPath) {
    const parsed = (configPath.endsWith('.yaml') || configPath.endsWith('.yml'))
      ? (yaml.parse(content) || {})
      : JSON.parse(content);
    const absolutized = absolutizeMountPaths(parsed, path.dirname(configPath));
    return expandIncludes(absolutized, path.dirname(configPath));
  }

  /**
   * 读取本地配置文件。
   *
   * 两点与旧行为不同：
   *   1. 外挂配置路径（servicesConfigFile 等）以**配置文件所在目录**为基准转绝对路径，
   *      否则服务从别的工作目录启动时相对路径会静默失效；
   *   2. 解析失败**抛出**，由调用方决定是致命（启动）还是保住上一份有效配置（热重载），
   *      不再用 `catch (e) {}` 把错误吞掉。
   */
  function readLocalConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return parseConfigContent(content, CONFIG_PATH);
  }

  let localConfig = {};
  let lastConfigMtime = 0;
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const stat = fs.statSync(CONFIG_PATH);
      localConfig = readLocalConfig();
      lastConfigMtime = stat.mtimeMs;
    } catch (e) {
      // 启动阶段配置即损坏：fail-closed，直接拒绝带病启动
      if (options.logger && typeof options.logger.error === 'function') {
        options.logger.error(`❌ 配置文件无法解析：${CONFIG_PATH}：${e.message}`);
      } else {
        console.error(`❌ 配置文件无法解析：${CONFIG_PATH}：${e.message}`);
      }
      throw e;
    }
  }

  let reloadFlight = null;

  /**
   * 安全获取或热重载配置文件。
   * 包含：
   * 1. 单飞并发控制 (Single-flight)：并发请求共享重载 Promise，避免重复读盘与解析；
   * 2. 防抖与写盘中间态容错：对 0 字节、未写完的内容进行微小延迟重试 (最多 2 次，每次 60ms)；
   * 3. 稳健降级：重试耗尽后若依然无法解析，保留上一份正常配置并记录错误日志。
   */
  async function getOrReloadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      return localConfig;
    }

    let stat;
    try {
      stat = await fs.promises.stat(CONFIG_PATH);
    } catch {
      return localConfig;
    }

    if (stat.mtimeMs === lastConfigMtime) {
      return localConfig;
    }

    if (reloadFlight) {
      return reloadFlight;
    }

    reloadFlight = (async () => {
      const MAX_RETRIES = 2;
      const RETRY_DELAY_MS = 60;
      let lastErr = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const statNow = await fs.promises.stat(CONFIG_PATH);
          // 0 字节防抖：若原配置非空但当前文件大小为 0，大概率是编辑器清空重写阶段
          if (statNow.size === 0 && localConfig && Object.keys(localConfig).length > 0) {
            throw new Error('配置文件大小为 0 字节 (疑似编辑器正在写入中)');
          }

          const raw = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
          if (!raw.trim() && localConfig && Object.keys(localConfig).length > 0) {
            throw new Error('配置文件内容为空 (疑似未写完)');
          }

          const parsed = parseConfigContent(raw, CONFIG_PATH);

          // 结构完整性防御：如果原配置包含 subscriptions，但解析结果完全无 subscriptions 且文件极短
          if (Array.isArray(localConfig.subscriptions) && localConfig.subscriptions.length > 0 &&
              (!parsed.subscriptions || (Array.isArray(parsed.subscriptions) && parsed.subscriptions.length === 0 && statNow.size < 60))) {
            if (attempt < MAX_RETRIES) {
              throw new Error('配置文件 subscriptions 结构疑似未写完');
            }
          }

          localConfig = parsed;
          lastConfigMtime = statNow.mtimeMs;
          serverLogger.info(`🔄 配置文件变动，已平滑重载（mtime: ${statNow.mtimeMs}）`);
          return localConfig;
        } catch (err) {
          lastErr = err;
          if (attempt < MAX_RETRIES) {
            await new Promise(r => { setTimeout(r, RETRY_DELAY_MS); });
          }
        }
      }

      // 重试耗尽后仍无法正常解析：更新 mtime 避免后续每个请求都反复进入重试延时
      try {
        const fallbackStat = await fs.promises.stat(CONFIG_PATH);
        lastConfigMtime = fallbackStat.mtimeMs;
      } catch (_) {}

      serverLogger.error(`❌ 配置文件热重载失败（保留上一份有效配置）：${lastErr?.message || lastErr}`);
      return localConfig;
    })().finally(() => {
      reloadFlight = null;
    });

    return reloadFlight;
  }

  const isTest = (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    (Array.isArray(process.execArgv) && process.execArgv.some(arg => typeof arg === 'string' && arg.startsWith('--test')))
  );
  const envLogLevel = process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : '');
  const defaultLogLevel = (isTest && !envLogLevel) ? 'silent' : 'info';

  const serverLogger = (options.logger && typeof options.logger.child === 'function')
    ? options.logger
    : createLogger({
        tag: 'Server',
        level: options.debug
          ? 'debug'
          : (options.silent
              ? 'silent'
              : (options.logLevel || localConfig.logLevel || envLogLevel || defaultLogLevel))
      });

  // 安全姿态：监听面是否回环 + 启动时是否已配置鉴权
  const BOUND_LOOPBACK = isLoopbackHost(HOST);
  const authTokenAtStartup = process.env.AUTH_TOKEN || localConfig.authToken || '';
  const MAX_CONCURRENT_BUILDS = Number(localConfig.maxConcurrentBuilds) > 0
    ? Number(localConfig.maxConcurrentBuilds)
    : 8;
  let activeBuilds = 0;
  // 请求访问日志序号：用于把「收到 / 完成」成对关联，避免并发请求日志交错后无法匹配
  let requestSeq = 0;
  // 并发过载拒绝属于持续性事件，沿用审计去重规范：首次 warn，重复降级 debug
  const overloadAuditGate = createRepeatGate(50);
  const lastRefreshTimes = new Map();

  // 最近一次构建的订阅健康快照：供 /healthz 输出订阅连通度（避免暴露逐条 URL 明文与错误细节）
  const buildHealth = {
    lastBuildAt: 0,
    lastBuildOk: false,
    hasFailedSub: false,
    hasTerminalFailure: false,
    degraded: false,
    usableSubCount: 0,
    failedSubCount: 0,
    staleSubCount: 0
  };
  const recordBuildHealth = (outcome = {}) => {
    buildHealth.lastBuildAt = Date.now();
    buildHealth.hasFailedSub = outcome.hasFailedSub === true;
    buildHealth.hasTerminalFailure = outcome.hasTerminalFailure === true;
    buildHealth.degraded = outcome.degraded === true;
    buildHealth.usableSubCount = Number.isFinite(outcome.usableSubCount) ? outcome.usableSubCount : 0;
    buildHealth.failedSubCount = Array.isArray(outcome.failedTags) ? outcome.failedTags.length : 0;
    buildHealth.staleSubCount = Array.isArray(outcome.staleTags) ? outcome.staleTags.length : 0;
    buildHealth.lastBuildOk = !buildHealth.hasFailedSub && !buildHealth.hasTerminalFailure;
  };

  // 共享刷新锁：防止后台预热与后台定时轮询任务重叠或相互踩踏
  let isBackgroundRefreshing = false;

  /**
   * 共享后台执行器：为启动预热与定时轮询提供统一的防重叠互斥保护
   * @param {string} triggerName 触发源标识 (Warmup | Cron)
   * @param {string} logMessage 启动日志说明
   */
  async function runGuardedBackgroundRefresh(triggerName, logMessage) {
    if (isBackgroundRefreshing) {
      serverLogger.warn(`⏳ 上一轮后台刷新未结束，跳过本轮 [${triggerName}]`);
      return false;
    }

    isBackgroundRefreshing = true;
    const taskLogger = serverLogger.child(triggerName);

    try {
      if (logMessage) taskLogger.info(logMessage);
      let published = false;
      let hasFailedSub = false;
      const isWarmup = triggerName === 'Warmup';

      const currentConfig = await getOrReloadConfig();
      await buildProfile(currentConfig, {
        production: true,
        forceRefresh: true,
        // 预热只做「原始订阅快照」（L1）：此时尚无客户端 Host，subDomain 无法确定，
        // 组装出的 Profile 缓存键与真实请求键必然不同，构建产物必然作废。
        fetchOnly: isWarmup,
        logger: taskLogger,
        onBuildOutcome: (outcome) => {
          published = !!outcome?.published;
          hasFailedSub = !!outcome?.hasFailedSub;
          recordBuildHealth(outcome);
        }
      });

      if (isWarmup) {
        if (hasFailedSub) {
          taskLogger.warn('⚠️ 订阅快照预热完成，但部分订阅不可用；首次请求将按客户端 Host 组装产物');
        } else {
          taskLogger.info('✨ 订阅快照预热完成（原始内容已缓存，首次请求将按客户端 Host 组装产物）');
        }
      } else {
        if (published && hasFailedSub) {
          taskLogger.warn('⚠️ 后台定时更新完成，部分订阅不可用，已发布降级缓存');
        } else if (published) {
          taskLogger.info('✅ 后台定时更新完成，新缓存已就绪');
        } else {
          taskLogger.warn('⚠️ 后台定时更新结束，未发布新缓存（保留旧缓存）：全部订阅不可用或写入被拦截');
        }
      }
      return true;
    } catch (err) {
      if (triggerName === 'Warmup') {
        taskLogger.warn(`⚠️ 初始缓存预热失败（不影响服务运行）：${err.message}`);
      } else {
        taskLogger.warn(`⚠️ 后台定时更新异常（保留当前有效缓存）：${err.message}`);
      }
      return false;
    } finally {
      isBackgroundRefreshing = false;
    }
  }

  let isShuttingDown = false;
  let shutdownPromise = null;

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

    if (reqUrl.pathname === '/healthz' || reqUrl.pathname === '/ping') {
      const enabledSubs = Array.isArray(localConfig.subscriptions)
        ? localConfig.subscriptions.filter(s => s && s.enabled !== false).length
        : 0;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: isShuttingDown ? 'shutting_down' : 'ok',
        service: 'Mihomo-Toolkit',
        version: pkg.version,
        uptime: Math.floor(process.uptime()),
        activeBuilds,
        maxConcurrentBuilds: Number(localConfig.maxConcurrentBuilds) > 0
          ? Number(localConfig.maxConcurrentBuilds)
          : MAX_CONCURRENT_BUILDS,
        // Profile SWR 缓存命中率（进程生命周期累计）
        cache: getProfileCacheStats(),
        // 订阅健康度（聚合视图，不暴露逐条 URL 明文与上游错误细节）
        subscriptions: {
          enabled: enabledSubs,
          lastBuildAt: buildHealth.lastBuildAt ? new Date(buildHealth.lastBuildAt).toISOString() : null,
          lastBuildOk: buildHealth.lastBuildOk,
          degraded: buildHealth.degraded,
          usableSubCount: buildHealth.usableSubCount,
          failedSubCount: buildHealth.failedSubCount,
          staleSubCount: buildHealth.staleSubCount,
          hasFailedSub: buildHealth.hasFailedSub,
          hasTerminalFailure: buildHealth.hasTerminalFailure
        }
      }));
      return;
    }

    if (reqUrl.pathname === '/sub' || reqUrl.pathname === '/') {
      const reqStartedAt = Date.now();
      const reqNo = ++requestSeq;
      const reqId = `#${String(reqNo % 10000).padStart(4, '0')}`;
      // writeHead 之后 res.getHeader 不可用，缓存状态需在响应前显式记录供结束行输出
      let responseCacheStatus = '';
      // 访问日志成对输出：请求行（鉴权通过后） + 结束行（状态码 · 耗时 · 缓存命中）
      res.on('finish', () => {
        const elapsedMs = Date.now() - reqStartedAt;
        const detail = `${res.statusCode} · ${elapsedMs}ms${responseCacheStatus ? ` · X-Cache=${responseCacheStatus}` : ''}`;
        if (res.statusCode >= 400) {
          // 失败原因已由对应分支单独记录，结束行仅作配对，避免重复刷屏
          serverLogger.debug(`📤 请求结束 ${reqId}：${detail}`);
        } else {
          serverLogger.info(`📤 请求完成 ${reqId}：${detail}`);
        }
      });
      if (isShuttingDown) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Connection': 'close' });
        res.end('Service Unavailable: server is shutting down.');
        return;
      }

      const effectiveMaxConcurrent = Number(localConfig.maxConcurrentBuilds) > 0
        ? Number(localConfig.maxConcurrentBuilds)
        : MAX_CONCURRENT_BUILDS;

      // 并发上限：单次构建会触发多个外部拉取与全量拓扑计算，不设限可被轻易打满
      if (activeBuilds >= effectiveMaxConcurrent) {
        const seenTimes = overloadAuditGate('sub-overload');
        const detail = `并发构建已达上限（${activeBuilds}/${effectiveMaxConcurrent}）（来自 ${resolveClientIp(req, normalizeProxyRules(localConfig.trustedProxies))}）`;
        if (seenTimes > 1) {
          serverLogger.debug(`⏳ 并发过载：重复拒绝 ${reqId}（第 ${seenTimes} 次 · ${detail}）`);
        } else {
          serverLogger.warn(`⏳ 并发过载：拒绝请求 ${reqId}（${detail}）`);
        }
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5' });
        res.end('Service Unavailable: too many concurrent builds, please retry later.');
        return;
      }
      activeBuilds++;
      try {
        localConfig = await getOrReloadConfig();

        const clientIp = resolveClientIp(req, normalizeProxyRules(localConfig.trustedProxies));
        const userAgent = (req.headers && req.headers['user-agent']) || 'unknown';

        let safeUrl = reqUrl.pathname;
        const safeParams = [];
        const subCount = reqUrl.searchParams.getAll('url').length;
        if (subCount > 0) safeParams.push(`url=[${subCount} subscriptions]`);
        if (reqUrl.searchParams.get('config')) safeParams.push(`config=${redactUrl(reqUrl.searchParams.get('config'))}`);
        if (reqUrl.searchParams.has('token')) safeParams.push('token=***');
        if (reqUrl.searchParams.has('debug')) safeParams.push(`debug=${reqUrl.searchParams.get('debug')}`);
        if (reqUrl.searchParams.has('refresh')) safeParams.push(`refresh=${reqUrl.searchParams.get('refresh')}`);
        else if (reqUrl.searchParams.has('force')) safeParams.push(`force=${reqUrl.searchParams.get('force')}`);
        if (safeParams.length > 0) safeUrl += `?${safeParams.join('&')}`;

        const authToken = process.env.AUTH_TOKEN || localConfig.authToken;
        if (authToken) {
          const urlToken = reqUrl.searchParams.get('token');
          const headerAuth = req.headers['authorization'] || '';
          const bearerToken = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : '';
          const providedToken = urlToken || bearerToken;
          if (!safeTokenEqual(providedToken, authToken)) {
            const reason = providedToken ? '凭据不匹配' : '未提供凭据';
            serverLogger.warn(`🛑 拒绝未授权访问：${req.method} ${safeUrl}（来自 ${clientIp} · ${reason}）`);
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Unauthorized: Invalid or missing token. Provide ?token=xxx or Authorization: Bearer xxx');
            return;
          }
        }

        // 鉴权通过后才输出请求行：未授权请求只保留一条拒绝日志，避免被扫描器刷屏
        serverLogger.info(`🌐 收到订阅请求 ${reqId}：${req.method} ${safeUrl}（来自 ${clientIp}）`);
        if (localConfig.logLevel === 'debug' || reqUrl.searchParams.has('debug')) {
          serverLogger.debug(`🔍 客户端信息 ${reqId}：${clientIp} · User-Agent: ${userAgent}`);
        }

        // 参数化请求属于「外部可控输入」入口：非回环监听且未配置 authToken 时一律 fail-closed
        const enableUrlParams = localConfig.enableUrlParams !== false;
        const paramsAllowed = enableUrlParams && (BOUND_LOOPBACK || !!authToken);

        let userConfig = { subscriptions: [] };
        const configUrl = reqUrl.searchParams.get('config');
        const subUrls = reqUrl.searchParams.getAll('url');

        const securityLimits = localConfig.security || {};

        const urlLimitErr = validateRequestLimits({ subscriptionUrls: subUrls, limits: securityLimits });
        if (urlLimitErr) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`Bad Request: ${urlLimitErr.message}`);
          return;
        }

        /** 参数化入口的统一拒绝响应（区分「管理员关闭」与「未加固的公网监听」） */
        const rejectParams = () => {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(enableUrlParams
            ? 'Forbidden: 该服务监听在非回环地址且未配置 authToken，已拒绝 ?url= / ?config= 参数请求。\n' +
              '请在 config.yaml 中设置 authToken（或改用 127.0.0.1 监听）后重试。'
            : 'Forbidden: URL params are disabled by enableUrlParams=false');
        };

        if (configUrl) {
          if (!paramsAllowed) {
            rejectParams();
            return;
          }
          if (!(await isAllowedUrlAsync(configUrl))) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Bad Request: Invalid or disallowed config URL');
            return;
          }
          const maxRemoteBytes = Number(securityLimits.maxRemoteConfigBytes) > 0
            ? Number(securityLimits.maxRemoteConfigBytes)
            : DEFAULT_REQUEST_LIMITS.maxRemoteConfigBytes;
          const { text: content } = await safeFetchText(configUrl, { maxBytes: maxRemoteBytes });
          const sizeLimitErr = validateRequestLimits({ remoteConfigSize: Buffer.byteLength(content, 'utf-8'), limits: securityLimits });
          if (sizeLimitErr) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Bad Request: ${sizeLimitErr.message}`);
            return;
          }
          userConfig = yaml.parse(content) || {};

          // 远程配置属于不可信输入：剥夺其触碰服务器本机资源的能力（任意文件读取/本地代理/代码挂载）
          const hardened = hardenRemoteConfig(userConfig);
          if (!hardened.ok) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Bad Request: ${hardened.reason}`);
            return;
          }
          userConfig = hardened.config;
          if (hardened.strippedKeys.length > 0) {
            const preview = hardened.strippedKeys.slice(0, 8).join(', ');
            const seenTimes = remoteConfigAuditGate(`remote|${configUrl}|${[...hardened.strippedKeys].sort().join(',')}`);
            if (seenTimes > 1) {
              serverLogger.debug(`🛡️ 远程配置不可信：重复检测（第 ${seenTimes} 次 · 相同 ${hardened.strippedKeys.length} 个字段已忽略：${preview}）`);
            } else {
              serverLogger.warn(`🛡️ 远程配置不可信：首次发现并已忽略 ${hardened.strippedKeys.length} 个字段（${preview}）`);
            }
          }
        } else if (subUrls.length > 0) {
          if (!paramsAllowed) {
            rejectParams();
            return;
          }
          // 外部可控入口必须做 DNS 解析后的 SSRF 预检：同步字面量判断会放行
          // 「域名合法但解析到内网 / 云元数据」的绕过。逐个 await，禁止用 async 谓词直接 filter。
          const checks = await Promise.all(subUrls.map(u => isAllowedUrlAsync(u)));
          const blocked = subUrls.filter((_, i) => !checks[i]);
          if (blocked.length > 0) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Bad Request: Invalid or disallowed subscription URL(s): ${blocked.map(redactUrl).join(', ')}`);
            return;
          }
          userConfig = { ...localConfig, subscriptions: subUrls.map(u => ({ url: u })) };
        } else if (Object.keys(localConfig).length > 0) {
          userConfig = localConfig;
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Bad Request: Please provide ?url=... or ?config=... or place a config.yaml in the working directory.');
          return;
        }

        // 订阅服务域名/IP 直连自适应推导：Host 为客户端可控输入，必须过白名单/可信边界
        const reqHost = getRequestHost(req);
        const allowedHosts = normalizeSubDomains(localConfig.allowedHosts);
        const hostResolution = resolveRequestHosts({
          rawHost: reqHost,
          allowedHosts,
          boundLoopback: BOUND_LOOPBACK,
          // 已通过 authToken 鉴权的请求方是持票人：允许自动嗅探 Host，保持直连规则自适应
          authenticated: !!authToken
        });
        if (hostResolution.reason === 'not-allowed') {
          const preview = hostResolution.rejected.slice(0, 4).join(', ');
          const seenTimes = hostPolicyAuditGate(`host|not-allowed|${hostResolution.rejected.join(',')}`);
          if (seenTimes > 1) {
            serverLogger.debug(`🛡️ 请求 Host 未命中 allowedHosts：重复拦截（第 ${seenTimes} 次 · ${preview}）`);
          } else {
            serverLogger.warn(`🛡️ 请求 Host 未命中 allowedHosts，已忽略且未注入直连规则（${preview}）`);
          }
        } else if (hostResolution.reason === 'untrusted-host') {
          const seenTimes = hostPolicyAuditGate('host|untrusted-host');
          if (seenTimes > 1) {
            serverLogger.debug(`🛡️ 请求 Host 被忽略：重复检测（第 ${seenTimes} 次 · 非回环监听未配置 allowedHosts）`);
          } else {
            serverLogger.warn('🛡️ 非回环监听未配置 allowedHosts：未鉴权请求的 Host 不参与 subDomain 推导（防缓存投毒）；已通过 authToken 鉴权的请求仍会采信 Host');
          }
        }
        if (hostResolution.hosts.length > 0 || userConfig.subDomain) {
          const existing = normalizeSubDomains(userConfig.subDomain);
          // 统一归一化为数组：字符串写法与数组写法、不同 Host 顺序都收敛到同一缓存键
          const combined = Array.from(new Set([...existing, ...hostResolution.hosts]));
          userConfig = { ...userConfig, subDomain: combined };
        }

        const debugMode = reqUrl.searchParams.get('debug') === '1';
        const isRefreshParam = reqUrl.searchParams.get('refresh') === '1' || reqUrl.searchParams.get('force') === '1';
        const refreshCooldownSec = typeof localConfig.refreshCooldown === 'number'
          ? Math.max(0, localConfig.refreshCooldown)
          : 15;

        let forceRefresh = false;
        if (isRefreshParam) {
          const refreshKey = configUrl || (subUrls.length > 0 ? subUrls.join(',') : 'local');
          const now = Date.now();
          const lastTime = lastRefreshTimes.get(refreshKey) || 0;
          const elapsedSec = (now - lastTime) / 1000;

          if (refreshCooldownSec > 0 && elapsedSec < refreshCooldownSec) {
            const remainingSec = Math.ceil(refreshCooldownSec - elapsedSec);
            serverLogger.info(`⏳ 刷新冷却中（剩余 ${formatDuration(remainingSec * 1000)}），直接返回最新缓存 <- ${clientIp}`);
            forceRefresh = false;
          } else {
            lastRefreshTimes.set(refreshKey, now);
            if (lastRefreshTimes.size > 200) {
              lastRefreshTimes.clear();
              lastRefreshTimes.set(refreshKey, now);
            }
            forceRefresh = true;
            serverLogger.info(`🔄 收到强制刷新请求，绕过缓存直接回源 <- ${clientIp}`);
          }
        }

        // 交付形态 fail-closed：非法 mode 直接 400，不进入构建、不产生缓存键
        let outputMode;
        try {
          outputMode = normalizeOutputMode(reqUrl.searchParams.get('mode') || userConfig.outputMode);
        } catch (err) {
          if (err && err.code === 'INVALID_OUTPUT_MODE') {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Bad Request: ${err.message}`);
            return;
          }
          throw err;
        }
        const buildLogger = serverLogger.child('Server');

        // 捕获引擎本次实际采用的缓存状态
        let actualCacheStatus = 'bypass';
        const result = await buildProfile(userConfig, {
          production: true,
          debug: debugMode,
          mode: outputMode,
          forceRefresh,
          logger: buildLogger,
          onCacheStatus: (status) => {
            actualCacheStatus = status;
          },
          onBuildOutcome: (outcome) => {
            recordBuildHealth(outcome);
          }
        });
        const { yamlStr, userInfo } = result;

        const isReport = outputMode === 'report';
        const headers = {
          'Content-Type': isReport ? 'application/json; charset=utf-8' : 'text/yaml; charset=utf-8',
          'Profile-Update-Interval': '24',
          'Profile-Web-Page-Url': 'https://github.com/XiaoM-OVO/Mihomo-Toolkit',
          'Server': `Mihomo-Toolkit/v${pkg.version}`,
          'X-Cache': mapCacheStatusToHeader(actualCacheStatus)
        };

        if (userInfo && (userInfo.total > 0 || userInfo.expire > 0)) {
          headers['Subscription-Userinfo'] = `upload=${userInfo.upload}; download=${userInfo.download}; total=${userInfo.total}; expire=${userInfo.expire}`;
        }

        responseCacheStatus = headers['X-Cache'];
        res.writeHead(200, headers);
        res.end(isReport && result.report ? JSON.stringify(result.report, null, 2) : yamlStr);
      } catch (err) {
        // 仅记录日志，不回显内部错误细节（避免泄漏本地路径、上游状态等实现信息）
        if (err && err.isBackoff) {
          // 退避期主动跳过请求，不是真实回源失败；响应语义保持不变
          serverLogger.warn(`⏳ 配置构建因订阅退避而跳过回源（未发起网络请求）${reqId}：${err.message}`);
        } else {
          serverLogger.error(`❌ 配置构建异常 ${reqId}：${err.message}`);
        }
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Server Internal Error: profile build failed. See server logs for details.');
      } finally {
        activeBuilds--;
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Mihomo-Toolkit v${pkg.version} Server is running.\n\nUsage:\n  /sub?url=<subscription_url>\n  /sub?config=<remote_config_url>\n`);
  });

  /**
   * 平滑退出与连接排空 (Graceful Shutdown)
   * 1. 标记 isShuttingDown 并停止接入新连接
   * 2. 清理闲置 keep-alive 连接
   * 3. 排空进行中的构建任务 (activeBuilds) **与后台预热/定时刷新** (isBackgroundRefreshing)
   * 4. 若超过最大宽限期 (timeoutMs)，强制排空并关闭所有剩余连接
   *
   * 关键边界：`server.close()` 的回调在「无在途连接」时会**立即触发**——若单靠它 resolve，
   * 则会绕过后台刷新排空直接退出（后台刷新写缓存写到一半被 kill）。因此退出条件是
   * **「连接已全部关闭」 ∧ 「任务已全部排空」** 二者同时满足，任一方先到都只能触发重估、不能直接退出。
   */
  server.closeGracefully = function closeGracefully(timeoutMs = 10000) {
    if (shutdownPromise) return shutdownPromise;
    isShuttingDown = true;
    serverLogger.info('🛑 收到停止信号，平滑关闭中（等待在途请求排空）');

    shutdownPromise = new Promise((resolve) => {
      let resolved = false;
      let connectionClosed = false;

      const doResolve = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      // 排空判定：构建任务清零 **且** 后台刷新结束
      const isDrained = () => activeBuilds <= 0 && !isBackgroundRefreshing;
      const maybeResolve = () => {
        if (connectionClosed && isDrained()) doResolve();
      };

      if (server.listening) {
        try {
          server.close(() => {
            connectionClosed = true;
            maybeResolve();
          });
        } catch (_) {
          connectionClosed = true;
        }
      } else {
        connectionClosed = true;
      }

      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }

      const startTime = Date.now();
      const checkDrain = () => {
        if (resolved) return;
        if (isDrained() && connectionClosed) {
          serverLogger.info('👋 服务已安全关闭，所有任务已排空');
          if (typeof server.closeIdleConnections === 'function') {
            server.closeIdleConnections();
          }
          doResolve();
        } else if (Date.now() - startTime >= timeoutMs) {
          const stillRefreshing = isBackgroundRefreshing ? ' (后台刷新进行中)' : '';
          serverLogger.warn(`⚠️ 平滑退出超时（${timeoutMs}ms），仍有 ${activeBuilds} 个任务未结束${stillRefreshing}，强制关闭连接`);
          if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
          }
          connectionClosed = true;
          doResolve();
        } else {
          setTimeout(checkDrain, 50);
        }
      };

      checkDrain();
    });

    return shutdownPromise;
  };

  const handleSignal = async (signal) => {
    serverLogger.info(`🛑 收到 ${signal} 信号，开始平滑退出`);
    try {
      await server.closeGracefully(options.shutdownTimeoutMs || 10000);
    } catch (err) {
      serverLogger.error(`❌ 平滑关闭过程发生异常：${err.message}`);
    }
    if (require.main === module || options.exitOnSignal) {
      process.exit(0);
    }
  };

  let signalListenersRegistered = false;
  const onSigTerm = () => { handleSignal('SIGTERM'); };
  const onSigInt = () => { handleSignal('SIGINT'); };

  if (options.registerSignalHandlers !== false && (require.main === module || options.handleSignals)) {
    process.on('SIGTERM', onSigTerm);
    process.on('SIGINT', onSigInt);
    signalListenersRegistered = true;
  }

  server.on('close', () => {
    if (signalListenersRegistered) {
      process.removeListener('SIGTERM', onSigTerm);
      process.removeListener('SIGINT', onSigInt);
      signalListenersRegistered = false;
    }
  });

  server.listen(PORT, HOST, () => {
    serverLogger.info(`🚀 Mihomo-Toolkit v${pkg.version} 服务已就绪，监听 http://${HOST}:${PORT}`);
    if (!BOUND_LOOPBACK) {
      const allowedHostsAtStartup = normalizeSubDomains(localConfig.allowedHosts);
      if (localConfig.allowedHosts && allowedHostsAtStartup.length === 0) {
        serverLogger.warn('⚠️ allowedHosts 配置无有效条目（已全部忽略）：请求 Host 一律不参与 subDomain 推导');
      } else if (allowedHostsAtStartup.length > 0) {
        serverLogger.info(`🛡️ allowedHosts 白名单已生效（${allowedHostsAtStartup.length} 条规则）：仅白名单内 Host 参与 subDomain 推导`);
      } else {
        serverLogger.warn(
          '⚠️ 未配置 allowedHosts：未鉴权请求的 Host 不参与 subDomain 推导（fail-closed，防缓存投毒）；已鉴权请求仍按 Host 自动嗅探。\n' +
          '   如需对全部访问域名生效，请在 config.yaml 中配置 allowedHosts（支持 *.example.com 通配）。'
        );
      }
      const trustedProxiesAtStartup = normalizeProxyRules(localConfig.trustedProxies);
      if (localConfig.trustedProxies && trustedProxiesAtStartup.length === 0) {
        serverLogger.warn('⚠️ trustedProxies 配置无有效条目（已全部忽略）：来源 IP 仅取直连地址');
      } else if (trustedProxiesAtStartup.length > 0) {
        serverLogger.info(`🛡️ 受信反代已配置（${trustedProxiesAtStartup.length} 条规则）：仅当直连地址命中时才采信 X-Forwarded-For`);
      } else {
        serverLogger.info('🛡️ 未配置 trustedProxies：来源 IP 仅取直连地址，X-Forwarded-For 将被忽略（防伪造）');
      }
      if (authTokenAtStartup) {
        serverLogger.warn(`⚠️ 服务监听在非回环地址 ${HOST}，已启用 authToken 鉴权；请确认该端口不面向不可信网络开放。`);
      } else {
        serverLogger.warn(
          `🚨 服务监听在非回环地址 ${HOST} 且未配置 authToken：已自动拒绝 ?url= / ?config= 参数请求（fail-closed）。\n` +
          `   如需开放参数化订阅转换，请设置 AUTH_TOKEN 环境变量或 config.yaml 的 authToken。`
        );
      }
    }

    const hasLocalSubs = Array.isArray(localConfig.subscriptions) && localConfig.subscriptions.length > 0;
    const enableWarmup = options.enableWarmup ?? (localConfig.enableWarmup === true || (Number(localConfig.autoRefreshInterval) > 0 && localConfig.enableWarmup !== false));
    if (enableWarmup && hasLocalSubs) {
      setImmediate(async () => {
        await runGuardedBackgroundRefresh('Warmup', '🔥 服务已启动，后台预热订阅快照');
      });
    }

    const autoRefreshIntervalSec = Number(options.autoRefreshInterval ?? localConfig.autoRefreshInterval) || 0;
    if (autoRefreshIntervalSec > 0 && hasLocalSubs) {
      serverLogger.info(`⏰ 已启用后台自动轮询（每 ${formatDuration(autoRefreshIntervalSec * 1000)} 回源一次）`);
      const intervalId = setInterval(async () => {
        await runGuardedBackgroundRefresh('Cron', `⏰ 触发后台定时更新（每 ${formatDuration(autoRefreshIntervalSec * 1000)}）`);
      }, autoRefreshIntervalSec * 1000);
      intervalId.unref?.();
      server.on('close', () => clearInterval(intervalId));
    }
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  hardenRemoteConfig,
  isLoopbackHost,
  safeTokenEqual,
  getClientIp,
  resolveClientIp,
  isHostAllowed,
  resolveRequestHosts,
  mapCacheStatusToHeader
};