/**
 * SOCKS5 节点链接解析器
 *
 * 解析 socks5:// 与 socks:// 协议链接并转换为标准 Mihomo 节点对象。
 */

const { safeDecodeURIComponent, decodeBase64UrlSafe, cleanHostname } = require('./base64');

function parseSocksUri(uri) {
  try {
    let normalized = uri.trim();
    if (/^socks:\/\//i.test(normalized)) {
      normalized = 'socks5://' + normalized.slice(8);
    }

    const url = new URL(normalized);
    let server = cleanHostname(url.hostname);
    const port = parseInt(url.port) || 1080;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    let username = '';
    let password = '';

    const rawUser = url.username;
    const rawPass = url.password;

    if (rawUser && rawPass) {
      username = safeDecodeURIComponent(rawUser);
      password = safeDecodeURIComponent(rawPass);
    } else if (rawUser) {
      const decodedUser = safeDecodeURIComponent(rawUser);
      if (decodedUser.includes(':')) {
        const [u, p] = decodedUser.split(':');
        username = u;
        password = p;
      } else {
        const b64 = decodeBase64UrlSafe(rawUser);
        if (b64 && b64.includes(':')) {
          const [u, p] = b64.split(':');
          username = u;
          password = p;
        } else {
          username = decodedUser;
        }
      }
    }

    const proxy = {
      name,
      type: 'socks5',
      server,
      port
    };

    if (username) proxy.username = username;
    if (password) proxy.password = password;

    const tls = params.get('tls') === '1' || params.get('tls') === 'true';
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
  parseSocksUri
};
