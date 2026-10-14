/**
 * Shadowsocks 节点链接解析器
 *
 * 解析 SIP002 / SIP001 规范的 ss:// 链接并转换为 Mihomo 节点对象。
 */

const { decodeBase64UrlSafe, safeDecodeURIComponent } = require('./base64');

function parseSsUri(uri) {
  try {
    let normalizedUri = uri.trim();
    // 兼容老旧 SIP001 格式: ss://BASE64(method:password@hostname:port)#name
    // 若 ss:// 到 # 或 ? 之间不包含 @ 符号，则整段是 Base64 编码的主体
    const match = normalizedUri.match(/^ss:\/\/([^?#]+)(.*)$/i);
    if (match) {
      const body = match[1];
      const rest = match[2] || '';
      if (!body.includes('@')) {
        const decodedBody = decodeBase64UrlSafe(body);
        if (decodedBody && decodedBody.includes('@')) {
          normalizedUri = `ss://${decodedBody}${rest}`;
        }
      }
    }

    const url = new URL(normalizedUri);
    let method = '', password = '';
    const user = safeDecodeURIComponent(url.username);
    const pass = url.password;

    if (user && pass) {
      method = safeDecodeURIComponent(user).replace(/[\r\n\x00-\x1F]/g, '').trim();
      password = safeDecodeURIComponent(pass).replace(/[\r\n\x00-\x1F]/g, '').trim();
    } else if (user && user.includes(':')) {
      const firstColon = user.indexOf(':');
      method = user.slice(0, firstColon).replace(/[\r\n\x00-\x1F]/g, '').trim();
      password = safeDecodeURIComponent(user.slice(firstColon + 1)).replace(/[\r\n\x00-\x1F]/g, '').trim();
    } else {
      const decoded = decodeBase64UrlSafe(user);
      if (decoded && decoded.includes(':')) {
        const firstColon = decoded.indexOf(':');
        method = decoded.slice(0, firstColon).replace(/[\r\n\x00-\x1F]/g, '').trim();
        password = decoded.slice(firstColon + 1).replace(/[\r\n\x00-\x1F]/g, '').trim();
      } else {
        return null;
      }
    }

    let server = url.hostname;
    if (server.startsWith('[') && server.endsWith(']')) {
      server = server.slice(1, -1);
    }
    const port = parseInt(url.port) || 443;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    const proxy = {
      name,
      type: 'ss',
      server,
      port,
      cipher: method,
      password
    };

    let plugin = params.get('plugin');
    if (plugin) {
      const pluginOpts = {};
      let pluginOptsStr = params.get('plugin-opts') || '';
      if (!pluginOptsStr && plugin.includes(';')) {
        const parts = plugin.split(';');
        plugin = parts[0];
        pluginOptsStr = parts.slice(1).join(';');
      }
      if (pluginOptsStr) {
        pluginOptsStr.split(';').forEach(p => {
          if (!p) return;
          const firstEq = p.indexOf('=');
          if (firstEq === -1) {
            const k = p.trim();
            if (k) pluginOpts[k] = '';
          } else {
            const k = p.slice(0, firstEq).trim();
            const v = p.slice(firstEq + 1).trim();
            if (k) pluginOpts[k] = safeDecodeURIComponent(v);
          }
        });
      }
      proxy.plugin = plugin;
      proxy['plugin-opts'] = pluginOpts;
    }

    return proxy;
  } catch {
    return null;
  }
}

module.exports = {
  parseSsUri
};
