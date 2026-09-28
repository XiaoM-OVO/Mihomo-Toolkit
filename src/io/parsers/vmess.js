/**
 * VMess 节点链接解析器
 *
 * 解析 vmess:// Base64 JSON 链接并转换为 Mihomo 节点对象。
 */

const { decodeBase64UrlSafe } = require('./base64');

function parseVmessUri(uri) {
  try {
    const base64Part = uri.replace(/^vmess:\/\//i, '').trim();
    const jsonStr = decodeBase64UrlSafe(base64Part);
    if (!jsonStr) return null;
    const data = JSON.parse(jsonStr);

    const proxy = {
      name: data.ps || `${data.add}:${data.port}`,
      type: 'vmess',
      server: data.add,
      port: parseInt(data.port) || 443,
      uuid: data.id,
      alterId: parseInt(data.aid) || 0,
      cipher: data.scy || 'auto',
      tls: data.tls === 'tls',
      'skip-cert-verify': false
    };

    if (proxy.tls && data.sni) {
      proxy.servername = data.sni;
    }
    if (data.alpn) proxy.alpn = data.alpn.split(',').map(s => s.trim());
    if (data.fp) proxy['client-fingerprint'] = data.fp;

    const network = data.net || 'tcp';
    proxy.network = network;

    if (network === 'ws') {
      proxy['ws-opts'] = {
        path: data.path || '/',
        headers: {}
      };
      if (data.host) proxy['ws-opts'].headers.Host = data.host;
    } else if (network === 'grpc') {
      proxy['grpc-opts'] = {
        'grpc-service-name': data.path || ''
      };
    } else if (network === 'h2' || network === 'http') {
      proxy.network = 'h2';
      proxy['h2-opts'] = {
        host: data.host ? [data.host] : [],
        path: data.path || '/'
      };
    }

    return proxy;
  } catch {
    return null;
  }
}

module.exports = {
  parseVmessUri
};
