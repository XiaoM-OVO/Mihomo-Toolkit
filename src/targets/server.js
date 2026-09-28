/**
 * -----------------------------------------------------------------------------
 * Target: HTTP 订阅转换与策略构建服务端
 * -----------------------------------------------------------------------------
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { buildProfile } = require('../pipeline/full');
const { safeFetchText } = require('../io/fetcher');
const { isAllowedUrl, redactUrl } = require('../io/ssrf');
const { validateRequestLimits } = require('../io/limits');
const pkg = require('../../package.json');

function startServer(options = {}) {
  const PORT = options.port || process.env.PORT || 3000;
  const CONFIG_PATH = options.configPath || process.env.CONFIG_PATH || path.resolve(process.cwd(), 'config.yaml');

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

    if (reqUrl.pathname === '/healthz' || reqUrl.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'mihomo-toolkit-server',
        version: pkg.version,
        uptime: Math.floor(process.uptime())
      }));
      return;
    }

    if (reqUrl.pathname === '/sub') {
      try {
        let localConfig = {};
        if (fs.existsSync(CONFIG_PATH)) {
          const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
          if (CONFIG_PATH.endsWith('.yaml') || CONFIG_PATH.endsWith('.yml')) {
            localConfig = yaml.parse(content) || {};
          } else {
            localConfig = JSON.parse(content);
          }
        }

        const authToken = process.env.AUTH_TOKEN || localConfig.authToken;
        if (authToken) {
          const urlToken = reqUrl.searchParams.get('token');
          const headerAuth = req.headers['authorization'] || '';
          const bearerToken = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : '';
          const providedToken = urlToken || bearerToken;
          if (providedToken !== authToken) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Unauthorized: Invalid or missing token. Provide ?token=xxx or Authorization: Bearer xxx');
            return;
          }
        }

        let safeUrl = reqUrl.pathname;
        const safeParams = [];
        const subCount = reqUrl.searchParams.getAll('url').length;
        if (subCount > 0) safeParams.push(`url=[${subCount} subscriptions]`);
        if (reqUrl.searchParams.get('config')) safeParams.push(`config=${redactUrl(reqUrl.searchParams.get('config'))}`);
        if (reqUrl.searchParams.has('token')) safeParams.push('token=***');
        if (reqUrl.searchParams.has('debug')) safeParams.push(`debug=${reqUrl.searchParams.get('debug')}`);
        if (safeParams.length > 0) safeUrl += `?${safeParams.join('&')}`;
        console.log(`[Server] Received request for ${safeUrl}`);

        let userConfig = { subscriptions: [] };
        const configUrl = reqUrl.searchParams.get('config');
        const subUrls = reqUrl.searchParams.getAll('url');

        const enableUrlParams = localConfig.enableUrlParams !== false;
        const securityLimits = localConfig.security || {};

        const urlLimitErr = validateRequestLimits({ subscriptionUrls: subUrls, limits: securityLimits });
        if (urlLimitErr) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`Bad Request: ${urlLimitErr.message}`);
          return;
        }

        if (configUrl) {
          if (!enableUrlParams) throw new Error('URL params are disabled by enableUrlParams=false');
          if (!isAllowedUrl(configUrl)) throw new Error('Invalid or disallowed config URL');
          const { text: content } = await safeFetchText(configUrl);
          const sizeLimitErr = validateRequestLimits({ remoteConfigSize: Buffer.byteLength(content, 'utf-8'), limits: securityLimits });
          if (sizeLimitErr) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end(`Bad Request: ${sizeLimitErr.message}`);
            return;
          }
          userConfig = yaml.parse(content) || {};
        } else if (subUrls.length > 0) {
          if (!enableUrlParams) throw new Error('URL params are disabled by enableUrlParams=false');
          const blocked = subUrls.filter(u => !isAllowedUrl(u));
          if (blocked.length > 0) throw new Error(`Invalid or disallowed subscription URL(s): ${blocked.map(redactUrl).join(', ')}`);
          userConfig = { ...localConfig, subscriptions: subUrls.map(u => ({ url: u })) };
        } else if (Object.keys(localConfig).length > 0) {
          userConfig = localConfig;
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Bad Request: Please provide ?url=... or ?config=... or place a config.yaml in the working directory.');
          return;
        }

        const debugMode = reqUrl.searchParams.get('debug') === '1';
        const { yamlStr, userInfo } = await buildProfile(userConfig, { production: true, debug: debugMode });

        const headers = {
          'Content-Type': 'text/yaml; charset=utf-8',
          'Profile-Update-Interval': '24'
        };

        if (userInfo && (userInfo.total > 0 || userInfo.expire > 0)) {
          headers['Subscription-Userinfo'] = `upload=${userInfo.upload}; download=${userInfo.download}; total=${userInfo.total}; expire=${userInfo.expire}`;
        }

        res.writeHead(200, headers);
        res.end(yamlStr);
      } catch (err) {
        console.error('[Server] Build Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Server Internal Error: ${err.message}`);
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Mihomo-Toolkit Server is running.\n\nUsage:\n  /sub?url=<subscription_url>\n  /sub?config=<remote_config_url>\n');
  });

  server.listen(PORT, () => {
    console.log(`[Server] Mihomo-Toolkit Server listening on port ${PORT}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
