const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { buildProfile, redactUrl, isAllowedUrl } = require('./src/builder.js');

const PORT = process.env.PORT || 3000;
const CONFIG_PATH = process.env.CONFIG_PATH || path.resolve(__dirname, 'config.yaml');

async function fetchWithAuth(targetUrl) {
  const parsedUrl = new URL(targetUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const fetchOpts = { 
    headers: { 'User-Agent': 'clash-verge/v1.3.8' },
    signal: controller.signal
  };
  if (parsedUrl.username || parsedUrl.password) {
    const user = decodeURIComponent(parsedUrl.username);
    const pass = decodeURIComponent(parsedUrl.password);
    const auth = (typeof btoa !== 'undefined') 
      ? btoa(`${user}:${pass}`)
      : Buffer.from(`${user}:${pass}`).toString('base64');
    fetchOpts.headers['Authorization'] = `Basic ${auth}`;
    parsedUrl.username = '';
    parsedUrl.password = '';
  }
  try {
    return await fetch(parsedUrl.toString(), fetchOpts);
  } finally {
    clearTimeout(timeoutId);
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  
  if (reqUrl.pathname === '/sub') {
    try {
      const safeUrl = reqUrl.searchParams.getAll('url').length > 0
        ? `/sub?url=[${reqUrl.searchParams.getAll('url').length} subscriptions]`
        : (reqUrl.searchParams.get('config') ? `/sub?config=${redactUrl(reqUrl.searchParams.get('config'))}` : req.url);
      console.log(`[Server] Received request for ${safeUrl}`);
      
      let userConfig = { subscriptions: [] };
      const configUrl = reqUrl.searchParams.get('config');
      const subUrls = reqUrl.searchParams.getAll('url');
      
      // 先加载本地配置文件获取 enableUrlParams 设置
      let localConfig = {};
      if (fs.existsSync(CONFIG_PATH)) {
        const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
        if (CONFIG_PATH.endsWith('.yaml') || CONFIG_PATH.endsWith('.yml')) {
          localConfig = yaml.parse(content) || {};
        } else {
          localConfig = JSON.parse(content);
        }
      }
      const enableUrlParams = localConfig.enableUrlParams !== false;
      
      if (configUrl) {
        if (!enableUrlParams) throw new Error('URL params are disabled by enableUrlParams=false');
        // Fetch remote config.yaml
        if (!isAllowedUrl(configUrl)) throw new Error('Invalid or disallowed config URL');
        const configRes = await fetchWithAuth(configUrl);
        if (!configRes.ok) throw new Error(`Failed to fetch remote config: ${configRes.status}`);
        const content = await configRes.text();
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
