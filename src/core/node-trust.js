/**
 * 节点信任边界与内部 Synthetic 身份标记
 *
 * 核心安全防线：
 * 1. 外部订阅/输入数据不可信，外部携带的 isSyntheticInfo: true、_synthetic 等字段绝不赋予任何特权。
 * 2. 只有内部受信生成路径 (generateInfoNodes, buildGlobalDashboardNodes, createFetchErrorNode 等)
 *    明确标记的节点，才能进入模块私有的 WeakSet 信任集合并获得看板校验豁免。
 * 3. 外部保留字段消毒：在外部解析边界对内部保留字段进行浅拷贝剥离，且绝不原地修改上游共享解析对象。
 */

'use strict';

/** 模块私有的内部可信 synthetic 节点集合 (WeakSet 保证生命周期随垃圾回收自动释放) */
const TRUSTED_SYNTHETICS = new WeakSet();
const TRUSTED_CLEANED_NODES = new WeakSet();
const TRUSTED_PROXY_METADATA = new WeakMap();
const TRUSTABLE_PROXY_METADATA_FIELDS = new Set([
  'rawName',
  'subTag',
  'indexPrefix',
  'keepName',
  'customGroups'
]);

/**
 * Toolkit 内部控制与调度保留字段列表
 * 外部订阅数据严禁伪造这些内部标记
 */
const RESERVED_INTERNAL_FIELDS = Object.freeze([
  'isSyntheticInfo',
  '_synthetic',
  '_rawName',
  '_keepName',
  '_subTag',
  '_indexPrefix',
  '_customGroups',
  '_cleaned'
]);

/**
 * 标记 proxy 为内部可信的 synthetic 节点 (零污染私有注册)
 * @param {object} proxy
 * @returns {object} proxy 自身
 */
function markTrustedSynthetic(proxy) {
  if (proxy && typeof proxy === 'object' && !Array.isArray(proxy)) {
    TRUSTED_SYNTHETICS.add(proxy);
  }
  return proxy;
}

/**
 * 校验 proxy 是否为工具内部生成的受信 synthetic 节点
 * @param {object} proxy
 * @returns {boolean}
 */
function isTrustedSynthetic(proxy) {
  if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) {
    return false;
  }
  return TRUSTED_SYNTHETICS.has(proxy);
}

/** Mark a node as processed by the in-process nodes pipeline. */
function markTrustedCleanedNode(proxy) {
  if (proxy && typeof proxy === 'object' && !Array.isArray(proxy)) {
    TRUSTED_CLEANED_NODES.add(proxy);
  }
  return proxy;
}

/** Only same-process pipeline output is trusted; a caller supplied _cleaned flag is not. */
function isTrustedCleanedNode(proxy) {
  return !!proxy && typeof proxy === 'object' && !Array.isArray(proxy)
    && TRUSTED_CLEANED_NODES.has(proxy);
}

/** Store internal per-node metadata without granting trust to caller-controlled fields. */
function markTrustedProxyMetadata(proxy, fields = {}) {
  if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) return proxy;
  let trusted = TRUSTED_PROXY_METADATA.get(proxy);
  if (!trusted) {
    trusted = new Map();
    TRUSTED_PROXY_METADATA.set(proxy, trusted);
  }
  for (const [key, value] of Object.entries(fields)) {
    if (TRUSTABLE_PROXY_METADATA_FIELDS.has(key)) {
      trusted.set(key, value);
    }
  }
  return proxy;
}

/** Get internal trusted metadata for a proxy node. */
function getTrustedProxyMetadata(proxy, key) {
  if (!proxy || typeof proxy !== 'object') return key ? undefined : {};
  const trusted = TRUSTED_PROXY_METADATA.get(proxy);
  if (!trusted) return key ? undefined : {};
  if (key) {
    return trusted.get(key);
  }
  const result = {};
  for (const [k, v] of trusted.entries()) {
    result[k] = v;
  }
  return result;
}

/** Copy all trusted metadata from source proxy to target proxy. */
function copyTrustedProxyMetadata(source, target) {
  if (!source || typeof source !== 'object' || !target || typeof target !== 'object') return target;
  const sourceMeta = TRUSTED_PROXY_METADATA.get(source);
  if (sourceMeta) {
    const targetMeta = TRUSTED_PROXY_METADATA.get(target) || new Map();
    for (const [k, v] of sourceMeta.entries()) {
      targetMeta.set(k, v);
    }
    TRUSTED_PROXY_METADATA.set(target, targetMeta);
  }
  return target;
}

/** Restore only metadata explicitly registered by an in-process trusted producer. */
function restoreTrustedProxyMetadata(source, target) {
  const trusted = source && typeof source === 'object' ? TRUSTED_PROXY_METADATA.get(source) : null;
  if (!trusted || !target || typeof target !== 'object') return target;
  for (const [key, value] of trusted) {
    target[key] = value;
    target[`_${key}`] = value;
  }
  return target;
}

/**
 * 对来自外部订阅/解析器的单个 proxy 进行内部保留字段消毒
 * 纯函数原则：若包含内部保留字段，创建浅拷贝并移除，绝不原地修改传入的对象
 * @param {object} proxy 外部原始节点对象
 * @returns {object} 消毒后的节点对象
 */
function sanitizeExternalProxy(proxy) {
  if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) {
    return proxy;
  }

  let hasReservedField = false;
  for (const field of RESERVED_INTERNAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(proxy, field)) {
      hasReservedField = true;
      break;
    }
  }

  if (!hasReservedField) {
    return proxy;
  }

  const clean = { ...proxy };
  for (const field of RESERVED_INTERNAL_FIELDS) {
    delete clean[field];
  }
  copyTrustedProxyMetadata(proxy, clean);
  return clean;
}

/**
 * 批量对外部原始节点数组进行保留字段消毒
 * @param {Array<object>} proxies
 * @returns {Array<object>}
 */
function sanitizeExternalProxies(proxies) {
  if (!Array.isArray(proxies)) return [];
  return proxies.map(sanitizeExternalProxy);
}

module.exports = {
  markTrustedSynthetic,
  isTrustedSynthetic,
  markTrustedCleanedNode,
  isTrustedCleanedNode,
  markTrustedProxyMetadata,
  getTrustedProxyMetadata,
  copyTrustedProxyMetadata,
  restoreTrustedProxyMetadata,
  sanitizeExternalProxy,
  sanitizeExternalProxies
};
