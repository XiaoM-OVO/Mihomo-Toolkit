/**
 * -----------------------------------------------------------------------------
 * 直连模式的 IP Pinning 分发器 (DNS Rebinding / TOCTOU 防护)
 * -----------------------------------------------------------------------------
 * 背景：`ssrf.js#validateUrlSsrf` 在请求前做一次 DNS 校验，undici 建连时又会做一次
 * 独立解析。恶意 DNS 可在两次解析之间切换回环 / 内网地址，形成 TOCTOU 窗口。
 *
 * 方案：直连模式下给 `fetch` 注入一个带自定义 `connect.lookup` 的 Agent。undici 在
 * 真正建连时调用本模块的 lookup，在**同一次解析**中完成全部候选地址校验，并直接返回
 * 已校验的 IP，「校验的目标」与「连接的目标」严格一致。TLS 的 SNI 与证书校验仍按
 * 原域名进行，不受影响。
 *
 * 覆盖范围：仅直连模式。代理模式下目标域名由代理侧解析，本层无法固定 IP，残余风险
 * （分裂 DNS / 代理侧私有解析 / 代理 ACL 缺失）见 `io/ssrf.js` 文件头。
 */

'use strict';

const net = require('net');
const { isPrivateIp, isPrivateIPv6 } = require('../infra/ip');

let Agent = null;
try { Agent = require('undici').Agent; } catch { Agent = null; }

/** 构造确定性策略拦截错误：不重试、且不允许 auto 模式回退代理 */
function policyBlocked(message) {
  const err = new Error(message);
  err.ssrfBlocked = 'policy';
  err.retryable = false;
  return err;
}

/** 构造「无法证明目标安全」错误（解析失败 / 无可用地址） */
function unverifiedBlocked(message) {
  const err = new Error(message);
  err.ssrfBlocked = 'unverified';
  return err;
}

/** 默认地址判定：私网 / 回环 / 保留网段一律视为禁止目标 */
function isBlockedAddress(address) {
  return isPrivateIp(address) || isPrivateIPv6(address);
}

/**
 * 归一化解析结果，兼容两类输入：
 *   - `dns.lookup(host, { all: true })` 的 `{ address, family }[]`
 *   - 测试注入的裸地址字符串数组
 * @param {unknown} result
 * @returns {{ address: string, family: 4|6 }[]}
 */
function normalizeEntries(result) {
  if (!Array.isArray(result)) return [];
  const entries = [];
  for (const item of result) {
    if (typeof item === 'string') {
      const family = net.isIP(item);
      if (family) entries.push({ address: item, family });
      continue;
    }
    if (!item || typeof item.address !== 'string') continue;
    const family = item.family === 4 || item.family === 6 ? item.family : net.isIP(item.address);
    if (family) entries.push({ address: item.address, family });
  }
  return entries;
}

/**
 * 构造建连期 lookup：解析 → 全量校验 → 返回已校验地址。
 *
 * undici 以 `{ all: true }` 调用时（实测行为）必须回调 `{ address, family }[]`，
 * 否则会把结果当作无效地址；非 all 调用按 Node 约定回调 `(null, address, family)`。
 *
 * @param {object} [options]
 * @param {(host: string) => Promise<Array<string|{address: string, family: number}>>} [options.resolve] 可注入解析器（测试用）
 * @param {(address: string) => boolean} [options.isBlocked] 可注入地址判定（测试用）
 * @returns {(hostname: string, lookupOptions: object, callback: Function) => void}
 */
function createPinnedLookup(options = {}) {
  const resolve = typeof options.resolve === 'function'
    ? options.resolve
    : (host) => require('dns').promises.lookup(host, { all: true, verbatim: true });
  const isBlocked = typeof options.isBlocked === 'function' ? options.isBlocked : isBlockedAddress;

  return function pinnedLookup(hostname, lookupOptions, callback) {
    const requested = lookupOptions || {};
    const wantAll = requested.all === true;
    const family = requested.family === 4 || requested.family === 6 ? requested.family : 0;

    (async () => {
      let result;
      try {
        result = await resolve(hostname);
      } catch {
        throw unverifiedBlocked(`SSRF blocked: unable to verify ${hostname} (DNS resolution failed)`);
      }

      let entries = normalizeEntries(result);
      if (family) entries = entries.filter((entry) => entry.family === family);
      if (entries.length === 0) {
        throw unverifiedBlocked(`SSRF blocked: unable to verify ${hostname} (no usable address)`);
      }
      // 与 ssrf.js 的全候选地址策略一致：只要存在禁止地址就拒绝整个目标
      for (const entry of entries) {
        if (isBlocked(entry.address)) {
          throw policyBlocked(`SSRF blocked: ${hostname} resolved to private IP ${entry.address}`);
        }
      }
      return entries;
    })().then(
      (entries) => {
        if (wantAll) callback(null, entries);
        else callback(null, entries[0].address, entries[0].family);
      },
      (err) => callback(err)
    );
  };
}

/** 进程级共享 Agent：复用连接池，避免每次抓取重复建连 */
let sharedAgent = null;

/**
 * 获取直连模式的 IP Pinning Agent（惰性创建）。
 * @returns {object|null} undici Agent；运行环境缺少 undici 时返回 null（调用方退回仅预检）
 */
function getPinnedAgent() {
  if (!Agent) return null;
  if (!sharedAgent) sharedAgent = new Agent({ connect: { lookup: createPinnedLookup() } });
  return sharedAgent;
}

/**
 * 构造独立 Agent（测试或不希望共享连接池的场景）。
 * @param {object} [options] 透传给 createPinnedLookup
 * @returns {object|null}
 */
function createPinnedAgent(options = {}) {
  if (!Agent) return null;
  return new Agent({ connect: { lookup: createPinnedLookup(options) } });
}

module.exports = {
  createPinnedLookup,
  createPinnedAgent,
  getPinnedAgent
};
