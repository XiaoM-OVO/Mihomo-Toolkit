import { buildProfile, isAllowedUrl, safeFetchText, validateRequestLimits } from './src/builder.js';
import yaml from 'yaml'; // Requires esbuild/wrangler to bundle

// Set DEFAULT_CONFIG_URL in Cloudflare Workers Environment Variables
// to use a remote config.yaml without passing ?config= every time.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz' || url.pathname === '/ping') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'mihomo-toolkit-worker',
        version: '1.4.0'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (url.pathname !== '/sub') {
      return new Response('Mihomo-Toolkit Worker is running. Request /sub?url=... or /sub?config=...', { status: 200 });
    }

    try {
      // 鉴权检查（支持 URL ?token=xxx 或 Header Authorization: Bearer xxx）
      const authToken = env.AUTH_TOKEN;
      if (authToken) {
        const urlToken = url.searchParams.get('token');
        const headerAuth = request.headers.get('Authorization') || '';
        const bearerToken = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : '';
        const providedToken = urlToken || bearerToken;
        if (providedToken !== authToken) {
          return new Response('Unauthorized: Invalid or missing token. Provide ?token=xxx or Authorization: Bearer xxx', { status: 401 });
        }
      }

      let userConfig = {
        subscriptions: []
      };

      const enableUrlParams = env.ENABLE_URL_PARAMS !== 'false';
      // 资源限制：Worker 端通过 SECURITY_LIMITS 环境变量以 JSON 传入，如 '{"maxSubscriptionUrls":20,"maxTotalNodes":5000}'
      let securityLimits = {};
      if (env.SECURITY_LIMITS) {
        try { securityLimits = JSON.parse(env.SECURITY_LIMITS); } catch (e) { /* ignore */ }
      }

      // 1) 早期快速拦截：?url= 数量超限
      const subUrls = url.searchParams.getAll('url');
      const urlLimitErr = validateRequestLimits({ subscriptionUrls: subUrls, limits: securityLimits });
      if (urlLimitErr) return new Response(`Bad Request: ${urlLimitErr.message}`, { status: 400 });

      // Support ?config=https://...
      const configUrl = url.searchParams.get('config');
      if (configUrl) {
        if (!enableUrlParams) return new Response('URL params are disabled (ENABLE_URL_PARAMS=false)', { status: 403 });
        if (!isAllowedUrl(configUrl)) return new Response('Invalid or disallowed config URL', { status: 400 });
        const { text: content } = await safeFetchText(configUrl);
        // 2) 远程 config 大小校验
        const sizeLimitErr = validateRequestLimits({ remoteConfigSize: new TextEncoder().encode(content).byteLength, limits: securityLimits });
        if (sizeLimitErr) return new Response(`Bad Request: ${sizeLimitErr.message}`, { status: 400 });
        userConfig = yaml.parse(content) || {};
      } else {
        // Support ?url=...&url=...
        if (subUrls.length > 0) {
          if (!enableUrlParams) return new Response('URL params are disabled (ENABLE_URL_PARAMS=false)', { status: 403 });
          const blocked = subUrls.filter(u => !isAllowedUrl(u));
          if (blocked.length > 0) return new Response('Invalid or disallowed subscription URL(s)', { status: 400 });
          userConfig.subscriptions = subUrls.map(u => ({ url: u }));
        } else if (env.DEFAULT_CONFIG_URL) {
          // Support Environment Variable
          if (!isAllowedUrl(env.DEFAULT_CONFIG_URL)) return new Response('Invalid or disallowed DEFAULT_CONFIG_URL', { status: 400 });
          const { text: content } = await safeFetchText(env.DEFAULT_CONFIG_URL);
          const sizeLimitErr = validateRequestLimits({ remoteConfigSize: new TextEncoder().encode(content).byteLength, limits: securityLimits });
          if (sizeLimitErr) return new Response(`Bad Request: ${sizeLimitErr.message}`, { status: 400 });
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
