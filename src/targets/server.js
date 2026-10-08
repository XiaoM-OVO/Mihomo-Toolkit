/**
 * -----------------------------------------------------------------------------
 * Target: HTTP 订阅转换与策略构建服务端
 * -----------------------------------------------------------------------------
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('yaml');
const { buildProfile, normalizeOutputMode } = require('../pipeline/engine');
const { createLogger } = require('../core/logger');
const { safeFetchText } = require('../io/fetcher');
const { isAllowedUrl, redactUrl } = require('../io/ssrf');
const { validateRequestLimits, DEFAULT_REQUEST_LIMITS } = require('../io/limits');
const { hardenRemoteConfig } = require('../core/security/remote-config');
const { absolutizeMountPaths } = require('../config/mounts');
const { expandIncludes } = require('../config/include');
const pkg = require('../../package.json');

/** 回环地址判定（仅这些地址可视为「本机可信接入」） */
function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || /^127\./.test(h);
}

/** 恒定时间字符串比较，避免 Token 被逐字节时序探测 */
function safeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch (e) {
    return false;
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

function startServer(options = {}) {
  const PORT = options.port || process.env.PORT || 3000;
  // 默认仅监听回环：常驻服务承载「可发起外部请求 + 可读取本地订阅文件」的能力，
  // 默认暴露到全网卡会让局域网/公网直接获得一个开放订阅中继。
  const HOST = options.host || process.env.HOST || '127.0.0.1';
  const CONFIG_PATH = options.configPath || process.env.CONFIG_PATH || path.resolve(process.cwd(), 'config.yaml');

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
    const parsed = (CONFIG_PATH.endsWith('.yaml') || CONFIG_PATH.endsWith('.yml'))
      ? (yaml.parse(content) || {})
      : JSON.parse(content);
    const absolutized = absolutizeMountPaths(parsed, path.dirname(CONFIG_PATH));
    // 与 CLI 对齐：在装载现场展开 include 片段，使 server 自身在 buildProfile 之前读取的
    // authToken / maxConcurrentBuilds / security / logLevel 等字段也能来自片段。
    // engine 入口还有一次幂等兜底展开。基准目录 = 配置文件所在目录。
    return expandIncludes(absolutized, path.dirname(CONFIG_PATH));
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
        options.logger.error(`❌ 配置文件无法解析 ${CONFIG_PATH}: ${e.message}`);
      } else {
        console.error(`❌ [Server] 配置文件无法解析 ${CONFIG_PATH}: ${e.message}`);
      }
      throw e;
    }
  }

  const serverLogger = (options.logger && typeof options.logger.child === 'function')
    ? options.logger
    : createLogger({
        tag: 'Server',
        level: options.debug ? 'debug' : (localConfig.logLevel || 'info')
      });

  // 安全姿态：监听面是否回环 + 启动时是否已配置鉴权
  const BOUND_LOOPBACK = isLoopbackHost(HOST);
  const authTokenAtStartup = process.env.AUTH_TOKEN || localConfig.authToken || '';
  const MAX_CONCURRENT_BUILDS = Number(localConfig.maxConcurrentBuilds) > 0
    ? Number(localConfig.maxConcurrentBuilds)
    : 8;
  let activeBuilds = 0;
  const lastRefreshTimes = new Map();

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

    if (reqUrl.pathname === '/healthz' || reqUrl.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'Mihomo-Toolkit',
        version: pkg.version,
        uptime: Math.floor(process.uptime())
      }));
      return;
    }

    if (reqUrl.pathname === '/sub' || reqUrl.pathname === '/') {
      // 并发上限：单次构建会触发多个外部抓取与全量拓扑计算，不设限可被轻易打满
      if (activeBuilds >= MAX_CONCURRENT_BUILDS) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5' });
        res.end('Service Unavailable: too many concurrent builds, please retry later.');
        return;
      }
      activeBuilds++;
      try {
        // 允许实时读取配置文件热重载（基于 mtime 校验，避免无变更时反复全量解析 YAML）；
        // 解析失败时保住上一份有效配置并显式告警
        if (fs.existsSync(CONFIG_PATH)) {
          try {
            const stat = fs.statSync(CONFIG_PATH);
            if (stat.mtimeMs !== lastConfigMtime) {
              localConfig = readLocalConfig();
              lastConfigMtime = stat.mtimeMs;
            }
          } catch (e) {
            serverLogger.error(`❌ 配置文件热重载失败，继续使用上一份有效配置: ${e.message}`);
          }
        }

        const clientIp = getClientIp(req);
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

        serverLogger.info(`🌐 收到订阅请求: ${safeUrl} 来自 ${clientIp}`);
        if (localConfig.logLevel === 'debug' || reqUrl.searchParams.has('debug')) {
          serverLogger.debug(`🔍 客户端信息: ${clientIp} | User-Agent: ${userAgent}`);
        }

        const authToken = process.env.AUTH_TOKEN || localConfig.authToken;
        if (authToken) {
          const urlToken = reqUrl.searchParams.get('token');
          const headerAuth = req.headers['authorization'] || '';
          const bearerToken = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : '';
          const providedToken = urlToken || bearerToken;
          if (!safeTokenEqual(providedToken, authToken)) {
            serverLogger.warn(`🛑 拒绝未授权访问: ${safeUrl} 来自 ${clientIp}`);
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Unauthorized: Invalid or missing token. Provide ?token=xxx or Authorization: Bearer xxx');
            return;
          }
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
          if (!isAllowedUrl(configUrl)) {
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
          hardened.strippedKeys.forEach(k => serverLogger.warn(`🛡️ 远程配置不可信: 已忽略字段 ${k}`));
        } else if (subUrls.length > 0) {
          if (!paramsAllowed) {
            rejectParams();
            return;
          }
          const blocked = subUrls.filter(u => !isAllowedUrl(u));
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
            serverLogger.info(`⏳ 频繁刷新拦截: 处于防爆盾冷却期中 (剩余 ${remainingSec}s)，直接响应最新缓存 <- ${clientIp}`);
            forceRefresh = false;
          } else {
            lastRefreshTimes.set(refreshKey, now);
            if (lastRefreshTimes.size > 200) {
              lastRefreshTimes.clear();
              lastRefreshTimes.set(refreshKey, now);
            }
            forceRefresh = true;
            serverLogger.info(`🔄 收到强制刷新请求 (?refresh=1)，绕过本地缓存向远端重新拉取 <- ${clientIp}`);
          }
        }

        const outputMode = normalizeOutputMode(reqUrl.searchParams.get('mode') || userConfig.outputMode);
        const buildLogger = serverLogger.child('Server');
        const result = await buildProfile(userConfig, {
          production: true,
          debug: debugMode,
          mode: outputMode,
          forceRefresh,
          logger: buildLogger
        });
        const { yamlStr, userInfo } = result;

        const isReport = outputMode === 'report';
        const headers = {
          'Content-Type': isReport ? 'application/json; charset=utf-8' : 'text/yaml; charset=utf-8',
          'Profile-Update-Interval': '24',
          // 订阅卡片「主页」按钮：Clash Verge Rev 等客户端只读响应头、不读文件体注释，
          // 缺了它远程订阅模式下按钮永不出现（文件体里的同名注释对这些客户端无效）。
          'Profile-Web-Page-Url': 'https://github.com/XiaoM-OVO/Mihomo-Toolkit',
          'Server': `Mihomo-Toolkit/v${pkg.version}`
        };

        if (userInfo && (userInfo.total > 0 || userInfo.expire > 0)) {
          headers['Subscription-Userinfo'] = `upload=${userInfo.upload}; download=${userInfo.download}; total=${userInfo.total}; expire=${userInfo.expire}`;
        }

        res.writeHead(200, headers);
        res.end(isReport && result.report ? JSON.stringify(result.report, null, 2) : yamlStr);
      } catch (err) {
        // 仅记录日志，不回显内部错误细节（避免泄漏本地路径、上游状态等实现信息）
        serverLogger.error(`❌ 配置构建异常: ${err.message}`);
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

  server.listen(PORT, HOST, () => {
    serverLogger.info(`🛠️ Mihomo-Toolkit v${pkg.version} 服务已就绪，监听于 http://${HOST}:${PORT}`);
    if (!BOUND_LOOPBACK) {
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
        try {
          serverLogger.info('🔥 服务已启动，正在后台静默预热初始订阅缓存...');
          const warmLogger = serverLogger.child('Warmup');
          await buildProfile(localConfig, {
            production: true,
            forceRefresh: true,
            logger: warmLogger
          });
          serverLogger.info('✨ 初始缓存预热完成');
        } catch (err) {
          serverLogger.warn(`⚠️ 初始缓存预热失败 (不影响服务运行): ${err.message}`);
        }
      });
    }

    const autoRefreshIntervalSec = Number(options.autoRefreshInterval ?? localConfig.autoRefreshInterval) || 0;
    if (autoRefreshIntervalSec > 0 && hasLocalSubs) {
      serverLogger.info(`⏰ 已启用后台自动轮询更新 (每 ${autoRefreshIntervalSec}s 静默拉取一次)`);
      const intervalId = setInterval(async () => {
        try {
          serverLogger.info(`⏰ 触发后台定时静默更新 (每 ${autoRefreshIntervalSec}s)...`);
          const cronLogger = serverLogger.child('Cron');
          await buildProfile(localConfig, {
            production: true,
            forceRefresh: true,
            logger: cronLogger
          });
          serverLogger.info('✅ 后台定时更新完成，新缓存已就绪');
        } catch (err) {
          serverLogger.warn(`⚠️ 后台定时更新异常 (保留当前有效缓存): ${err.message}`);
        }
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

module.exports = { startServer, hardenRemoteConfig, isLoopbackHost, safeTokenEqual, getClientIp };