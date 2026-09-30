/**
 * -----------------------------------------------------------------------------
 * Core Layer: 节点裂变纯计算算法 (Pure Fission Algorithm)
 * -----------------------------------------------------------------------------
 * 严格遵循洋葱模型 Core 层规范：
 * 1. 绝对无副作用：严禁包含任何网络 I/O (DNS/DoH/Fetch) 或磁盘读写
 * 2. 纯函数设计：输入 (proxy, ipList) 或 (proxies, domainIpsMap)，输出裂变后的节点对象数组
 * 3. 负责节点深拷贝、servername/sni 注入与多协议 Host 防泄漏补全
 */

const { injectTransportHost } = require('./transport');

function looksLikeDomain(server) {
  if (!server || typeof server !== 'string') return false;
  const s = server.trim().replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return false;
  if (s.includes(':')) return false;
  return s.includes('.') && /[a-zA-Z]/.test(s);
}

/**
 * 对单个代理节点根据给定的 IP 列表执行实体裂变
 * @param {object} proxy 原始节点对象
 * @param {string[]} ips 该域名对应的可用 IP 列表
 * @param {object} [options={}] 裂变控制选项
 * @param {number} [options.fissionMaxNodes=5] 单节点最大裂变数
 * @param {Array<string>} [options.fissionExcludeKeywords=[]] 排除关键词
 * @returns {object[]} 裂变后产生的节点数组
 */
function fissionNode(proxy, ips = [], options = {}) {
  if (!proxy || typeof proxy !== 'object') return [];
  const maxNodes = options.fissionMaxNodes || 5;
  const excludeKeywords = options.fissionExcludeKeywords || [];
  const name = proxy.name || '';
  const server = proxy.server;

  const isExcluded = excludeKeywords.some(kw => kw && name.includes(kw));
  if (isExcluded || !Array.isArray(ips) || ips.length <= 1) {
    return [proxy];
  }

  const availableIps = ips.slice(0, maxNodes);
  const result = [];

  // 第一个 IP 原地修改作为主力节点
  const firstIp = availableIps[0];
  const originalProxy = { ...proxy };
  originalProxy._rawName = proxy._rawName || proxy.name || '';
  originalProxy.server = firstIp.includes(':') && !firstIp.startsWith('[') ? `[${firstIp}]` : firstIp;
  injectTransportHost(originalProxy, server);
  result.push(originalProxy);

  // 其余 IP 裂变为独立分身节点
  for (let i = 1; i < availableIps.length; i++) {
    const cloneIp = availableIps[i];
    const cloned = JSON.parse(JSON.stringify(proxy));
    cloned._rawName = proxy._rawName || proxy.name || '';
    cloned.name = `${proxy.name || ''} #${i + 1}`;
    cloned.server = cloneIp.includes(':') && !cloneIp.startsWith('[') ? `[${cloneIp}]` : cloneIp;
    injectTransportHost(cloned, server);
    cloned._isFission = true;
    result.push(cloned);
  }

  return result;
}

/**
 * 纯函数：批量执行节点列表的裂变增殖
 * @param {Array<object>} proxies 原始代理节点列表
 * @param {Map<string, string[]>|object} domainIpsMap 域名到 IP 列表的映射表 (由 I/O 层解析传入)
 * @param {object} [options={}]
 * @returns {Array<object>} 包含裂变节点的完整节点数组
 */
function fissionNodes(proxies = [], domainIpsMap = new Map(), options = {}) {
  if (!Array.isArray(proxies) || proxies.length === 0) {
    return [];
  }

  const getIps = (server) => {
    if (!server) return [];
    if (domainIpsMap instanceof Map) return domainIpsMap.get(server) || [];
    if (typeof domainIpsMap === 'object' && domainIpsMap !== null) return domainIpsMap[server] || [];
    return [];
  };

  const output = [];
  for (const proxy of proxies) {
    if (!proxy) continue;
    const ips = getIps(proxy.server);
    const expanded = fissionNode(proxy, ips, options);
    output.push(...expanded);
  }

  return output;
}

module.exports = {
  looksLikeDomain,
  fissionNode,
  fissionNodes
};
