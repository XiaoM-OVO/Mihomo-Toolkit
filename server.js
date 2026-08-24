const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { buildProfile, redactUrl, isAllowedUrl, safeFetchText, validateRequestLimits } = require('./src/builder.js');

const PORT = process.env.PORT || 3000;
const CONFIG_PATH = process.env.CONFIG_PATH || path.resolve(__dirname, 'config.yaml');

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  
  if (reqUrl.pathname === '/healthz' || reqUrl.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'mihomo-toolkit-server',
      version: '1.4.0',
      uptime: Math.floor(process.uptime())
    }));
    return;
  }

  if (reqUrl.pathname === '/sub') {
    try {
      // 先加载本地配置文件获取 enableUrlParams 和 authToken 设置
      let localConfig = {};
      if (fs.existsSync(CONFIG_PATH)) {
        const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
        if (CONFIG_PATH.endsWith('.yaml') || CONFIG_PATH.endsWith('.yml')) {
          localConfig = yaml.parse(content) || {};
        } else {
          localConfig = JSON.parse(content);
        }
      }

      // 鉴权检查（支持 URL ?token=xxx 或 Header Authorization: Bearer xxx）
      const authToken = localConfig.authToken;
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

      const safeUrl = reqUrl.searchParams.getAll('url').length > 0
        ? `/sub?url=[${reqUrl.searchParams.getAll('url').length} subscriptions]`
        : (reqUrl.searchParams.get('config') ? `/sub?config=${redactUrl(reqUrl.searchParams.get('config'))}` : req.url);
      console.log(`[Server] Received request for ${safeUrl}`);

      let userConfig = { subscriptions: [] };
      const configUrl = reqUrl.searchParams.get('config');
      const subUrls = reqUrl.searchParams.getAll('url');

      const enableUrlParams = localConfig.enableUrlParams !== false;
      const securityLimits = localConfig.security || {};

      // 1) 早期快速拦截：?url= 数量超限（避免后续处理浪费）
      const urlLimitErr = validateRequestLimits({ subscriptionUrls: subUrls, limits: securityLimits });
      if (urlLimitErr) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Bad Request: ${urlLimitErr.message}`);
        return;
      }

      if (configUrl) {
        if (!enableUrlParams) throw new Error('URL params are disabled by enableUrlParams=false');
        // Fetch remote config.yaml using safe fetch with full SSRF protection
        if (!isAllowedUrl(configUrl)) throw new Error('Invalid or disallowed config URL');
        const { text: content } = await safeFetchText(configUrl);
        // 2) 远程 config 大小校验
        const sizeLimitErr = validateRequestLimits({ remoteConfigSize: Buffer.byteLength(content, 'utf-8'), limits: securityLimits });
        if (sizeLimitErr) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`Bad Request: ${sizeLimitErr.message}`);
          return;
        }
        userConfig = yaml.parse(content) || {};
      } else if (subUrls.length > 0) {
        if (!enableUrlParams) throw new Error('URL params are disabled by enableUrlParams=false');
        // Build config from ?url=...
        const blocked = subUrls.filter(u => !isAllowedUrl(u));
        if (blocked.length > 0) throw new Error(`Invalid or disallowed subscription URL(s): ${blocked.map(redactUrl).join(', ')}`);
        userConfig.subscriptions = subUrls.map(u => ({ url: u }));
      } else if (Object.keys(localConfig).length > 0) {
        // Use local config.yaml
        userConfig = localConfig;
      } else {
        console.warn(`[Server] ⚠️ config.yaml not found and no ?url= provided.`);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('[Server] ⚠️ config.yaml not found. Please create one, or use ?url= parameter.');
        return;
      }

      const debugMode = reqUrl.searchParams.get('debug') === '1';
      console.log(`[Server] Building profile... (debug=${debugMode})`);
      const { yamlStr, userInfo } = await buildProfile(userConfig, { production: true, debug: debugMode });

      const headers = {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Profile-Update-Interval': '24'
      };

      if (userInfo && userInfo.total > 0) {
        headers['Subscription-Userinfo'] = `upload=${userInfo.upload}; download=${userInfo.download}; total=${userInfo.total}; expire=${userInfo.expire}`;
      }

      res.writeHead(200, headers);
      res.end(yamlStr);
      console.log(`[Server] Successfully served profile. (Total: ${userInfo?.total || 0})`);
    } catch (err) {
      console.error(`[Server] Error:`, err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      // 不向客户端暴露内部错误细节,防止信息泄漏
      res.end(`Internal Server Error. Check server logs for details.`);
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found. Please request /sub');
  }
});

server.listen(PORT, () => {
  console.log(`[Server] Mihomo-Toolkit Local Server is running!`);
  console.log(`[Server] Add this URL to your Clash Verge Rev as a Remote Subscription:`);
  console.log(`[Server] http://127.0.0.1:${PORT}/sub`);
});
