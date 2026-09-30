/**
 * Hysteria2 节点链接解析器
 *
 * 解析 hysteria2:// 与 hy2:// 协议链接并转换为标准 Mihomo 节点对象。
 */

const { safeDecodeURIComponent, cleanHostname } = require('./base64');

function parseHysteria2Uri(uri) {
  try {
    let normalized = uri.trim();
    // 兼容 hy2:// 别名，将其统一为标准 URL 对象可解析的形式
    if (/^hy2:\/\//i.test(normalized)) {
      normalized = 'hysteria2://' + normalized.slice(6);
    }

    const url = new URL(normalized);
    let server = cleanHostname(url.hostname);
    const port = parseInt(url.port) || 443;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    // auth 密码解析：支持 password 或 username 作为 auth secret
    let password = '';
    if (url.username && url.password) {
      password = safeDecodeURIComponent(`${url.username}:${url.password}`);
    } else if (url.username) {
      password = safeDecodeURIComponent(url.username);
    } else if (url.password) {
      password = safeDecodeURIComponent(url.password);
    }

    const insecure = params.get('insecure');
    const skipCert = params.get('skip-cert-verify');
    const skipCertVerify = insecure === '1' || insecure === 'true' || skipCert === 'true' || skipCert === '1';

    const proxy = {
      name,
      type: 'hysteria2',
      server,
      port,
      password,
      'skip-cert-verify': skipCertVerify
    };

    if (params.get('sni')) {
      proxy.sni = params.get('sni');
    }

    const alpn = params.get('alpn');
    if (alpn) {
      proxy.alpn = alpn.split(',').map(s => s.trim()).filter(Boolean);
    }

    const obfs = params.get('obfs');
    if (obfs && obfs !== 'none') {
      proxy.obfs = obfs;
      const obfsPassword = params.get('obfs-password');
      if (obfsPassword) {
        proxy['obfs-password'] = safeDecodeURIComponent(obfsPassword);
      }
    }

    const ports = params.get('ports') || params.get('mport');
    if (ports) {
      proxy.ports = ports;
    }

    const up = params.get('up') || params.get('up_mbps');
    if (up) {
      proxy.up = /^\d+$/.test(up) ? `${up} Mbps` : up;
    }

    const down = params.get('down') || params.get('down_mbps');
    if (down) {
      proxy.down = /^\d+$/.test(down) ? `${down} Mbps` : down;
    }

    const fp = params.get('fp') || params.get('client-fingerprint');
    if (fp) {
      proxy['client-fingerprint'] = fp;
    }

    const fastOpen = params.get('fast-open') || params.get('fastopen');
    if (fastOpen === '1' || fastOpen === 'true') {
      proxy['fast-open'] = true;
    }

    return proxy;
  } catch {
    return null;
  }
}

module.exports = {
  parseHysteria2Uri
};
