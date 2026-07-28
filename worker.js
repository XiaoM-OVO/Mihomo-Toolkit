import { buildProfile, isAllowedUrl } from './src/builder.js';
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

      const enableUrlParams = env.ENABLE_URL_PARAMS !== 'false';

      // Support ?config=https://...
      const configUrl = url.searchParams.get('config');
      if (configUrl) {
        if (!enableUrlParams) return new Response('URL params are disabled (ENABLE_URL_PARAMS=false)', { status: 403 });
        if (!isAllowedUrl(configUrl)) return new Response('Invalid or disallowed config URL', { status: 400 });
        const configRes = await fetchWithAuth(configUrl);
        if (!configRes.ok) throw new Error(`Failed to fetch remote config: ${configRes.status}`);
        const content = await configRes.text();
        userConfig = yaml.parse(content) || {};
      } else {
        // Support ?url=...&url=...
        const subUrls = url.searchParams.getAll('url');
        if (subUrls.length > 0) {
          if (!enableUrlParams) return new Response('URL params are disabled (ENABLE_URL_PARAMS=false)', { status: 403 });
          const blocked = subUrls.filter(u => !isAllowedUrl(u));
          if (blocked.length > 0) return new Response('Invalid or disallowed subscription URL(s)', { status: 400 });
          userConfig.subscriptions = subUrls.map(u => ({ url: u }));
        } else if (env.DEFAULT_CONFIG_URL) {
          // Support Environment Variable
          if (!isAllowedUrl(env.DEFAULT_CONFIG_URL)) return new Response('Invalid or disallowed DEFAULT_CONFIG_URL', { status: 400 });
          const configRes = await fetchWithAuth(env.DEFAULT_CONFIG_URL);
          if (!configRes.ok) throw new Error(`Failed to fetch DEFAULT_CONFIG_URL: ${configRes.status}`);
          const content = await configRes.text();
          userConfig = yaml.parse(content) || {};
        } else {
          return new Response('Error: Please provide ?url=... or ?config=...', { status: 400 });
        }
      }

      const debugMode = url.searchParams.get('debug') === '1';
      const { yamlStr, userInfo } = await buildProfile(userConfig, { production: true, debug: debugMode });

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
