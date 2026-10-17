// undici 代理封装：Node 内置 fetch 不读系统代理，需 ProxyAgent 提供代理能力
// 无 Node 网络模块的环境由构建层 --external 排除本文件，运行时缺失时降级为 null（调用方回退直连）
let ProxyAgent = null;
try { ProxyAgent = require('undici').ProxyAgent; } catch { ProxyAgent = null; }

// 代理分发器实例缓存：同一代理地址复用同一 ProxyAgent，避免重复建连开销
const proxyAgentCache = new Map();

/**
 * 为受信任的本地回环代理地址构造并缓存 ProxyAgent 分发器。
 * 仅接受 127.0.0.1 / localhost / ::1，非回环地址一律拒绝（防 SSRF：代理端点必须本机可信）。
 * @param {string} proxyUrl 形如 http://127.0.0.1:7890 的本地代理地址
 * @returns {object|null} ProxyAgent 实例；proxyUrl 为空时返回 null
 */
function resolveLocalProxyDispatcher(proxyUrl) {
  if (!proxyUrl) return null;
  if (!ProxyAgent) throw new Error('Proxy support unavailable (undici not loaded)');
  const pUrl = new URL(proxyUrl);
  const isLocalTrusted = pUrl.hostname === '127.0.0.1' || pUrl.hostname === 'localhost' || pUrl.hostname === '::1';
  if (!isLocalTrusted) throw new Error(`SSRF blocked: proxy must be local, got ${pUrl.hostname}`);
  const cached = proxyAgentCache.get(proxyUrl);
  if (cached) return cached;
  const dispatcher = new ProxyAgent(proxyUrl);
  proxyAgentCache.set(proxyUrl, dispatcher);
  return dispatcher;
}

module.exports = { ProxyAgent, resolveLocalProxyDispatcher };
