/**
 * -----------------------------------------------------------------------------
 * Core Layer: 占位与公告节点识别器 (Notice & Placeholder Node Detection)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 识别机场自带的原生流量公告、续费提示与到期通知节点 (isNoticeNode)
 * 2. 识别无网络服务能力的占位伪节点 (isNoticePlaceholderNode)
 * 3. 判定订阅返回列表是否全部为无效占位节点，防止失效订阅误判为成功 (hasOnlyPlaceholderNodes)
 *
 * 遵循洋葱模型 Core 层规范：纯函数设计、零副作用、确定性计算。
 */

const { isTrustedSynthetic } = require('./node-trust');
const {
  REGEX_INFO_NODE,
  REGEX_NOTICE_KEYWORD,
  REGEX_EXPLICIT_NOTICE,
  REGEX_FAKE_IPV4,
  REGEX_FAKE_IPV6
} = require('../data/cleaner-rules');

/**
 * 判定主机地址与端口是否为结构性无效/占位服务
 * @param {string} server
 * @param {number|string} [port]
 * @returns {boolean}
 */
function isFakeServerAddress(server, port) {
  const s = String(server || '').trim();
  const portNum = port != null && port !== '' ? Number(port) : null;
  const isFakePort = portNum === null || !Number.isInteger(portNum) || portNum <= 0 || portNum > 65535;
  const isFakeIp = !s
    || s === 'localhost'
    || REGEX_FAKE_IPV4.test(s)
    || REGEX_FAKE_IPV6.test(s);
  return !s || isFakePort || isFakeIp;
}

/**
 * 判定节点是否为原生公告/说明候选节点
 * @param {object} proxy 代理节点对象
 * @param {string} [rawName] 原始节点名称
 * @returns {boolean}
 */
function isNoticeNode(proxy, rawName) {
  if (!proxy || typeof proxy !== 'object') return false;
  if (isTrustedSynthetic(proxy)) return false;
  const name = rawName || proxy._rawName || proxy.name || '';
  if (!name) return false;

  // 1. 明确的纯流量/到期横幅标题 (无论挂在什么 server/port 下均判定为说明)
  if (REGEX_EXPLICIT_NOTICE.test(name)) return true;

  // 2. 一般公告/说明词必须同时伴随无效/占位网络参数，绝不误杀具备真实代理参数的节点
  const isNotice = REGEX_INFO_NODE.test(name) || REGEX_NOTICE_KEYWORD.test(name);
  if (!isNotice) return false;

  return isFakeServerAddress(proxy.server, proxy.port);
}

/**
 * 判定单个节点是否为显而易见的无服务能力占位/提示节点
 * 仅用于订阅有效性前置拦截（防止“续费/到期/公告”占位节点把失效订阅误判为成功）
 * 必须结合“假IP/假端口/无真实代理特征”与“提示性名称”双重特征，绝不误杀真实节点
 * @param {object} proxy
 * @returns {boolean}
 */
function isNoticePlaceholderNode(proxy) {
  if (!proxy || typeof proxy !== 'object') return false;
  if (isTrustedSynthetic(proxy)) return false;
  const rawName = proxy._rawName || proxy.name || '';
  const isFakeServer = isFakeServerAddress(proxy.server, proxy.port);
  const isNoticeName = REGEX_EXPLICIT_NOTICE.test(rawName)
    || REGEX_INFO_NODE.test(rawName)
    || REGEX_NOTICE_KEYWORD.test(rawName);

  return isFakeServer && isNoticeName;
}

/**
 * 判定订阅返回的节点列表是否全部为占位/提示节点（即无任何有效可用节点）
 * @param {Array<object>} proxies
 * @returns {boolean}
 */
function hasOnlyPlaceholderNodes(proxies) {
  if (!Array.isArray(proxies) || proxies.length === 0) return true;
  return proxies.every(p => isNoticePlaceholderNode(p));
}

module.exports = {
  isFakeServerAddress,
  isNoticeNode,
  isNoticePlaceholderNode,
  hasOnlyPlaceholderNodes
};
