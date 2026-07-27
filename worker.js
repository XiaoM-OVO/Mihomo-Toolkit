import { buildProfile } from './src/builder.js';
import yaml from 'yaml'; // Requires esbuild/wrangler to bundle

// Set DEFAULT_CONFIG_URL in Cloudflare Workers Environment Variables
// to use a remote config.yaml without passing ?config= every time.

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

function isAllowedUrl(urlStr) {
  const parsed = new URL(urlStr);
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname;
  if (/^(localhost|127\.|0\.0\.0\.0|::1$)/.test(host)) return false;
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)) return false;
  return true;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== '/sub') {
      return new Response('Mihomo-Toolkit Worker is running. Request /sub?url=... or /sub?config=...', { status: 200 });
    }

    try {
      let userConfig = {
        subscriptions: []
      };

      // Support ?config=https://...
      const configUrl = url.searchParams.get('config');
      if (configUrl) {
        if (!isAllowedUrl(configUrl)) return new Response('Invalid or disallowed config URL', { status: 400 });
        const configRes = await fetchWithAuth(configUrl);
        if (!configRes.ok) throw new Error(`Failed to fetch remote config: ${configRes.status}`);
        const content = await configRes.text();
        userConfig = yaml.parse(content) || {};
      } else {
        // Support ?url=...&url=...
        const subUrls = url.searchParams.getAll('url');
        if (subUrls.length > 0) {
          userConfig.subscriptions = subUrls.map(u => ({ url: u }));
        } else if (env.DEFAULT_CONFIG_URL) {
          // Support Environment Variable
          const configRes = await fetchWithAuth(env.DEFAULT_CONFIG_URL);
          if (!configRes.ok) throw new Error(`Failed to fetch DEFAULT_CONFIG_URL: ${configRes.status}`);
          const content = await configRes.text();
          userConfig = yaml.parse(content) || {};
        } else {
          return new Response('Error: Please provide ?url=... or ?config=...', { status: 400 });
        }
      }

      const { yamlStr, userInfo } = await buildProfile(userConfig, { production: true });

      const headers = new Headers({
        'Content-Type': 'text/yaml; charset=utf-8',
        'Profile-Update-Interval': '24'
      });

      if (userInfo && userInfo.total > 0) {
        headers.set('Subscription-Userinfo', `upload=${userInfo.upload}; download=${userInfo.download}; total=${userInfo.total}; expire=${userInfo.expire}`);
      }

      return new Response(yamlStr, { headers });

    } catch (err) {
      console.error(`[Worker] Error:`, err.message);
      return new Response('Internal Server Error. Check worker logs for details.', { status: 500 });
    }
  }
};
