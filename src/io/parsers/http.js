/**
 * HTTP / HTTPS 代理节点链接解析器
 *
 * 解析 http:// 与 https:// 代理协议链接并转换为标准 Mihomo 节点对象。
 */

const { safeDecodeURIComponent, cleanHostname } = require('./base64');

function parseHttpUri(uri) {
  try {
    const trimmed = uri.trim();
    const isHttps = /^https:\/\//i.test(trimmed);
    const url = new URL(trimmed);
    let server = cleanHostname(url.hostname);
    const defaultPort = isHttps ? 443 : 80;
    const port = parseInt(url.port) || defaultPort;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    let username = '';
    let password = '';
    if (url.username) username = safeDecodeURIComponent(url.username);
    if (url.password) password = safeDecodeURIComponent(url.password);

    const proxy = {
      name,
      type: 'http',
      server,
      port
    };

    if (username) proxy.username = username;
    if (password) proxy.password = password;

    const tls = isHttps || params.get('tls') === 'true' || params.get('tls') === '1';
    if (tls) {
      proxy.tls = true;
      if (params.get('sni')) {
        proxy.sni = params.get('sni');
      }
      if (params.get('skip-cert-verify') === 'true' || params.get('insecure') === '1') {
        proxy['skip-cert-verify'] = true;
      }
    }

    return proxy;
  } catch {
    return null;
  }
}

module.exports = {
  parseHttpUri
};
