// undici 代理封装：Node 内置 fetch 不读系统代理，需 ProxyAgent 提供代理能力
// Worker 等无 Node 网络模块的环境由构建层 --external 排除本文件，运行时缺失时降级为 null（调用方回退直连）
let ProxyAgent = null;
try { ProxyAgent = require('undici').ProxyAgent; } catch { ProxyAgent = null; }
module.exports = { ProxyAgent };