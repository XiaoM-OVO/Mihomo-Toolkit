/**
 * -----------------------------------------------------------------------------
 * Target: Cloudflare Worker 边缘函数入口
 * -----------------------------------------------------------------------------
 */

import { buildProfile } from '../pipeline/full';
import { safeFetchText } from '../io/fetcher';
import { isAllowedUrl } from '../io/ssrf';
import { validateRequestLimits } from '../io/limits';
import yaml from 'yaml';
import pkg from '../../package.json';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz' || url.pathname === '/ping') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'mihomo-toolkit-worker',
        version: pkg.version
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (url.pathname !== '/sub') {
      return new Response('Mihomo-Toolkit Worker is running. Request /sub?url=... or /sub?config=...', { status: 200 });
    }

    try {
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
      let securityLimits = {};
      if (env.SECURITY_LIMITS) {
        try {
          securityLimits = JSON.parse(env.SECURITY_LIMITS);
        } catch (e) {
          console.warn('[Worker] ⚠️ Failed to parse SECURITY_LIMITS environment variable as JSON:', e.message);
        }
      }

      const subUrls = url.searchParams.getAll('url');
      const urlLimitErr = validateRequestLimits({ subscriptionUrls: subUrls, limits: securityLimits });
      if (urlLimitErr) return new Response(`Bad Request: ${urlLimitErr.message}`, { status: 400 });

      const configUrl = url.searchParams.get('config');
      if (configUrl) {
        if (!enableUrlParams) return new Response('URL params are disabled (ENABLE_URL_PARAMS=false)', { status: 403 });
        if (!isAllowedUrl(configUrl)) return new Response('Invalid or disallowed config URL', { status: 400 });
        const { text: content } = await safeFetchText(configUrl);
        const sizeLimitErr = validateRequestLimits({ remoteConfigSize: new TextEncoder().encode(content).byteLength, limits: securityLimits });
        if (sizeLimitErr) return new Response(`Bad Request: ${sizeLimitErr.message}`, { status: 400 });
        userConfig = yaml.parse(content) || {};
      } else {
        if (subUrls.length > 0) {
          if (!enableUrlParams) return new Response('URL params are disabled (ENABLE_URL_PARAMS=false)', { status: 403 });
          const blocked = subUrls.filter(u => !isAllowedUrl(u));
          if (blocked.length > 0) return new Response('Invalid or disallowed subscription URL(s)', { status: 400 });
          userConfig.subscriptions = subUrls.map(u => ({ url: u }));
        } else if (env.DEFAULT_CONFIG_URL) {
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

      if (userInfo && (userInfo.total > 0 || userInfo.expire > 0)) {
        headers.set('Subscription-Userinfo', `upload=${userInfo.upload}; download=${userInfo.download}; total=${userInfo.total}; expire=${userInfo.expire}`);
      }

      return new Response(yamlStr, {
        status: 200,
        headers
      });
    } catch (err) {
      return new Response(`Worker Internal Error: ${err.message}`, { status: 500 });
    }
  }
};
