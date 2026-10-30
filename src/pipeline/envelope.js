/**
 * -----------------------------------------------------------------------------
 * Pipeline Layer: 节点只读 Envelope 包装器 (Read-only Envelope Wrapper)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 旁路构造原始 proxy 的只读记录，原对象不克隆、不改写、不增删属性
 * 2. 完整保留 rawName 原值，独立提供 trimmed 后的 normalizedRawName
 * 3. 记录输入数组中的稳定全局索引 identity.globalInputIndex
 * 4. 深度冻结 Envelope、identity 与 metadata 副本（包含任意嵌套层级与循环引用防守）
 * 5. 严格隔离：绝不修改或冻结调用方自己的原始 metadata 对象
 * 6. 安全防御：WeakMap 仅接收对象键，且支持同一批次内重复引用累积
 * 7. 批次生命周期管理：按批次重置历史记录，避免长期驻留 proxy 列表无限膨胀
 * 8. isSyntheticInfo 仅作为只读观察数据记录，不建立新的信任机制
 */

'use strict';

const { extractMetadata } = require('../core/metadata');

// Proxy 原始引用到 Envelope 列表的 WeakMap 反查字典
let PROXY_ENVELOPES_MAP = new WeakMap();

/**
 * 递归深拷贝并冻结任意对象与数组，支持循环引用检测。
 * 绝不修改或冻结调用方传入的原对象。
 * @param {any} val
 * @param {WeakMap} [seen=new WeakMap()]
 * @returns {any}
 */
function deepCloneAndFreeze(val, seen = new WeakMap()) {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (seen.has(val)) {
    return seen.get(val);
  }
  if (Array.isArray(val)) {
    const copy = [];
    seen.set(val, copy);
    for (let i = 0; i < val.length; i++) {
      copy[i] = deepCloneAndFreeze(val[i], seen);
    }
    return Object.freeze(copy);
  }
  const copy = {};
  seen.set(val, copy);
  for (const key of Object.keys(val)) {
    copy[key] = deepCloneAndFreeze(val[key], seen);
  }
  return Object.freeze(copy);
}

/**
 * 为代理节点创建只读 Envelope 包装
 * @param {object} proxy 原始 proxy 引用
 * @param {number} globalInputIndex 输入数组中的稳定全局位置索引
 * @param {object} [metadata] 预先构造的元数据；传入对象时会自动递归深拷贝并冻结独立副本，绝不改动调用方原对象
 * @returns {object|null} 冻结的 Envelope 对象；若输入非法返回 null
 */
function createEnvelope(proxy, globalInputIndex, metadata) {
  // 严格防御：非对象、null、数组等非法输入安全拒绝，绝不引发 WeakMap TypeError
  if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) {
    return null;
  }

  const rawName = proxy.name;
  const normalizedRawName = typeof proxy.name === 'string'
    ? proxy.name.trim()
    : String(proxy.name ?? '').trim();

  const idx = typeof globalInputIndex === 'number' && Number.isFinite(globalInputIndex)
    ? globalInputIndex
    : 0;

  // 严格隔离：深拷贝并深度冻结元数据副本，确保 Envelope 不可变且绝不污染/冻结调用方原对象
  const meta = metadata && typeof metadata === 'object'
    ? deepCloneAndFreeze(metadata)
    : extractMetadata(rawName);

  const envelope = {
    rawProxy: proxy,
    rawName,
    normalizedRawName,
    identity: Object.freeze({
      globalInputIndex: idx
    }),
    metadata: meta,
    // 只读观察字段，绝不作为信任凭证或鉴权绕过
    isSyntheticInfo: Boolean(proxy.isSyntheticInfo)
  };

  Object.freeze(envelope);

  // 在 WeakMap 中累积保存（支持同一输入批次内同一 proxy 对象的多个索引）
  let list = PROXY_ENVELOPES_MAP.get(proxy);
  if (!list) {
    list = [];
    PROXY_ENVELOPES_MAP.set(proxy, list);
  }
  list.push(envelope);

  return envelope;
}

/**
 * 查询指定 proxy 对象关联的所有只读 Envelopes
 * @param {object} proxy
 * @returns {Array<object>}
 */
function getEnvelopes(proxy) {
  if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) {
    return [];
  }
  const list = PROXY_ENVELOPES_MAP.get(proxy);
  return list ? [...list] : [];
}

/**
 * 清理指定 proxy 对象的 Envelope 反查记录
 * @param {object} proxy
 */
function clearEnvelopes(proxy) {
  if (proxy && typeof proxy === 'object' && !Array.isArray(proxy)) {
    PROXY_ENVELOPES_MAP.delete(proxy);
  }
}

/**
 * 重置全局 Envelope WeakMap 存储
 */
function resetEnvelopeStore() {
  PROXY_ENVELOPES_MAP = new WeakMap();
}

/**
 * 批次生成 Envelope 旁路结果 (单节点异常隔离，不中断主流程)
 * 按批次管理 WeakMap 历史：新批次重置已存在 proxy 的累积列表，同批次内重复引用正常保留。
 * @param {Array<object>} proxies
 * @param {object} [options={}]
 * @returns {{ envelopes: Array<object>, bypassErrors: number }}
 */
function createEnvelopesBypass(proxies, options = {}) {
  const logger = options?.logger;
  const envelopes = [];
  let bypassErrors = 0;

  if (!Array.isArray(proxies)) {
    return { envelopes, bypassErrors };
  }

  // 批次隔离：本批次中首次出现的 proxy 清空历史记录，防止跨批次重复运行内存无界增长
  const seenInBatch = new Set();
  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    if (proxy && typeof proxy === 'object' && !Array.isArray(proxy)) {
      if (!seenInBatch.has(proxy)) {
        seenInBatch.add(proxy);
        PROXY_ENVELOPES_MAP.set(proxy, []);
      }
    }
  }

  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    try {
      if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) {
        bypassErrors++;
        continue;
      }
      const meta = extractMetadata(proxy.name);
      const env = createEnvelope(proxy, i, meta);
      if (env) {
        envelopes.push(env);
      } else {
        bypassErrors++;
      }
    } catch (err) {
      bypassErrors++;
      if (logger && typeof logger.debug === 'function') {
        logger.debug(`🗑️ [Envelope 旁路] 节点 [${i}] 提取异常：${err?.message || err}`);
      }
    }
  }

  return { envelopes, bypassErrors };
}

module.exports = {
  createEnvelope,
  getEnvelopes,
  clearEnvelopes,
  resetEnvelopeStore,
  createEnvelopesBypass
};
