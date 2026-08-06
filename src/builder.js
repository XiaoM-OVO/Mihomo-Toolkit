const yaml = require('yaml');
const { operator } = require('./pure-nodes.js');
const { main: toolkitMain } = require('./mihomo-toolkit.js');

let dns;
try { dns = require('dns').promises; } catch { dns = null; }

// 简繁转换模块（Worker 环境不可用，构建时排除，运行时降级为空函数）
let chineseConvert = { toSimplified: (t) => t, toTraditional: (t) => t, deepConvertStrings: (o) => o };
try { chineseConvert = require('./chinese-convert'); } catch (e) {}

function decodeBase64(str) {
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str.trim(), 'base64').toString('utf-8');
    }
    const binString = atob(str.trim());
    return new TextDecoder().decode(Uint8Array.from(binString, (m) => m.codePointAt(0)));
  } catch { return null; }
}

function decodeBase64UrlSafe(str) {
  try {
    let s = str.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(s, 'base64').toString('utf-8');
    }
    const binString = atob(s);
    return new TextDecoder().decode(Uint8Array.from(binString, (m) => m.codePointAt(0)));
  } catch { return null; }
}

function safeDecodeURIComponent(str) {
  try { return decodeURIComponent(str); } catch { return str; }
}

function parseVlessUri(uri) {
  try {
    const url = new URL(uri);
    const uuid = url.username;
    const server = url.hostname;
    const port = parseInt(url.port) || 443;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    const proxy = {
      name,
      type: 'vless',
      server,
      port,
      uuid,
      tls: params.get('tls') === 'tls' || params.get('security') === 'tls',
      'skip-cert-verify': false
    };

    const security = params.get('security') || '';
    if (security === 'reality') {
      proxy.tls = true;
      proxy['reality-opts'] = {
        'public-key': params.get('pbk') || '',
        'short-id': params.get('sid') || ''
      };
      if (params.get('sni')) {
          proxy.servername = params.get('sni'); 
      }
      proxy['client-fingerprint'] = params.get('fp') || 'chrome'; 
      
    } else if (proxy.tls) {
      if (params.get('sni')) {
          proxy.servername = params.get('sni');
      }
      if (params.get('fp')) {
          proxy['client-fingerprint'] = params.get('fp');
      }
      if (params.get('alpn')) {
        proxy.alpn = params.get('alpn').split(',').map(s => s.trim());
      }
    }

    const network = params.get('type') || 'tcp';
    proxy.network = network;

    if (network === 'ws') {
      proxy['ws-opts'] = {
        path: params.get('path') || '/',
        headers: {}
      };
      if (params.get('host')) proxy['ws-opts'].headers.Host = params.get('host');
    } else if (network === 'grpc') {
      proxy['grpc-opts'] = {
        'grpc-service-name': params.get('serviceName') || ''
      };
      if (params.get('mode')) proxy['grpc-opts'].mode = params.get('mode');
    } else if (network === 'h2' || network === 'http') {
      proxy.network = 'h2';
      proxy['h2-opts'] = {
        host: params.get('host') ? [params.get('host')] : [],
        path: params.get('path') || '/'
      };
    } else if (network === 'httpupgrade') {
      proxy.network = 'httpupgrade';
      proxy['httpupgrade-opts'] = {
        path: params.get('path') || '/',
        headers: {}
      };
      if (params.get('host')) proxy['httpupgrade-opts'].headers.Host = params.get('host');
    }

    if (params.get('flow')) proxy.flow = params.get('flow');

    return proxy;
  } catch { return null; }
}

