/**
 * 订阅内容解析器统一入口
 *
 * 自动识别并解析 Base64、多协议 URI 列表及 YAML 配置。
 */

const yaml = require('yaml');
const { decodeBase64 } = require('./base64');
const { parseVlessUri } = require('./vless');
const { parseVmessUri } = require('./vmess');
const { parseTrojanUri } = require('./trojan');
const { parseSsUri } = require('./shadowsocks');
const { parseSubscriptionInfo, isExpiredNow } = require('./sub-info');

function parseUriList(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  const proxies = [];

  for (const line of lines) {
    let proxy = null;
    if (/^vless:\/\//i.test(line)) {
      proxy = parseVlessUri(line);
    } else if (/^vmess:\/\//i.test(line)) {
      proxy = parseVmessUri(line);
    } else if (/^trojan:\/\//i.test(line)) {
      proxy = parseTrojanUri(line);
    } else if (/^ss:\/\//i.test(line)) {
      proxy = parseSsUri(line);
    }
    if (proxy && proxy.server && proxy.port) {
      proxies.push(proxy);
    }
  }

  return proxies.length > 0 ? { proxies } : null;
}

function parseContent(content) {
  if (!content || typeof content !== 'string') return { proxies: [] };

  // 快速路径：直接 URI 列表（vless://, vmess://, trojan://, ss://）
  if (/^(vless|vmess|trojan|ss):\/\//im.test(content.trim())) {
    try {
      const uriResult = parseUriList(content);
      if (uriResult) return uriResult;
    } catch (e) {}
  }

  // Try Base64 decode first as most subscriptions are base64 encoded
  try {
    const decoded = decodeBase64(content);
    if (decoded) {
      const data = yaml.parse(decoded);
      if (data && data.proxies && Array.isArray(data.proxies)) {
        return data;
      }
      const uriResult = parseUriList(decoded);
      if (uriResult) return uriResult;
    }
  } catch (e) {}

  // Fallback to plain YAML parse
  try {
    const data = yaml.parse(content);
    if (data && data.proxies && Array.isArray(data.proxies)) {
      return data;
    }
  } catch (e) {}

  // Fallback to URI list parse
  try {
    const uriResult = parseUriList(content);
    if (uriResult) return uriResult;
  } catch (e) {}

  return { proxies: [] };
}

module.exports = {
  parseVlessUri,
  parseVmessUri,
  parseTrojanUri,
  parseSsUri,
  parseUriList,
  parseContent,
  parseSubscriptionInfo,
  isExpiredNow
};
