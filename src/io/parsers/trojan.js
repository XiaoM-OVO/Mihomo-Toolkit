/**
 * Trojan 节点链接解析器
 *
 * 解析标准 trojan:// 链接并转换为 Mihomo 节点对象。
 */

const { safeDecodeURIComponent, cleanHostname } = require('./base64');

function parseTrojanUri(uri) {
  try {
    const url = new URL(uri);
    const password = url.username;
    const server = cleanHostname(url.hostname);
    const port = parseInt(url.port) || 443;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    const proxy = {
      name,
      type: 'trojan',
      server,
      port,
      password,
      tls: true,
      'skip-cert-verify': false
    };

    if (params.get('sni')) proxy.sni = params.get('sni');
    if (params.get('alpn')) {
      proxy.alpn = params.get('alpn').split(',').map(s => s.trim());
    }
    proxy['client-fingerprint'] = params.get('fp') || 'chrome';

    const network = params.get('type') || 'tcp';
    if (network !== 'tcp') proxy.network = network;

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
    }

    return proxy;
  } catch {
    return null;
  }
}

module.exports = {
  parseTrojanUri
};
