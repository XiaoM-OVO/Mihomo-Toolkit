const yaml = require('yaml');
const { operator } = require('./pure-nodes.js');
const { main: toolkitMain } = require('./mihomo-toolkit.js');

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

async function fetchNodes(url, fullRedact = false) {
  console.log(`[Builder] Fetching: ${redactUrl(url, fullRedact)}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    // 处理 URL 中嵌入的 Basic Auth 凭据(支持 Node/Worker/浏览器)
    const parsedUrl = new URL(url);
    const fetchOpts = {
      headers: { 'User-Agent': 'clash-verge/v1.3.8' },
      signal: controller.signal
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
    const res = await fetch(parsedUrl.toString(), fetchOpts);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    return { content: await res.text(), subInfo: res.headers.get('subscription-userinfo') };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Fetch timeout (15s): ${redactUrl(url, fullRedact)}`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function buildProfile(userConfig, options = {}) {
  let configData = { proxies: [] };
  let hasInjectedTag = false;
  let globalUpload = 0, globalDownload = 0, globalTotal = 0, globalExpire = 0;
  
  let redactLevel = userConfig.redactLevel || 'partial';

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
          rawResult = await fetchNodes(sub.url, fullRedact);
        }
        parseSubInfoForGlobal(rawResult.subInfo);
      const subConfig = parseContent(rawResult.content);
      let subProxies = subConfig.proxies || [];
      
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
        subProxies = subProxies.filter(p => !REGEX_INFO.test(p.name));
        
        if (sub.tag) {
          const whitelistLower = (userConfig.whitelistKeywords || []).map(k => k.toLowerCase());
          subProxies.forEach(p => {
            if (p.name) {
              if (whitelistLower.some(k => p.name.toLowerCase().includes(k))) return;
              p.name = `[${sub.tag}] ${p.name}`;
            }
          });
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
          subProxies.unshift(...synthNodes);
        }
        
        if (sub.tag) {
          hasInjectedTag = true;
        }
        configData.proxies = configData.proxies.concat(subProxies);
      } catch (e) {
        const subId = sub.uri ? 'direct-uri' : redactUrl(sub.url, fullRedact);
        console.error(`[Builder] Error processing subscription ${subId}: ${e.message}`);
      }
    }
  } else if (options.url) {
    let rawResult;
    if (/^(vless|vmess|trojan|ss):\/\//i.test(options.url)) {
      // 直接 URI 节点，跳过 HTTP fetch，交给 parseContent 识别
      rawResult = { content: options.url, subInfo: null };
    } else {
      rawResult = await fetchNodes(options.url, fullRedact);
    }
    parseSubInfoForGlobal(rawResult.subInfo);
    configData = parseContent(rawResult.content);
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

  // --- 冲突协调规则 ---
  if (hasInjectedTag) pureUserConfig.enableAirportTag = true;
  const targetType = options.type || userConfig.type || 'pure';
  // full 模式: toolkit 强制跳过二次重命名，避免覆盖 pure 的清洗结果
  if (targetType === 'full' && typeof toolkitUserConfig.enableNodeRename === 'undefined') {
    toolkitUserConfig.enableNodeRename = false;
  }
  // full 模式: 同步注入节点规则到双端，确保识别一致
  if (targetType === 'full') {
    const whitelist = userConfig.whitelistKeywords || [];
    const specialRules = userConfig.specialNodeRules || [];
    if (whitelist.length > 0) {
      pureUserConfig.whitelistKeywords = [...new Set([...(pureUserConfig.whitelistKeywords || []), ...whitelist])];
      toolkitUserConfig.whitelistKeywords = [...new Set([...(toolkitUserConfig.whitelistKeywords || []), ...whitelist])];
    }
    if (specialRules.length > 0) {
      pureUserConfig.specialNodeRules = [...(pureUserConfig.specialNodeRules || []), ...specialRules];
      toolkitUserConfig.specialNodeRules = [...(toolkitUserConfig.specialNodeRules || []), ...specialRules];
    }
  }

  let finalProxies = configData.proxies;
  let result = null;

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

module.exports = { buildProfile, redactUrl };
