/**
 * 节点物理去重算法
 *
 * 基于协议感知底层网络特征（Server/Port/Type/Network/Auth/TLS/SNI/Host/Path/Transport-opts）
 * 生成确定性规范化唯一指纹并去重。
 */

const {
  getTransportSni,
  getTransportHost,
  getTransportPath,
  getTransportAuthKey
} = require('./transport');
const { isTrustedSynthetic } = require('./node-trust');

/**
 * 递归规范化任意值并生成确定性无歧义编码
 * - 对象：按 key 字典序递归排序，避免 JSON 键顺序差异造成指纹不一致
 * - 数组：保持元素顺序并逐项递归编码
 * - 字符串：统一做边界和长度前缀编码
 * - 基础类型：明确区分 boolean / number / string / null / undefined
 * @param {unknown} val
 * @returns {string}
 */
function canonicalEncode(val) {
  if (val === undefined) return 'u:';
  if (val === null) return 'n:';
  const t = typeof val;
  if (t === 'boolean') return val ? 'b:1' : 'b:0';
  if (t === 'number') {
    if (Number.isNaN(val)) return 'num:NaN';
    return `num:${String(val)}`;
  }
  if (t === 'string') {
    return `s:${val.length}:${val}`;
  }
  if (Array.isArray(val)) {
    const items = val.map(canonicalEncode);
    return `arr:[${items.join(',')}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(val).sort();
    const pairs = keys.map(k => `${canonicalEncode(k)}=>${canonicalEncode(val[k])}`);
    return `obj:{${pairs.join(';')}}`;
  }
  return `raw:${String(val)}`;
}

/**
 * 规范化 host (支持数组或单字符串，去空并小写化排序)
 * @param {string[]|string|undefined} hostVal
 * @returns {string[]}
 */
function normalizeHosts(hostVal) {
  if (!hostVal) return [];
  const list = Array.isArray(hostVal) ? hostVal : [hostVal];
  return list
    .filter(Boolean)
    .map(h => String(h).trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

/**
 * 规范化 ALPN 列表
 * 根据 RFC 7301，ALPN 协议标识字符串是大小写敏感的 (case-sensitive) 且客户端发送有优先偏好顺序。
 * 去除首尾空白与空值，保留原始声明的顺序与大小写。
 * @param {string[]|string|undefined} alpnVal
 * @returns {string[]}
 */
function normalizeAlpn(alpnVal) {
  if (!alpnVal) return [];
  const list = Array.isArray(alpnVal) ? alpnVal : String(alpnVal).split(',');
  return list
    .map(s => (s != null ? String(s).trim() : ''))
    .filter(Boolean);
}

/**
 * 递归规范化对象键名（小写化并排序键），同时保留原语值的结构，便于 canonicalEncode 精确处理
 * @param {unknown} val
 * @returns {unknown}
 */
function normalizeStructure(val) {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map(normalizeStructure);
  }
  if (typeof val === 'object') {
    const normalized = {};
    const keys = Object.keys(val).sort();
    for (const k of keys) {
      const normKey = String(k).trim().toLowerCase();
      normalized[normKey] = normalizeStructure(val[k]);
    }
    return normalized;
  }
  return val;
}

/**
 * 计算单个节点的底层网络特征唯一指纹
 * 区分连接身份字段与展示/策略字段：
 * - 连接身份字段：Server, Port, Type, Network, Auth, TLS/SNI/ALPN, Transport-opts (ws/grpc/h2/httpupgrade/reality/plugin)
 * - 协议专有身份字段：VLESS flow, Hysteria2 obfs, TUIC congestion controller / udp relay mode, SS plugin & opts, gRPC service name / mode
 * - 严格排除非连接属性：name, udp, tfo 等展示/策略属性
 * @param {object} proxy
 * @returns {string}
 */
function getNodeFingerprint(proxy) {
  if (!proxy || typeof proxy !== 'object') return '';

  const server = String(proxy.server || '').trim().toLowerCase();
  const port = String(proxy.port || '').trim();
  const type = String(proxy.type || '').trim().toLowerCase();
  const network = String(proxy.network || '').trim().toLowerCase();

  // 1. 基础认证与 TLS 凭证
  // 注意：除标准 UUID 规范为小写比较外，不透明密钥凭据 (Password / ClientId / Auth / Reality Public-Key / Username)
  // 属于严格大小写敏感数据 (Case-Sensitive)，严禁 toLowerCase 破坏身份唯一性
  const authKey = getTransportAuthKey(proxy).trim();
  // 补齐独立认证凭据：TUIC 等协议可同时包含 UUID 与 password，且其他协议亦可能显式独立定义
  const uuid = proxy.uuid != null ? String(proxy.uuid).trim().toLowerCase() : '';
  const password = proxy.password != null ? String(proxy.password).trim() : '';
  const username = proxy.username != null ? String(proxy.username).trim() : '';
  const cipher = proxy.cipher != null ? String(proxy.cipher).trim().toLowerCase() : '';
  const alterId = proxy.alterId != null ? String(proxy.alterId).trim() : '';

  // 2. TLS / SNI 标识
  const tls = proxy.tls === true || proxy.tls === 'true' || proxy.tls === 1;
  const sni = getTransportSni(proxy).trim().toLowerCase();
  const alpn = normalizeAlpn(proxy.alpn);

  // 3. 基础传输层通用 Host 与 Path
  const host = getTransportHost(proxy).trim().toLowerCase();
  const path = getTransportPath(proxy).trim();

  // 4. 传输层具体结构及高级参数
  const grpcMode = proxy['grpc-opts']?.mode != null ? String(proxy['grpc-opts'].mode).trim().toLowerCase() : '';
  const h2Hosts = normalizeHosts(proxy['h2-opts']?.host);

  // Reality 专有参数 (public-key 为 Base64URL 密码学密钥，short-id 为十六进制字串，均保留原始大小写)
  const realityPublicKey = proxy['reality-opts']?.['public-key'] != null ? String(proxy['reality-opts']['public-key']).trim() : '';
  const realityShortId = proxy['reality-opts']?.['short-id'] != null ? String(proxy['reality-opts']['short-id']).trim() : '';
  const realityServerName = proxy['reality-opts']?.['server-name'] != null ? String(proxy['reality-opts']['server-name']).trim().toLowerCase() : '';

  // Shadowsocks plugin 及其参数 (递归规范化键名与取值，保留结构避免压平成 [object Object])
  const plugin = proxy.plugin != null ? String(proxy.plugin).trim().toLowerCase() : '';
  const pluginOpts = proxy['plugin-opts'] && typeof proxy['plugin-opts'] === 'object'
    ? normalizeStructure(proxy['plugin-opts'])
    : null;

  // VLESS flow
  const flow = proxy.flow != null ? String(proxy.flow).trim().toLowerCase() : '';

  // Hysteria2 专有参数
  const obfs = proxy.obfs != null ? String(proxy.obfs).trim().toLowerCase() : '';
  const obfsPassword = proxy['obfs-password'] != null ? String(proxy['obfs-password']).trim() : '';
  const ports = proxy.ports != null ? String(proxy.ports).trim().toLowerCase() : '';

  // TUIC 专有参数
  const congestionController = proxy['congestion-controller'] != null ? String(proxy['congestion-controller']).trim().toLowerCase() : '';
  const udpRelayMode = proxy['udp-relay-mode'] != null ? String(proxy['udp-relay-mode']).trim().toLowerCase() : '';
  const disableSni = proxy['disable-sni'] === true || proxy['disable-sni'] === 'true';

  // 5. 组装规范化特征向量
  const features = {
    server,
    port,
    type,
    network,
    authKey,
    uuid,
    password,
    username,
    cipher,
    alterId,
    tls,
    sni,
    alpn,
    host,
    path,
    grpcMode,
    h2Hosts,
    realityPublicKey,
    realityShortId,
    realityServerName,
    plugin,
    pluginOpts,
    flow,
    obfs,
    obfsPassword,
    ports,
    congestionController,
    udpRelayMode,
    disableSni
  };

  // 6. 确定性序列化
  return canonicalEncode(features);
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

    // 虚拟看板/信息节点不参与底层 IP:Port 物理去重（防止同为 127.0.0.1:80 被互相剔除），仅按名称防重
    // 只有经过内部受信标记的 synthetic 节点才豁免物理去重，外部伪造标记坚决按真实物理指纹去重
    if (isTrustedSynthetic(proxy)) {
      const infoKey = `synth:${proxy.name}`;
      if (seenMap.has(infoKey)) {
        if (typeof onDuplicate === 'function') {
          onDuplicate(proxy, seenMap.get(infoKey));
        }
      } else {
        seenMap.set(infoKey, proxy);
        result.push(proxy);
      }
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
  canonicalEncode,
  getNodeFingerprint,
  dedupeNodes
};
