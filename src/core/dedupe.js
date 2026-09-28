/**
 * 节点物理去重算法
 *
 * 基于 Server/Port/UUID/Password/SNI/Host/Path 等底层网络特征生成唯一指纹并去重。
 */

/**
 * 计算单个节点的底层网络特征唯一指纹
 * @param {object} proxy
 * @returns {string}
 */
function getNodeFingerprint(proxy) {
  if (!proxy || typeof proxy !== 'object') return '';
  const server = String(proxy.server || '').toLowerCase();
  const port = String(proxy.port || '');
  const type = String(proxy.type || '').toLowerCase();
  const network = String(proxy.network || '').toLowerCase();

  const sni = String(
    proxy.sni ||
    proxy.servername ||
    proxy.peer ||
    proxy['reality-opts']?.['server-name'] ||
    ''
  ).toLowerCase();

  const host = String(
    proxy.host ||
    proxy['ws-opts']?.headers?.Host ||
    proxy['ws-opts']?.headers?.host ||
    ''
  ).toLowerCase();

  const path = String(
    proxy['ws-opts']?.path ||
    proxy['grpc-opts']?.['grpc-service-name'] ||
    ''
  ).toLowerCase();

  const authKey = String(
    proxy.uuid ??
    proxy.password ??
    proxy.client_id ??
    ''
  ).toLowerCase();

  return [server, port, type, network, sni, host, path, authKey].join('\x01');
}

/**
 * 节点物理去重纯函数
 * @param {Array<object>} proxies
 * @param {object} [options]
 * @param {Function} [options.onDuplicate] 重复节点回调 (duplicateNode, existingNode)
 * @returns {Array<object>} 去重后的节点数组
 */
function dedupeNodes(proxies, options = {}) {
  if (!Array.isArray(proxies)) return [];
  const { onDuplicate } = options;
  const seenMap = new Map();
  const result = [];

  for (const proxy of proxies) {
    if (!proxy || !proxy.server) {
      result.push(proxy);
      continue;
    }

    const key = getNodeFingerprint(proxy);
    if (seenMap.has(key)) {
      if (typeof onDuplicate === 'function') {
        onDuplicate(proxy, seenMap.get(key));
      }
    } else {
      seenMap.set(key, proxy);
      result.push(proxy);
    }
  }

  return result;
}

module.exports = {
  getNodeFingerprint,
  dedupeNodes
};
