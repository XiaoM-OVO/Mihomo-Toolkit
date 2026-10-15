/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 结构化单节点声明处理器 (Direct Node Normalizer)
 * -----------------------------------------------------------------------------
 * 负责从 subscriptions 声明列表中安全识别并提取结构化单节点配置。
 * 遵循纯函数原则，将 Toolkit 流水线元属性（tag, keepName, dialerProxy, groups）
 * 与原生 Clash/Mihomo 代理节点属性进行干净解耦与规范化。
 */

/**
 * 订阅非代理属性黑名单（这些属于 Toolkit 流水线调度元数据，不应作为原生节点字段输出）
 */
const TOOLKIT_SUB_META_KEYS = new Set([
  'url',
  'uri',
  'enabled',
  'tag',
  'indexPrefix',
  'proxy',
  'retry',
  'resetDay',
  'keepName',
  'dialerProxy',
  'groups'
]);

/**
 * 判定订阅配置项是否为直接声明的单节点结构
 * 支持以下两种声明形式：
 * 1. 扁平声明：{ type: 'socks5', server: '...', port: 1080, ... }
 * 2. 嵌套代理：{ proxy: { type: 'socks5', server: '...', port: 1080, ... }, tag: '...' }
 *
 * @param {any} sub
 * @returns {boolean}
 */
function isDirectNodeSub(sub) {
  if (!sub || typeof sub !== 'object') return false;
  return Boolean((sub.server && sub.port) || (sub.proxy && typeof sub.proxy === 'object'));
}

/**
 * 解析链式代理前置节点名称 (dialerProxy 或 dialer-proxy)
 * @param {object} sub
 * @returns {string|null}
 */
function resolveDialerProxy(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const target = sub.dialerProxy || sub['dialer-proxy'];
  return target ? String(target) : null;
}

/**
 * 从结构化订阅配置项构建单节点对象
 * @param {object} sub
 * @returns {object|null}
 */
function buildDirectProxy(sub) {
  if (!sub || typeof sub !== 'object') return null;

  if (sub.proxy && typeof sub.proxy === 'object') {
    return { ...sub.proxy };
  }

  const p = {};
  for (const [key, value] of Object.entries(sub)) {
    if (!TOOLKIT_SUB_META_KEYS.has(key)) {
      p[key] = value;
    }
  }

  p.server = String(sub.server || '').trim();
  p.port = Number(sub.port);
  p.type = String(sub.type || 'socks5').toLowerCase();
  p.name = sub.name ? String(sub.name) : `${p.server}:${p.port}`;

  const dp = resolveDialerProxy(sub);
  if (dp) {
    p['dialer-proxy'] = dp;
  }

  return p;
}

/**
 * 判定是否保留节点原始名称 (不被模板改写)
 * 优先级规则：
 * 1. 显式声明 keepName 时严格按其布尔值执行；
 * 2. 未显式声明 keepName 时，若是直接声明的结构化节点且指定了 name，默认保护该命名不被改写。
 *
 * @param {object} sub
 * @returns {boolean}
 */
function resolveShouldKeepName(sub) {
  if (!sub || typeof sub !== 'object') return false;
  if (sub.keepName !== undefined) {
    return Boolean(sub.keepName);
  }
  return isDirectNodeSub(sub) && Boolean(sub.name);
}

/**
 * 推导订阅条目展示类型标识
 * @param {object} sub
 * @returns {'url'|'uri'|'node'}
 */
function resolveSubType(sub) {
  if (sub?.url) return 'url';
  if (sub?.uri) return 'uri';
  return 'node';
}

module.exports = {
  isDirectNodeSub,
  buildDirectProxy,
  resolveDialerProxy,
  resolveShouldKeepName,
  resolveSubType
};
