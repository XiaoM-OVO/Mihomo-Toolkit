/**
 * -----------------------------------------------------------------------------
 * Protocol Parser Registry (协议解析器注册表)
 * -----------------------------------------------------------------------------
 * 集中管理节点链接 URI 解析器，提供统一的注册、查询与分发机制。
 * 支持灵活扩展自定义协议方案，消除顶层冗长的 if-else 硬编码。
 */

/** @type {Map<string, (uri: string) => object | null>} */
const registry = new Map();

/**
 * 注册一个或多个协议 Schemes 的解析器
 * @param {string | string[]} schemes 协议头方案名 (如 'vless' 或 ['hysteria2', 'hy2'])
 * @param {(uri: string) => object | null} parserFn 解析实现函数
 */
function registerParser(schemes, parserFn) {
  if (typeof parserFn !== 'function') {
    throw new TypeError('Parser must be a function');
  }
  const list = Array.isArray(schemes) ? schemes : [schemes];
  for (const scheme of list) {
    if (typeof scheme === 'string' && scheme.trim()) {
      registry.set(scheme.trim().toLowerCase(), parserFn);
    }
  }
}

/**
 * 获取指定 Scheme 的解析器
 * @param {string} scheme
 * @returns {((uri: string) => object | null) | undefined}
 */
function getParser(scheme) {
  if (!scheme || typeof scheme !== 'string') return undefined;
  return registry.get(scheme.trim().toLowerCase());
}

/**
 * 检查指定 Scheme 是否已被注册
 * @param {string} scheme
 * @returns {boolean}
 */
function hasParser(scheme) {
  if (!scheme || typeof scheme !== 'string') return false;
  return registry.has(scheme.trim().toLowerCase());
}

/**
 * 获取所有已注册的协议 Schemes 列表
 * @returns {string[]}
 */
function getRegisteredSchemes() {
  return Array.from(registry.keys());
}

/**
 * 根据协议前缀分发解析单条 URI 节点链接
 * @param {string} uri
 * @returns {object | null} 解析成功的节点对象，失败返回 null
 */
function parseUri(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const trimmed = uri.trim();
  const colonIndex = trimmed.indexOf('://');
  if (colonIndex <= 0) return null;

  const scheme = trimmed.slice(0, colonIndex).toLowerCase();
  const parser = registry.get(scheme);
  if (!parser) return null;

  try {
    const node = parser(trimmed);
    if (node && node.server && node.port) {
      return node;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 清除所有已注册的解析器 (主要用于测试隔离)
 */
function clearRegistry() {
  registry.clear();
}

module.exports = {
  registerParser,
  getParser,
  hasParser,
  getRegisteredSchemes,
  parseUri,
  clearRegistry
};
