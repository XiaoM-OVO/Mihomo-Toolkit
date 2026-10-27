/**
 * -----------------------------------------------------------------------------
 * 订阅与节点内容解析器统一入口 (Protocol Parsers Hub)
 * -----------------------------------------------------------------------------
 * 负责自动识别并解析 Base64 编码、多协议 URI 列表及标准 YAML 订阅配置。
 * 核心调度采用 Protocol Parser Registry 注册表设计模式，支持动态扩展协议。
 */

const yaml = require('yaml');
const { decodeBase64 } = require('./base64');
const {
  registerParser,
  getParser,
  hasParser,
  getRegisteredSchemes,
  parseUri,
  clearRegistry
} = require('./registry');

// 内置协议解析器
const { parseVlessUri } = require('./vless');
const { parseVmessUri } = require('./vmess');
const { parseTrojanUri } = require('./trojan');
const { parseSsUri } = require('./shadowsocks');
const { parseHysteria2Uri } = require('./hysteria2');
const { parseTuicUri } = require('./tuic');
const { parseSocksUri } = require('./socks');
const { parseHttpUri } = require('./http');

// 订阅元信息解析
const { parseSubscriptionInfo, evaluateExpiry, normalizeTimeZone, formatDateInZone, isExpiredNow, isQuotaExhausted } = require('../../infra/sub-info');

// 注册所有内置协议解析器
registerParser('vless', parseVlessUri);
registerParser('vmess', parseVmessUri);
registerParser('trojan', parseTrojanUri);
registerParser('ss', parseSsUri);
registerParser(['hysteria2', 'hy2'], parseHysteria2Uri);
registerParser('tuic', parseTuicUri);
registerParser(['socks5', 'socks'], parseSocksUri);
registerParser(['http', 'https'], parseHttpUri);

/**
 * 解析按行分割的多协议 URI 链接列表
 * @param {string} content
 * @returns {{ proxies: object[] } | null}
 */
function parseUriList(content) {
  if (!content || typeof content !== 'string') return null;
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const proxies = [];

  for (const line of lines) {
    const proxy = parseUri(line);
    if (proxy && proxy.server && proxy.port) {
      proxies.push(proxy);
    }
  }

  return proxies.length > 0 ? { proxies } : null;
}

/**
 * 动态检测文本是否以已注册的协议 scheme 开头
 * @param {string} text
 * @returns {boolean}
 */
function startsWithRegisteredScheme(text) {
  const match = text.match(/^([a-z0-9+-]+):\/\//i);
  if (!match) return false;
  return hasParser(match[1]);
}

/**
 * 字符特征预检：判断文本是否具备 Base64 编码特征。
 * - 机场 Base64 订阅纯粹由 Base64 字符（大小写字母、数字、+、/、=，或 URL-Safe 的 -、_）与空白换行构成；
 * - 若包含冒号(:)、花括号({})、方括号([])、引号、井号(#)、尖括号(<>)等字符，必然为明文（YAML/JSON/URI/HTML），
 *   直接跳过 Base64 尝试，消除 Node Buffer 盲解码及随后引发的二次解析异常开销。
 * @param {string} str
 * @returns {boolean}
 */
function isLikelyBase64(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (s.length < 8) return false;
  return !/[^A-Za-z0-9+/=\r\n\t _-]/.test(s);
}

/**
 * 自动识别并解析订阅正文内容 (支持 Plain URI, Base64 URI, Plain YAML, Base64 YAML)
 * @param {string} content
 * @returns {{ proxies: object[], [key: string]: any }}
 */
function parseContent(content) {
  if (!content || typeof content !== 'string') return { proxies: [] };
  const trimmed = content.trim();

  // 1. 快速路径：首行直接命中已注册的 URI 协议头
  if (startsWithRegisteredScheme(trimmed)) {
    try {
      const uriResult = parseUriList(content);
      if (uriResult) return uriResult;
    } catch {}
  }

  // 2. 结构化明文优先：若显式具备 JSON 或 YAML 典型头部特征，优先按 Plain YAML 解析
  const isStructuredPlain = trimmed.startsWith('{') ||
    trimmed.startsWith('---') ||
    /^(?:proxies|proxy-groups|rules|payload|port|mixed-port):/m.test(trimmed);

  if (isStructuredPlain) {
    try {
      const data = yaml.parse(trimmed);
      if (data && data.proxies && Array.isArray(data.proxies)) {
        return data;
      }
    } catch {}
  }

  // 3. Base64 编码路径：预检字符特征，仅对合规 Base64 串发起解码
  if (isLikelyBase64(trimmed)) {
    try {
      const decoded = decodeBase64(trimmed);
      if (decoded) {
        const decodedTrimmed = decoded.trim();
        // 3.1 尝试 Base64 内层为 YAML
        try {
          const data = yaml.parse(decodedTrimmed);
          if (data && data.proxies && Array.isArray(data.proxies)) {
            return data;
          }
        } catch {}

        // 3.2 尝试 Base64 内层为 URI 列表
        const uriResult = parseUriList(decodedTrimmed);
        if (uriResult) return uriResult;
      }
    } catch {}
  }

  // 4. 原生 Plain YAML 配置解析（非典型头部但合法 YAML 的保底兜底）
  if (!isStructuredPlain) {
    try {
      const data = yaml.parse(trimmed);
      if (data && data.proxies && Array.isArray(data.proxies)) {
        return data;
      }
    } catch {}
  }

  // 5. 原生 Plain URI 列表容错解析 (可能前几行存在注释或空白)
  try {
    const uriResult = parseUriList(trimmed);
    if (uriResult) return uriResult;
  } catch {}

  return { proxies: [] };
}

module.exports = {
  // Registry API
  registerParser,
  getParser,
  hasParser,
  getRegisteredSchemes,
  parseUri,
  clearRegistry,

  // 单协议解析器
  parseVlessUri,
  parseVmessUri,
  parseTrojanUri,
  parseSsUri,
  parseHysteria2Uri,
  parseTuicUri,
  parseSocksUri,
  parseHttpUri,

  // 批量与复合解析
  parseUriList,
  parseContent,
  isLikelyBase64,

  // 订阅元信息
  parseSubscriptionInfo,
  evaluateExpiry,
  normalizeTimeZone,
  formatDateInZone,
  isExpiredNow,
  isQuotaExhausted
};
