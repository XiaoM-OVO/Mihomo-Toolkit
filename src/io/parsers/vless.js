/**
 * VLESS 节点链接解析器
 *
 * 解析标准 vless:// 链接并转换为 Mihomo 节点对象。
 */

const { safeDecodeURIComponent, cleanHostname } = require('./base64');

function parseVlessUri(uri) {
  try {
    const url = new URL(uri);
    const uuid = url.username;
    const server = cleanHostname(url.hostname);
    const port = parseInt(url.port) || 443;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    const proxy = {
      name,
      type: 'vless',
      server,
      port,
      uuid,
      tls: params.get('tls') === 'tls' || params.get('security') === 'tls',
      'skip-cert-verify': false
    };

    const security = params.get('security') || '';
    if (security === 'reality') {
      proxy.tls = true;
      proxy['reality-opts'] = {
        'public-key': params.get('pbk') || '',
        'short-id': params.get('sid') || ''
      };
      if (params.get('sni')) {
        proxy.servername = params.get('sni');
      }
      proxy['client-fingerprint'] = params.get('fp') || 'chrome';
    } else if (proxy.tls) {
      if (params.get('sni')) {
        proxy.servername = params.get('sni');
      }
      if (params.get('fp')) {
        proxy['client-fingerprint'] = params.get('fp');
      }
      if (params.get('alpn')) {
        proxy.alpn = params.get('alpn').split(',').map(s => s.trim());
      }
    }

    const network = params.get('type') || 'tcp';
    proxy.network = network;

    if (network === 'ws') {
      proxy['ws-opts'] = {
        path: params.get('path') || '/',
        headers: {}
      };
      if (params.get('host')) proxy['ws-opts'].headers.Host = params.get('host');
    } else if (network === 'grpc') {
      proxy['grpc-opts'] = {
        'grpc-service-name': params.get('serviceName') || ''
      };
      if (params.get('mode')) proxy['grpc-opts'].mode = params.get('mode');
    } else if (network === 'h2' || network === 'http') {
      proxy.network = 'h2';
      proxy['h2-opts'] = {
        host: params.get('host') ? [params.get('host')] : [],
        path: params.get('path') || '/'
      };
    } else if (network === 'httpupgrade') {
      proxy.network = 'httpupgrade';
      proxy['httpupgrade-opts'] = {
        path: params.get('path') || '/',
        headers: {}
      };
      if (params.get('host')) proxy['httpupgrade-opts'].headers.Host = params.get('host');
    }

    if (params.get('flow')) proxy.flow = params.get('flow');

    return proxy;
  } catch {
    return null;
  }
}

module.exports = {
  parseVlessUri
};
