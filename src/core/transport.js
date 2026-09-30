/**
 * -----------------------------------------------------------------------------
 * Core Layer: 传输层与协议适配器 (Transport & Protocol Adapter)
 * -----------------------------------------------------------------------------
 * 严格遵循洋葱模型 Core 层规范：
 * 1. 绝对无副作用：纯函数设计，零网络 I/O，零磁盘读写
 * 2. 单一事实来源 (SSOT)：统一抽象 Mihomo / Clash 节点在不同传输层下的字段差异
 *    (ws / grpc / h2 / httpupgrade / reality / quic)
 * 3. 集中提供 SNI 提取、Host 提取、Path 提取、Host 注入与传输层标识识别
 */

/**
 * 统一提取节点的 TLS SNI / ServerName / Peer
 * @param {object} proxy 代理节点对象
 * @returns {string}
 */
function getTransportSni(proxy) {
  if (!proxy || typeof proxy !== 'object') return '';
  return String(
    proxy.servername ||
    proxy.sni ||
    proxy.peer ||
    proxy['reality-opts']?.['server-name'] ||
    ''
  );
}

/**
 * 统一提取节点的应用传输层 Host 请求头 (ws / httpupgrade / h2 / http)
 * @param {object} proxy 代理节点对象
 * @returns {string} 提取到的 Host，未匹配返回空字符串
 */
function getTransportHost(proxy) {
  if (!proxy || typeof proxy !== 'object') return '';

  // 1. ws 传输层 Host 头
  const wsHost = proxy['ws-opts']?.headers?.Host || proxy['ws-opts']?.headers?.host;
  if (wsHost) return String(wsHost);

  // 2. httpupgrade 传输层 Host 头
  const upgradeHost = proxy['httpupgrade-opts']?.headers?.Host || proxy['httpupgrade-opts']?.headers?.host;
  if (upgradeHost) return String(upgradeHost);

  // 3. h2 传输层 host 数组或字符串
  const h2Host = proxy['h2-opts']?.host;
  if (Array.isArray(h2Host) && h2Host.length > 0 && h2Host[0]) {
    return String(h2Host[0]);
  }
  if (typeof h2Host === 'string' && h2Host) {
    return h2Host;
  }

  // 4. 顶层 host 字段
  if (proxy.host) return String(proxy.host);

  return '';
}

/**
 * 统一提取节点的传输层请求路径或服务名 (ws / grpc / h2 / httpupgrade)
 * @param {object} proxy 代理节点对象
 * @returns {string} 提取到的 Path 或 ServiceName，未匹配返回空字符串
 */
function getTransportPath(proxy) {
  if (!proxy || typeof proxy !== 'object') return '';

  // ws 路径
  if (proxy['ws-opts']?.path) return String(proxy['ws-opts'].path);

  // grpc 服务名
  if (proxy['grpc-opts']?.['grpc-service-name']) return String(proxy['grpc-opts']['grpc-service-name']);

  // h2 路径
  if (proxy['h2-opts']?.path) return String(proxy['h2-opts'].path);

  // httpupgrade 路径
  if (proxy['httpupgrade-opts']?.path) return String(proxy['httpupgrade-opts'].path);

  return '';
}

/**
 * 统一提取节点的身份鉴权密钥 (UUID / Password / ClientId / Auth / Reality Public-Key)
 * @param {object} proxy 代理节点对象
 * @returns {string}
 */
function getTransportAuthKey(proxy) {
  if (!proxy || typeof proxy !== 'object') return '';
  return String(
    proxy.uuid ??
    proxy.password ??
    proxy.client_id ??
    proxy.auth ??
    proxy['reality-opts']?.['public-key'] ??
    ''
  );
}

/**
 * 为代理节点智能补全/注入 Host 头与 SNI (通常用于 IP 裂变或域名解析替换场景)
 * @param {object} proxy 代理节点对象 (原地修改并返回)
 * @param {string} host 原始域名或指定主机名
 * @returns {object} 修改后的节点对象
 */
function injectTransportHost(proxy, host) {
  if (!proxy || typeof proxy !== 'object' || !host) return proxy;

  const network = String(proxy.network || '').toLowerCase();
  const isTls = !!proxy.tls;
  const isHttpOrUpgrade = ['ws', 'grpc', 'h2', 'http', 'httpupgrade'].includes(network);

  // 1. 补齐 TLS / 特殊传输层所需的 SNI / servername
  if (isTls || isHttpOrUpgrade) {
    if (!proxy.sni && !proxy.servername) {
      proxy.servername = host;
    }
  }

  // 2. ws 传输层补齐 Host
  if (network === 'ws') {
    const wsOpts = proxy['ws-opts'] || {};
    const headers = wsOpts.headers || {};
    if (!headers.Host && !headers.host) {
      proxy['ws-opts'] = {
        ...wsOpts,
        headers: { ...headers, Host: host }
      };
    }
  }

  // 3. httpupgrade 传输层补齐 Host
  if (network === 'httpupgrade') {
    const upgradeOpts = proxy['httpupgrade-opts'] || {};
    const headers = upgradeOpts.headers || {};
    if (!headers.Host && !headers.host) {
      proxy['httpupgrade-opts'] = {
        ...upgradeOpts,
        headers: { ...headers, Host: host }
      };
    }
  }

  // 4. h2 / http 传输层补齐 host 数组
  if (network === 'h2' || network === 'http') {
    const h2Opts = proxy['h2-opts'] || {};
    const hosts = h2Opts.host;
    if (!hosts || (Array.isArray(hosts) && hosts.length === 0)) {
      proxy['h2-opts'] = {
        ...h2Opts,
        host: [host]
      };
    }
  }

  return proxy;
}

/**
 * 统一识别并返回节点的传输层协议大写标识 (用于 {transport} 模板渲染及特征打标)
 * @param {object} proxy 代理节点对象
 * @returns {string} 规范化传输层大写标识 (如 "WS" / "GRPC" / "H2" / "HTTPUPGRADE" / "QUIC")，普通 TCP 返回空字符串
 */
function getTransportType(proxy) {
  if (!proxy || typeof proxy !== 'object') return '';

  const network = String(proxy.network || '').toLowerCase();
  if (network && network !== 'tcp') {
    return network.toUpperCase();
  }

  const type = String(proxy.type || '').toLowerCase();
  if (type === 'hysteria' || type === 'hysteria2' || type === 'tuic') {
    return 'QUIC';
  }

  return '';
}

module.exports = {
  getTransportSni,
  getTransportHost,
  getTransportPath,
  getTransportAuthKey,
  injectTransportHost,
  getTransportType
};