function parseVmessUri(uri) {
  try {
    const base64Part = uri.replace(/^vmess:\/\//i, '').trim();
    const jsonStr = decodeBase64UrlSafe(base64Part);
    if (!jsonStr) return null;
    const data = JSON.parse(jsonStr);

    const proxy = {
      name: data.ps || `${data.add}:${data.port}`,
      type: 'vmess',
      server: data.add,
      port: parseInt(data.port) || 443,
      uuid: data.id,
      alterId: parseInt(data.aid) || 0,
      cipher: data.scy || 'auto',
      tls: data.tls === 'tls',
      'skip-cert-verify': false
    };

    if (proxy.tls && data.sni) {
        proxy.servername = data.sni; 
    }
    if (data.alpn) proxy.alpn = data.alpn.split(',').map(s => s.trim());
    if (data.fp) proxy['client-fingerprint'] = data.fp;

    const network = data.net || 'tcp';
    proxy.network = network;

    if (network === 'ws') {
      proxy['ws-opts'] = {
        path: data.path || '/',
        headers: {}
      };
      if (data.host) proxy['ws-opts'].headers.Host = data.host;
    } else if (network === 'grpc') {
      proxy['grpc-opts'] = {
        'grpc-service-name': data.path || ''
      };
    } else if (network === 'h2') {
      proxy['h2-opts'] = {
        host: data.host ? [data.host] : [],
        path: data.path || '/'
      };
    } else if (network === 'http') {
      proxy.network = 'h2';
      proxy['h2-opts'] = {
        host: data.host ? [data.host] : [],
        path: data.path || '/'
      };
    }

    return proxy;
  } catch { return null; }
}

function parseTrojanUri(uri) {
  try {
    const url = new URL(uri);
    const password = url.username;
    const server = url.hostname;
    const port = parseInt(url.port) || 443;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    const proxy = {
      name,
      type: 'trojan',
      server,
      port,
      password,
      tls: true,
      'skip-cert-verify': false
    };

    if (params.get('sni')) proxy.sni = params.get('sni');
    if (params.get('alpn')) {
      proxy.alpn = params.get('alpn').split(',').map(s => s.trim());
    }
    proxy['client-fingerprint'] = params.get('fp') || 'chrome';

    const network = params.get('type') || 'tcp';
    if (network !== 'tcp') proxy.network = network;

    if (network === 'ws') {
      proxy['ws-opts'] = {
        path: params.get('path') || '/',
        headers: {}
      };
      if (params.get('host')) proxy['ws-opts'].headers.Host = params.get('host');
    } else if (network === 'grpc') {
      proxy['grpc-opts'] = {
        'grpc-service-name': params.get('serviceName') || ''
      };
    }

    return proxy;
  } catch { return null; }
}

function parseSsUri(uri) {
  try {
    const url = new URL(uri);
    let method = '', password = '';
    const user = url.username;
    const pass = url.password;

    if (user && pass) {
      method = safeDecodeURIComponent(user);
      password = safeDecodeURIComponent(pass);
    } else if (user && user.includes(':')) {
      [method, password] = user.split(':');
      password = safeDecodeURIComponent(password);
    } else {
      const decoded = decodeBase64UrlSafe(user);
      if (decoded && decoded.includes(':')) {
        [method, password] = decoded.split(':');
      } else {
        return null;
      }
    }

    const server = url.hostname;
    const port = parseInt(url.port) || 443;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    const proxy = {
      name,
      type: 'ss',
      server,
      port,
      cipher: method,
      password
    };

    const plugin = params.get('plugin');
    if (plugin) {
      const pluginOpts = {};
      const pluginOptsStr = params.get('plugin-opts') || '';
      pluginOptsStr.split(';').forEach(p => {
        const [k, v] = p.split('=');
        if (k) pluginOpts[k.trim()] = v ? safeDecodeURIComponent(v.trim()) : '';
      });
      proxy.plugin = plugin;
      proxy['plugin-opts'] = pluginOpts;
    }

    return proxy;
  } catch { return null; }
}

function parseUriList(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  const proxies = [];

  for (const line of lines) {
    let proxy = null;
    if (/^vless:\/\//i.test(line)) {
      proxy = parseVlessUri(line);
    } else if (/^vmess:\/\//i.test(line)) {
      proxy = parseVmessUri(line);
    } else if (/^trojan:\/\//i.test(line)) {
      proxy = parseTrojanUri(line);
    } else if (/^ss:\/\//i.test(line)) {
      proxy = parseSsUri(line);
    }
    if (proxy && proxy.server && proxy.port) {
      proxies.push(proxy);
    }
  }

  return proxies.length > 0 ? { proxies } : null;
}

function parseContent(content) {
  // 快速路径：直接 URI 列表（vless://, vmess://, trojan://, ss://）
  // 避免 Node.js Buffer.from 宽松 Base64 解码把 URI 错解为乱码字符串
  if (/^(vless|vmess|trojan|ss):\/\//im.test(content.trim())) {
    try {
      const uriResult = parseUriList(content);
      if (uriResult) return uriResult;
    } catch (e) {}
  }

  // Try Base64 decode first as most subscriptions are base64 encoded
  try {
    const decoded = decodeBase64(content);
    if (decoded) {
      const data = yaml.parse(decoded);
      if (data && data.proxies && Array.isArray(data.proxies)) {
        return data;
      }
      const uriResult = parseUriList(decoded);
      if (uriResult) return uriResult;
    }
  } catch (e) {}

  // Fallback to plain YAML parse
  try {
    const data = yaml.parse(content);
    if (data && data.proxies && Array.isArray(data.proxies)) {
      return data;
    }
  } catch (e) {}

  // Fallback to URI list parse
  try {
    const uriResult = parseUriList(content);
    if (uriResult) return uriResult;
  } catch (e) {}

  return { proxies: [] };
}

function parseSubscriptionInfo(subInfo) {
  if (!subInfo) return { upload: 0, download: 0, total: 0, expire: 0 };
  const parts = subInfo.split(';').map(s => s.trim());
  let upload = 0, download = 0, total = 0, expire = 0;
  parts.forEach(p => {
    const [k, v] = p.split('=');
    if (k === 'upload') upload = parseInt(v) || 0;
    if (k === 'download') download = parseInt(v) || 0;
    if (k === 'total') total = parseInt(v) || 0;
    if (k === 'expire') expire = parseInt(v) || 0;
  });
  return { upload, download, total, expire };
}

function generateInfoNodes(subInfo, tag) {
  if (!subInfo) return { nodes: [], expireDays: -1 };
  const { upload, download, total, expire } = parseSubscriptionInfo(subInfo);

  const nodes = [];
  const formatBytes = (bytes) => {
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };
  
  if (total > 0) {
    const used = upload + download;
    const remaining = total - used;
    nodes.push({
      name: `${tag ? '[' + tag + '] ' : ''}剩余流量：${formatBytes(remaining)}`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
  }

  let expireDays = -1;
  if (expire > 0) {
    const d = new Date(expire * 1000);
    const dateStr = d.toISOString().split('T')[0];
    const now = new Date();
    expireDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    nodes.push({
      name: `${tag ? '[' + tag + '] ' : ''}套餐到期：${dateStr}${expireDays > 0 ? ` (余 ${expireDays} 天)` : ''}`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
  }
  return { nodes, expireDays };
}

function redactUrl(url, fullRedact = false) {
  try {
    const parsed = new URL(url);
    if (fullRedact) {
      // 完整脱敏：只保留协议和域名，路径和参数全部隐藏
      return `${parsed.protocol}//${parsed.hostname}/***`;
    }
    let changed = false;
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
      changed = true;
    }
    // partial 模式：脱敏所有 query 参数值（机场 token 参数名千奇百怪，无法靠枚举覆盖）
    for (const key of parsed.searchParams.keys()) {
      const vals = parsed.searchParams.getAll(key);
      if (vals.some(v => v !== '')) {
        parsed.searchParams.set(key, '***');
        changed = true;
      }
    }
    if (changed) return parsed.toString();
  } catch (e) {}
  return url;
}

function isPrivateIp(ip) {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  const [a, b] = ip.split('.').map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  return false;
}

function isAllowedUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (/^(localhost|0\.0\.0\.0|::1)$/.test(host)) return false;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function isPrivateIPv6(ip) {
  if (ip === '::1') return true;
  if (ip.startsWith('fe80:')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return false;
}

async function dnsResolveWithTimeout(host, family) {
  if (!dns) return [];
  const dnsPromise = family === 4 ? dns.resolve4(host) : dns.resolve6(host);
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('DNS timeout')), 5000)
  );
  try {
    return await Promise.race([dnsPromise, timeout]);
  } catch {
    return [];
  }
}

async function validateUrlSsrf(urlStr) {
  const parsedUrl = new URL(urlStr);
  const host = parsedUrl.hostname;
  if (/^(localhost|0\.0\.0\.0|::1)$/i.test(host)) {
    throw new Error(`SSRF blocked: illegal host ${host}`);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIp(host)) throw new Error(`SSRF blocked: private IP ${host}`);
  } else if (/^[0-9a-f:]+$/i.test(host) && host.includes(':')) {
    if (isPrivateIPv6(host)) throw new Error(`SSRF blocked: private IPv6 ${host}`);
  } else if (dns) {
    const v4 = await dnsResolveWithTimeout(host, 4);
    for (const ip of v4) { if (isPrivateIp(ip)) throw new Error(`SSRF blocked: ${host} resolved to private IP ${ip}`); }
    if (v4.length === 0) {
      const v6 = await dnsResolveWithTimeout(host, 6);
      for (const ip of v6) {
        if (isPrivateIPv6(ip)) {
          throw new Error(`SSRF blocked: ${host} resolved to private IPv6 ${ip}`);
        }
      }
    }
  }
  return true;
}

function buildFetchOpts(parsedUrl, signal) {
  const fetchOpts = {
    headers: { 'User-Agent': 'clash-verge/v1.3.8' },
    signal,
    redirect: 'manual'
  };
  if (parsedUrl.username || parsedUrl.password) {
    const user = decodeURIComponent(parsedUrl.username);
    const pass = decodeURIComponent(parsedUrl.password);
    const auth = (typeof btoa !== 'undefined')
      ? btoa(`${user}:${pass}`)
      : Buffer.from(`${user}:${pass}`).toString('base64');
    fetchOpts.headers['Authorization'] = `Basic ${auth}`;
    parsedUrl.username = '';
    parsedUrl.password = '';
  }
  return fetchOpts;
}

async function safeFetchText(url, options = {}) {
  const { maxRedirects = 5, timeoutMs = 15000, fullRedact = false } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let currentUrl = url;
  let redirects = 0;

  try {
    while (true) {
      await validateUrlSsrf(currentUrl);
      const parsedUrl = new URL(currentUrl);
      const fetchOpts = buildFetchOpts(parsedUrl, controller.signal);
      const res = await fetch(parsedUrl.toString(), fetchOpts);

      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        redirects++;
        if (redirects > maxRedirects) {
          throw new Error(`Too many redirects (>${maxRedirects})`);
        }
        const location = res.headers.get('location');
        if (!location) throw new Error(`Redirect with no Location header (status ${res.status})`);
        const nextUrl = new URL(location, currentUrl).toString();
        currentUrl = nextUrl;
        continue;
      }

      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      const text = await res.text();
      return { text, response: res, finalUrl: currentUrl };
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Fetch timeout (${timeoutMs / 1000}s): ${redactUrl(url, fullRedact)}`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchNodes(url, fullRedact = false, debug = false) {
  console.log(`[Builder] Fetching: ${redactUrl(url, fullRedact)}`);
  const { text: content, response: res } = await safeFetchText(url, { fullRedact });
  const subInfo = res.headers.get('subscription-userinfo');
  if (debug) {
    console.log(`[Builder] Debug response: status=${res.status}, content-length=${content.length}, content-type=${res.headers.get('content-type') || 'unknown'}, subInfo=${subInfo ? 'present' : 'missing'}`);
    console.log(`[Builder] Debug content preview: ${content.substring(0, 200).replace(/\n/g, '\\n')}`);
  }
  return { content, subInfo };
}

const BUILDER_VERSION = "v1.3.0";

async function buildProfile(userConfig, options = {}) {
  let configData = { proxies: [] };
  let hasInjectedTag = false;
  let globalUpload = 0, globalDownload = 0, globalTotal = 0, globalExpire = 0;
  
  // 简繁转换：入口处先将 config 中所有字符串值繁→简，确保后续匹配逻辑一致
  if (userConfig.enableChineseConvert) {
    userConfig = chineseConvert.deepConvertStrings(userConfig, chineseConvert.toSimplified);
  }

  let redactLevel = userConfig.redactLevel || 'partial';
  const debug = options.debug || false;

  console.log(`[Builder] 🔨 mihomo-toolkit-builder ${BUILDER_VERSION}`);

  // 启动概览：依赖状态 + 订阅概况
  const openccStatus = (() => {
    try { require.resolve('opencc-js'); return '已就绪'; } catch { return '未安装(降级)'; }
  })();
  const subCount = userConfig.subscriptions ? userConfig.subscriptions.length : 0;
  const urlSubs = userConfig.subscriptions ? userConfig.subscriptions.filter(s => s.url).length : 0;
  const uriSubs = userConfig.subscriptions ? userConfig.subscriptions.filter(s => s.uri).length : 0;
  console.log(`[Builder] 依赖: opencc-js ${openccStatus} | 订阅: ${subCount} 个 (URL ${urlSubs}, URI ${uriSubs})`);

  // 简繁转换开启但未安装依赖时给出明确提示
  if (userConfig.enableChineseConvert && openccStatus === '未安装(降级)') {
    console.warn(`[Builder] ⚠️ 已启用简繁转换但 opencc-js 未安装，功能不会生效。执行: npm install opencc-js`);
  }

  if (redactLevel === 'off' && (process.env.NODE_ENV === 'production' || options.production)) {
    throw new Error('[Security] redactLevel=off 不允许在生产环境使用！');
  }
  
  const fullRedact = (redactLevel === 'full');
  
  function parseSubInfoForGlobal(subInfo) {
    if (!subInfo) return;
    const { upload, download, total, expire } = parseSubscriptionInfo(subInfo);
    globalUpload += upload;
    globalDownload += download;
    globalTotal += total;
    if (expire > globalExpire) globalExpire = expire;
  }

  if (userConfig.subscriptions && Array.isArray(userConfig.subscriptions) && userConfig.subscriptions.length > 0) {
    for (const sub of userConfig.subscriptions) {
      if (!sub.url && !sub.uri) continue;
      try {
        let rawResult;
        if (sub.uri) {
          // uri 字段：直接节点，跳过 HTTP fetch，交给 parseContent 识别
          rawResult = { content: sub.uri, subInfo: null };
        } else {
          rawResult = await fetchNodes(sub.url, fullRedact, debug);
        }
        parseSubInfoForGlobal(rawResult.subInfo);
      const subConfig = parseContent(rawResult.content);
      let subProxies = subConfig.proxies || [];
      
      // URI 节点自定义名称覆盖
      if (sub.uri && sub.name && subProxies.length > 0) {
        subProxies[0].name = sub.name;
      }

      // URI 节点日志
      if (sub.uri) {
        const nameHint = subProxies[0] ? subProxies[0].name : '未知';
        console.log(`[Builder] URI 节点: ${nameHint}${sub.tag ? ` [${sub.tag}]` : ''}`);
      }
      
      let effectiveTag = sub.tag;
      let effectiveIndexPrefix = sub.indexPrefix;
        if (!effectiveTag) {
          const reg = /^\[([^\]]{1,12})\]/i;
          const tagCounts = {};
          for (const p of subProxies) {
            if (p.name) {
              const m = p.name.match(reg);
              if (m) {
                const tag = m[1].trim();
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
              }
            }
          }
          let bestTag = "";
          let maxCount = 0;
          for (const [t, c] of Object.entries(tagCounts)) {
            if (c > maxCount) { maxCount = c; bestTag = t; }
          }
          effectiveTag = bestTag;
          if (!effectiveTag && sub.url && sub.url.startsWith('http')) {
            try { effectiveTag = new URL(sub.url).hostname; } catch(e) {}
          }
          if (!effectiveTag) effectiveTag = "订阅";
        }

        let resetNodeName = "";
        const resetNode = subProxies.find(p => p.name && (p.name.includes('重置') || p.name.toLowerCase().includes('reset')));
        if (resetNode) {
          let cleanName = resetNode.name.replace(/^\[.*?\]\s*/, '').trim();
          const daysMatch = cleanName.match(/(\d+)\s*(?:天|Days?)/i);
          const dateMatch = cleanName.match(/\d{4}[-\/]\d{2}[-\/]\d{2}/);
          
          if (daysMatch) {
            resetNodeName = `距离重置剩余：${daysMatch[1]} 天`;
          } else if (dateMatch) {
            resetNodeName = `流量重置时间：${dateMatch[0]}`;
          } else {
            const numMatch = cleanName.match(/\d+/);
            if (numMatch) {
              resetNodeName = `距离重置剩余：${numMatch[0]} 天`;
            } else {
              resetNodeName = cleanName;
            }
          }
        }

        const REGEX_INFO = /剩余|到期|套餐|流量|时间|有效|更新|官网|维护|群|发布|节点说明|失效|获取|网址|Q群|电报|Tg群|下次|关注|官方|签到/i;
        const rawCount = subProxies.length;
        subProxies = subProxies.filter(p => {
          if (REGEX_INFO.test(p.name)) {
            console.log(`[Builder]   🗑️ [过滤信息] 「${p.name}」`);
            return false;
          }
          return true;
        });
        const filteredCount = rawCount - subProxies.length;
        
        // 通过字段传输订阅标签（不再污染名字），单订阅也打 _subTag 供下游使用
        // 是否启用标签提取由 enableAirportTag 控制，多订阅时 builder 自动强制开启
        if (sub.tag) {
          subProxies.forEach(p => {
            if (!p._subTag) p._subTag = sub.tag;
          });
        }

        // URI 注入节点自动加入白名单，无需手动配置
        // 确保节点能通过 pure 清洗并正常注入 customNodeGroups 指定的策略组
        // pure 白名单匹配会同时检查 proxy._subTag 字段（无需名字包含 tag）
        if (sub.uri && sub.tag) {
          const whitelist = userConfig.whitelistKeywords || [];
          const tagLower = sub.tag.toLowerCase();
          if (!whitelist.some(k => k.toLowerCase() === tagLower)) {
            if (!userConfig.whitelistKeywords) userConfig.whitelistKeywords = [];
            userConfig.whitelistKeywords.push(sub.tag);
          }
        }
        
        if (effectiveIndexPrefix) {
          subProxies.forEach(p => { p._indexPrefix = effectiveIndexPrefix; });
        }
        
        const { nodes: synthNodes, expireDays } = generateInfoNodes(rawResult.subInfo, effectiveTag);
        if (resetNodeName && (expireDays === -1 || expireDays > 30)) {
          synthNodes.push({
            name: `[${effectiveTag}] ${resetNodeName}`,
            type: 'direct',
            server: '1.0.0.1',
            port: 80,
            isSyntheticInfo: true
          });
        }

        if (synthNodes.length > 0) {
          synthNodes.forEach(n => console.log(`[Builder]   ℹ️ [合成信息] 「${n.name}」`));
          subProxies.unshift(...synthNodes);
        }
        
        if (sub.tag && urlSubs > 1) {
          hasInjectedTag = true;
        }
        configData.proxies = configData.proxies.concat(subProxies);
        
        // 订阅处理摘要
        const nodeCount = subProxies.length;
        if (sub.uri) {
          console.log(`[Builder]   → 解析完成: ${nodeCount} 个节点${sub.tag ? ` [${sub.tag}]` : ''}`);
        } else {
          const parts = [`${nodeCount} 个节点`];
          if (filteredCount > 0) parts.push(`过滤 ${filteredCount} 个`);
          console.log(`[Builder]   → 解析完成: ${parts.join(', ')}${sub.tag ? ` [${sub.tag}]` : ''}`);
        }
      } catch (e) {
        const subId = sub.uri ? 'direct-uri' : redactUrl(sub.url, fullRedact);
        console.error(`[Builder] Error processing subscription ${subId}: ${e.message}`);
      }
    }
  } else if (options.url) {
    let rawResult;
    if (/^(vless|vmess|trojan|ss):\/\//i.test(options.url)) {
      // 直接 URI 节点，跳过 HTTP fetch，交给 parseContent 识别
      console.log(`[Builder] URI 节点: ${options.url.split('#').pop() || '未知'}`);
      rawResult = { content: options.url, subInfo: null };
    } else {
      rawResult = await fetchNodes(options.url, fullRedact);
    }
    parseSubInfoForGlobal(rawResult.subInfo);
    configData = parseContent(rawResult.content);
    const nodeCount = configData.proxies ? configData.proxies.length : 0;
    console.log(`[Builder]   → 解析完成: ${nodeCount} 个节点`);
    const { nodes: synthNodes } = generateInfoNodes(rawResult.subInfo, "");
    if (synthNodes.length > 0 && configData.proxies) {
      configData.proxies.unshift(...synthNodes);
    }
  } else {
    throw new Error("No URL or subscriptions provided.");
  }

  // =========================================================================
  // 配置继承与冲突协调
  // 根级 userConfig → 同时继承给 pure 和 toolkit
  // pureConfig / toolkitConfig → 各自覆盖根级同名配置
  // =========================================================================
  let pureUserConfig = { ...userConfig, ...(userConfig.pureConfig || {}) };
  let toolkitUserConfig = { ...userConfig, ...(userConfig.toolkitConfig || {}) };

  // 多订阅时强制双端启用标签提取（_subTag 字段已注入，需 enableAirportTag 激活读取）
  // 标签是否写入最终节点名，由 rename 模板中是否包含 {airport} 决定
  if (hasInjectedTag) {
    pureUserConfig.enableAirportTag = true;
    toolkitUserConfig.enableAirportTag = true;
  }

  const targetType = options.type || userConfig.type || 'pure';

  // --- full 模式自动协调（硬约束，无条件强制，防止用户误配破坏两阶段流水线）---
  if (targetType === 'full') {
    // toolkit 强制跳过二次重命名，避免覆盖 pure 的清洗结果
    toolkitUserConfig.enableNodeRename = false;
    // pure 强制输出文字特征（不转 Emoji），让 toolkit 能识别文字并正确分桶
    pureUserConfig.showFeatureIcon = false;
    // 同步根级白名单/注入规则到双端，确保 pure 放行的节点 toolkit 不会拦截
    // （spread 是覆盖语义，若 pureConfig/toolkitConfig 各自定义了不同值会冲掉根级，这里合并回去）
    const whitelist = userConfig.whitelistKeywords || [];
    const specialRules = userConfig.specialNodeRules || [];
    if (whitelist.length > 0) {
      pureUserConfig.whitelistKeywords = [...new Set([...(pureUserConfig.whitelistKeywords || []), ...whitelist])];
      toolkitUserConfig.whitelistKeywords = [...new Set([...(toolkitUserConfig.whitelistKeywords || []), ...whitelist])];
    }
    if (specialRules.length > 0) {
      pureUserConfig.specialNodeRules = [...new Set([...(pureUserConfig.specialNodeRules || []), ...specialRules])];
      toolkitUserConfig.specialNodeRules = [...new Set([...(toolkitUserConfig.specialNodeRules || []), ...specialRules])];
    }
  }

  let finalProxies = configData.proxies;
  let result = null;

  // 简繁转换：pure 处理前将节点名统一转为简体，提高 pure 和 toolkit 的识别率
  if (userConfig.enableChineseConvert) {
    configData.proxies = configData.proxies.map(proxy => ({
      ...proxy,
      name: chineseConvert.toSimplified(proxy.name)
    }));
  }

  if (targetType === 'pure' || targetType === 'full') {
    if (targetType === 'full') console.log('[Builder] === 阶段 1/2: pure-nodes 节点清洗 ===');
    result = await operator(configData.proxies, "clash", pureUserConfig);
    finalProxies = Array.isArray(result) ? result : result.proxies;
  }

  configData.proxies = finalProxies;
  let outputData = configData;
  
  if (targetType === 'full' || targetType === 'toolkit') {
    if (targetType === 'full') console.log('[Builder] === 阶段 2/2: mihomo-toolkit 策略组构建 ===');
    outputData = toolkitMain(outputData, toolkitUserConfig);
  }

  // 简繁转换：toolkit 处理后按配置输出简体或繁体
  if (userConfig.enableChineseConvert) {
    const modeLabel = userConfig.chineseConvertMode === 's2t' ? '繁体' : '简体';
    console.log(`[Builder] 简繁转换: 输出 ${modeLabel}`);
    const convertFn = userConfig.chineseConvertMode === 's2t' ? chineseConvert.toTraditional : chineseConvert.toSimplified;
    const nameMap = {};

    // 转换节点名
    for (const proxy of outputData.proxies) {
      const oldName = proxy.name;
      proxy.name = convertFn(proxy.name);
      if (oldName !== proxy.name) nameMap[oldName] = proxy.name;
    }

    // 转换策略组名 + 组内引用 + use 引用
    if (outputData['proxy-groups']) {
      for (const group of outputData['proxy-groups']) {
        const oldName = group.name;
        group.name = convertFn(group.name);
        if (oldName !== group.name) nameMap[oldName] = group.name;
        if (group.proxies) group.proxies = group.proxies.map(p => convertFn(p));
        if (group.use) group.use = group.use.map(u => convertFn(u));
      }
    }

    // 转换 rules 中的组名引用（如 RULE-SET,ads,🚫 广告拦截 → 🚫 廣告攔截）
    if (outputData.rules && Object.keys(nameMap).length > 0) {
      outputData.rules = outputData.rules.map(rule => {
        for (const [oldName, newName] of Object.entries(nameMap)) {
          if (rule.includes(oldName)) {
            rule = rule.replace(oldName, newName);
          }
        }
        return rule;
      });
    }
  }

  // 构建摘要
  if (targetType === 'full' || targetType === 'toolkit') {
    const groups = outputData['proxy-groups'] || [];
    const proxies = outputData.proxies || [];
    const featureSwitches = [
      toolkitUserConfig.enableAI && 'AI', toolkitUserConfig.enableStreaming && '流媒体',
      toolkitUserConfig.enableGame && '游戏', toolkitUserConfig.enableTelegram && 'TG',
      toolkitUserConfig.enableGitHub && 'GitHub', toolkitUserConfig.enableScholar && 'Scholar',
      toolkitUserConfig.enableSystemServices && '系统', toolkitUserConfig.enableDomesticGroup && '中国分流',
      toolkitUserConfig.enableAdBlock && '广告拦截'
    ].filter(Boolean);
    console.log(`[Builder] ✅ 构建完成: ${proxies.length} 个节点, ${groups.length} 个策略组` +
      (featureSwitches.length > 0 ? ` | ${featureSwitches.join(' ')}` : ''));
  }
  
  let yamlStr = yaml.stringify(outputData);
    
  if (globalTotal > 0) {
    yamlStr = `# subscription-userinfo: upload=${globalUpload}; download=${globalDownload}; total=${globalTotal}; expire=${globalExpire}\n` +
              `# profile-web-page-url: https://github.com/mihomo-toolkit\n` +
              `# upload=${globalUpload}; download=${globalDownload}; total=${globalTotal}; expire=${globalExpire}\n` +
              yamlStr;
  }
  
  return {
    yamlStr,
    meta: result && !Array.isArray(result) ? result.meta : null,
    userInfo: {
      upload: globalUpload,
      download: globalDownload,
      total: globalTotal,
      expire: globalExpire
    }
  };
}

// 单次请求资源限制默认值（保守值，防止恶意 config 注入导致资源耗尽）
const DEFAULT_REQUEST_LIMITS = {
  maxSubscriptionUrls: 20,        // ?url= 参数最多允许的订阅数
  maxRemoteConfigBytes: 1048576,  // ?config= 远程配置文件最大字节数 (1MB)
  maxTotalNodes: 5000,            // 单次构建允许的最大节点总数
  perSubscriptionMaxNodes: 3000   // 单个订阅最多允许的节点数
};

// 校验单次请求的资源限制，返回 null 表示通过，返回 Error 表示超限
function validateRequestLimits({ subscriptionUrls, remoteConfigSize, totalNodes, perSubCounts, limits = {} }) {
  const merged = { ...DEFAULT_REQUEST_LIMITS, ...limits };
  if (subscriptionUrls && subscriptionUrls.length > merged.maxSubscriptionUrls) {
    return new Error(`Too many subscription URLs: ${subscriptionUrls.length} > ${merged.maxSubscriptionUrls}`);
  }
  if (remoteConfigSize && remoteConfigSize > merged.maxRemoteConfigBytes) {
    return new Error(`Remote config too large: ${remoteConfigSize} > ${merged.maxRemoteConfigBytes} bytes`);
  }
  if (totalNodes && totalNodes > merged.maxTotalNodes) {
    return new Error(`Too many total nodes: ${totalNodes} > ${merged.maxTotalNodes}`);
  }
  if (perSubCounts) {
    for (const [url, count] of Object.entries(perSubCounts)) {
      if (count > merged.perSubscriptionMaxNodes) {
        return new Error(`Subscription returned too many nodes: ${count} > ${merged.perSubscriptionMaxNodes}`);
      }
    }
  }
  return null;
}

module.exports = { buildProfile, redactUrl, isAllowedUrl, safeFetchText, validateRequestLimits, DEFAULT_REQUEST_LIMITS };
