// =========================================================================
// Clash Verge Rev (Mihomo内核) 简易优化配置脚本
// 版本: v1.4.0 (2026-06-02)
// 作者: XiaoM-OVO
// 仓库: https://github.com/XiaoM-OVO/mihomo-toolkit
// 说明: 自动清洗节点名称 + 结构化自动分类 + 智能隐藏无节点策略组 + Lazy懒测速优化 + BT防封
// =========================================================================
// 💡 【节点清洗图标说明】
// 🤖 : OpenAI / ChatGPT      ♊ : Google Gemini       🦀 : Anthropic Claude
// 📺 : 流媒体访问 (NF/P+)     🎮 : 游戏 / FullCone      ⚡ : Hysteria / 高速
// 🛡️ : AnyTLS / 安全协议      📱 : WAP 移动优化         ⏬ : 下载 / BT 专用
// 🆓 : 免费 / 公益节点
// =========================================================================

function main(config) {
  const proxies = config.proxies || [];

  // =========================================================================
  // --- 1. 节点名称清洗与重组 (高级结构化处理) ---
  // =========================================================================
  const regionReplacements = [
    { reg: /香港|HKT?|Hong Kong/i, name: "香港", icon: "🇭🇰" },
    { reg: /台湾|TW|Taiwan/i, name: "台湾", icon: "🇹🇼" },
    { reg: /日本|JP|Japan/i, name: "日本", icon: "🇯🇵" },
    { reg: /韩国|KR|Korea/i, name: "韩国", icon: "🇰🇷" },
    { reg: /新加坡|SG|Singapore/i, name: "新加坡", icon: "🇸🇬" },
    { reg: /美国|USLA|US|LA|Los Angeles/i, name: "美国", icon: "🇺🇸" },
    { reg: /英国|UK|United Kingdom/i, name: "英国", icon: "🇬🇧" },
    { reg: /德国|DE|Germany/i, name: "德国", icon: "🇩🇪" },
    { reg: /法国|FR|France/i, name: "法国", icon: "🇫🇷" },
    { reg: /加拿大|CA|Canada/i, name: "加拿大", icon: "🇨🇦" },
    { reg: /印度|IN|India/i, name: "印度", icon: "🇮🇳" },
    { reg: /俄罗斯|RU|Russia/i, name: "俄罗斯", icon: "🇷🇺" },
    { reg: /乌克兰|UA|Ukraine/i, name: "乌克兰", icon: "🇺🇦" },
    { reg: /土耳其|TR|Turkey/i, name: "土耳其", icon: "🇹🇷" },
    { reg: /阿根廷|AR|Argentina/i, name: "阿根廷", icon: "🇦🇷" },
    { reg: /尼日利亚|NG|Nigeria/i, name: "尼日利亚", icon: "🇳🇬" },
    { reg: /越南|VN|Vietnam/i, name: "越南", icon: "🇻🇳" },
    { reg: /澳大利亚|AU|Australia|Sydney/i, name: "澳大利亚", icon: "🇦🇺" },
    { reg: /巴西|BR|Brazil/i, name: "巴西", icon: "🇧🇷" },
    { reg: /阿联酋|AE|Dubai|UAE/i, name: "阿联酋", icon: "🇦🇪" }
  ];

  const processedData = proxies.map(proxy => {
    let rawName = proxy.name;
    // 基础过滤
    if (['DIRECT', 'REJECT', 'COMPATIBLE'].includes(rawName)) return { skip: true };
    if (/剩余流量|套餐到期|有效|官网|过期|通知|更新|重置/.test(rawName)) return { isInfo: true, proxy };

    let name = rawName;
    let suffixArr = [];
    let multiStr = "";

    // 提取倍率 (如 x1.5)
    const multiMatch = name.match(/[xX]\d+(\.\d+)?/);
    let multiValue = NaN;
    if (multiMatch) {
      multiStr = multiMatch[0].toLowerCase();
      multiValue = parseFloat(multiStr.slice(1));
      name = name.replace(multiMatch[0], "");
    }

    // 提取线路特征
    const lineKeywords = ["IEPL", "IPLC", "BGP", "CN2", "GIA", "专线", "直连", "中转", "隧道", "CMI", "CUG", "PCCW", "HGC", "HSBC", "优化", "9929", "4837"];
    const lineRegex = new RegExp(lineKeywords.join("|"), "ig");
    let lineMatch;
    let lineInfos = [];
    let icons = [];
    while ((lineMatch = lineRegex.exec(name)) !== null) { 
      lineInfos.push(lineMatch[0].length > 2 ? lineMatch[0].toUpperCase() : lineMatch[0]); 
    }
    if (lineInfos.length > 0) { 
      suffixArr.push(...Array.from(new Set(lineInfos))); 
      name = name.replace(lineRegex, ""); 
    }
    if (multiStr) suffixArr.push(multiStr);
    
    // 自动识别低倍率节点作为下载节点
    if (!isNaN(multiValue) && multiValue < 1) icons.push("⏬");

    // 识别特殊功能标签
    const iconRules = [
      { reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i, icon: "🤖" },
      { reg: /\bGemini\b/i, icon: "♊" },
      { reg: /\bClaude\b/i, icon: "🦀" },
      { reg: /(?:流媒体|解锁)|\b(?:Netflix|NF|Disney\+|YouTube)\b/i, icon: "📺" },
      { reg: /(?:免费|白嫖|公益)/i, icon: "🆓" },
      { reg: /(?:下载)|\bBT\b/i, icon: "⏬" },
      { reg: /(?:游戏)|\b(?:Game|FullCone)\b/i, icon: "🎮" },
      { reg: /\bWAP\b/i, icon: "📱" },
      { reg: /\b(?:HY2|Hysteria)\b/i, icon: "⚡" },
      { reg: /-A$|\bAnyTLS\b/i, icon: "🛡️" }
    ];

    iconRules.forEach(rule => {
      if (rule.reg.test(name)) {
        icons.push(rule.icon);
        name = name.replace(rule.reg, "");
      }
    });

    // 识别地区信息并去重国旗
    let regionInfo = null;
    for (const item of regionReplacements) {
      if (item.reg.test(name)) {
        regionInfo = item;
        name = name.replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, "");
        name = name.replace(item.reg, "");
        break;
      }
    }

    // 清理多余杂质字符，组装最终名称
    name = name.replace(/\d+/g, "").replace(/[-_\|\s]+/g, " ").trim();
    name = name || "其他"; // ⬅️ 如果名字被清洗空了，直接默认为“其他”
    
    let groupKey = regionInfo ? regionInfo.name : name;
    return { proxy, regionInfo, groupKey, name, icons, suffixArr };
  }).filter(d => d && !d.skip && !d.isInfo);

  // 统计各组数量并附加序号
  const counts = {};
  processedData.forEach(d => { counts[d.groupKey] = (counts[d.groupKey] || 0) + 1; });

  const groupTrack = {};
  processedData.forEach(d => {
    groupTrack[d.groupKey] = (groupTrack[d.groupKey] || 0) + 1;
    let numStr = counts[d.groupKey] > 1 ? ` [${groupTrack[d.groupKey].toString().padStart(2, '0')}]` : "";
    
    // ⬅️ 这里的逻辑变得极其干净，直接拼接
    let baseName = d.regionInfo ? `${d.regionInfo.icon} ${d.regionInfo.name}` : d.name;
    let finalName = `${baseName}${numStr}`;
    
    if (d.icons.length > 0) finalName += ` ${Array.from(new Set(d.icons)).join("")}`;
    if (d.suffixArr.length > 0) finalName += ` | ${d.suffixArr.join(" ")}`;
    
    d.proxy.name = finalName;
  });

  // =========================================================================
  // --- 2. 节点分类与特征提取 ---
  // =========================================================================
  const proxyNames = proxies.map(p => p.name);
  const validProxies = proxyNames.filter(n => !/剩余流量|套餐到期|有效|官网|过期|通知|更新|重置/.test(n));
  const infoNodes = proxyNames.filter(n => /剩余流量|套餐到期|有效|官网|过期|通知|更新|重置/.test(n));
  const allProxies = validProxies.length > 0 ? validProxies : ["DIRECT"];

  // 提取特征节点供特殊策略组使用
  const ChatGPTNodes = validProxies.filter(n => n.includes("🤖"));
  const GeminiNodes = validProxies.filter(n => n.includes("♊"));
  const ClaudeNodes = validProxies.filter(n => n.includes("🦀"));
  const gameNodes = validProxies.filter(n => n.includes("🎮"));
  const downloadOrLowMultiNodes = validProxies.filter(n => n.includes("⏬") || /x0\.\d+/i.test(n));

  // =========================================================================
  // --- 3. 地区自动归类与智能可用性检查 ---
  // =========================================================================
  const regionMap = {
    hk: { name: "🇭🇰 香港节点", keywords: ["香港", "HK", "Hong Kong"] },
    tw: { name: "🇹🇼 台湾节点", keywords: ["台湾", "TW", "Taiwan"] },
    jp: { name: "🇯🇵 日本节点", keywords: ["日本", "JP", "Japan"] },
    kr: { name: "🇰🇷 韩国节点", keywords: ["韩国", "KR", "Korea"] },
    sg: { name: "🇸🇬 新加坡节点", keywords: ["新加坡", "SG", "Singapore"] },
    us: { name: "🇺🇸 美国节点", keywords: ["美国", "US", "USA", "United States"] },
    eu: { name: "🇪🇺 欧洲节点", keywords: ["英国", "德国", "法国", "荷兰", "乌克兰", "俄罗斯", "土耳其", "欧洲", "EU", "Europe", "UK", "DE", "FR", "NL", "UA", "RU", "TR"] }
  };

  const matched = new Set();
  const regionNodes = { hk: [], tw: [], jp: [], kr: [], sg: [], us: [], eu: [] };

  validProxies.forEach(name => {
    for (const [key, meta] of Object.entries(regionMap)) {
      if (meta.keywords.some(kw => name.includes(kw))) {
        regionNodes[key].push(name);
        matched.add(name);
        break; 
      }
    }
  });

  const otherNodes = validProxies.filter(n => !matched.has(n));
  
  // 【核心逻辑】获取当前真正有节点的地区组名字，防止出现空选项导致内核报错
  const activeRegionGroups = Object.keys(regionMap)
    .filter(key => regionNodes[key].length > 0)
    .map(key => regionMap[key].name);
  if (otherNodes.length > 0) activeRegionGroups.push("🌐 其他节点");

  // =========================================================================
  // --- 4. 策略组构建 (Proxy Groups) ---
  // =========================================================================
  
  // 辅助函数：如果列表为空，则返回 DIRECT 兜底
  const safeList = (list) => (list && list.length > 0) ? list : ["DIRECT"];

  // 构建主菜单通用选项
  const standardOptions = [ "📍 节点选择", "🚀 自动选择", "🛡️ 故障转移" ];
  if (downloadOrLowMultiNodes.length > 0) standardOptions.push("⏬ 负载均衡");
  standardOptions.push(...activeRegionGroups);

  // 准备 AI 组专用列表 (仅包含有节点的地区)
  const aiProxies = activeRegionGroups.length > 0 ? [...activeRegionGroups] : ["DIRECT"];

  config["proxy-groups"] = [
    // --- 核心控制组 ---
    { name: "📍 节点选择", type: "select", proxies: ["🚀 自动选择", "🛡️ 故障转移", ...infoNodes, ...activeRegionGroups, "DIRECT"] },
    { name: "🚀 自动选择", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, tolerance: 50, proxies: allProxies },
    { name: "🛡️ 故障转移", type: "fallback", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: safeList([...activeRegionGroups, "DIRECT"]) },
    
    // --- 下载专用：负载均衡 ---
    { 
      name: "⏬ 负载均衡", 
      type: "select", 
      proxies: downloadOrLowMultiNodes.length > 0 
        ? ["DIRECT", "⚖️ 负载均衡内部池", "🚀 自动选择", ...downloadOrLowMultiNodes] 
        : ["DIRECT", "🚀 自动选择"],
      hidden: downloadOrLowMultiNodes.length === 0  
    },
    { 
      name: "⚖️ 负载均衡内部池", 
      type: "load-balance", 
      strategy: "round-robin", 
      url: "http://www.gstatic.com/generate_204", 
      interval: 300, 
      lazy: true, 
      proxies: safeList(downloadOrLowMultiNodes),
      hidden: downloadOrLowMultiNodes.length === 0 
    },
    
    // --- AI 智能服务 (动态适配有效地区) ---
    { name: "🤖 OpenAI", type: "select", proxies: [...aiProxies, ...safeList(ChatGPTNodes)] },
    { name: "♊ Gemini", type: "select", proxies: [...aiProxies, ...safeList(GeminiNodes)] },
    { name: "🦀 Claude", type: "select", proxies: [...aiProxies, ...safeList(ClaudeNodes)] },
    
    // --- 业务与流媒体分流 ---
    { name: "🎓 学术网站", type: "select", proxies: ["🇺🇸 美国节点", "🇪🇺 欧洲节点", "📍 节点选择", "DIRECT"] },
    { name: "🎮 游戏服务", type: "select", proxies: ["DIRECT", ...standardOptions, ...safeList(gameNodes)] },
    { name: "📺 哔哩哔哩", type: "select", proxies: ["DIRECT", "🇭🇰 香港节点", "🇹🇼 台湾节点"] },
    { name: "📺 YouTube", type: "select", proxies: [...standardOptions, "DIRECT"] },
    { name: "🎬 Netflix", type: "select", proxies: [...standardOptions, "DIRECT"] },
    { name: "🐱 GitHub", type: "select", proxies: [...standardOptions, "DIRECT"] },
    { name: "✈️ Telegram", type: "select", proxies: [...standardOptions, "DIRECT"] },

    // --- 系统基础服务 ---
    { name: "Ⓜ️ Microsoft", type: "select", proxies: ["DIRECT", ...standardOptions] },
    { name: "🚅 Google", type: "select", proxies: [...standardOptions, "DIRECT"] },
    { name: "🍎 Apple", type: "select", proxies: ["DIRECT", ...standardOptions] },

    // --- 全局状态组 ---
    { name: "🐟 漏网之鱼", type: "select", proxies: ["📍 节点选择", "🚀 自动选择", "DIRECT"] },
    { name: "🚫 广告拦截", type: "select", proxies: ["REJECT", "DIRECT"] },
    
    // --- 地区自动测速组  ---
    { name: "🇭🇰 香港节点", type: "url-test", url: "http://cp.cloudflare.com/generate_204", interval: 180, tolerance: 100, lazy: true, proxies: safeList(regionNodes.hk), hidden: regionNodes.hk.length === 0 },
    { name: "🇹🇼 台湾节点", type: "url-test", url: "http://cp.cloudflare.com/generate_204", interval: 180, tolerance: 100, lazy: true, proxies: safeList(regionNodes.tw), hidden: regionNodes.tw.length === 0 },
    { name: "🇯🇵 日本节点", type: "url-test", url: "http://cp.cloudflare.com/generate_204", interval: 180, tolerance: 100, lazy: true, proxies: safeList(regionNodes.jp), hidden: regionNodes.jp.length === 0 },
    { name: "🇰🇷 韩国节点", type: "url-test", url: "http://cp.cloudflare.com/generate_204", interval: 180, tolerance: 100, lazy: true, proxies: safeList(regionNodes.kr), hidden: regionNodes.kr.length === 0 },
    { name: "🇸🇬 新加坡节点", type: "url-test", url: "http://cp.cloudflare.com/generate_204", interval: 180, tolerance: 100, lazy: true, proxies: safeList(regionNodes.sg), hidden: regionNodes.sg.length === 0 },
    { name: "🇺🇸 美国节点", type: "url-test", url: "http://cp.cloudflare.com/generate_204", interval: 180, tolerance: 100, lazy: true, proxies: safeList(regionNodes.us), hidden: regionNodes.us.length === 0 },
    { name: "🇪🇺 欧洲节点", type: "url-test", url: "http://cp.cloudflare.com/generate_204", interval: 180, tolerance: 100, lazy: true, proxies: safeList(regionNodes.eu), hidden: regionNodes.eu.length === 0 },
    { name: "🌐 其他节点", type: "select", proxies: safeList(otherNodes), hidden: otherNodes.length === 0 }
  ];

  // =========================================================================
  // --- 5. 规则集配置 (Rule Providers) ---
  // =========================================================================
  const repo = "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta";
  const ruleProviders = {
    // 基础规则集
    "lan-domain": "geo/geosite/private.yaml",
    "lan-ip": "geo/geoip/private.yaml",
    "ads": "geo/geosite/category-ads-all.yaml",
    
    // BT与P2P防封规则集
    "bt-trackers": "geo/geosite/bt.yaml",
    "bt-peers": "geo/geoip/bt.yaml",

    // 下载与BT专用规则集
    "download-android": "geo/geosite/category-android-app-download.yaml",
    "download-games": "geo/geosite/category-game-platforms-download.yaml",
    "download-games-cn": "geo/geosite/category-game-platforms-download@cn.yaml",
    // AI规则集
    "openai": "geo/geosite/openai.yaml",
    "gemini": "geo/geosite/google-gemini.yaml",
    "claude": "geo/geosite/anthropic.yaml",
    // 业务规则集
    "github": "geo/geosite/github.yaml",
    "telegram": "geo/geosite/telegram.yaml",
    "bilibili": "geo/geosite/bilibili.yaml",
    "youtube": "geo/geosite/youtube.yaml",
    "netflix": "geo/geosite/netflix.yaml",
    "google": "geo/geosite/google.yaml",
    "apple": "geo/geosite/apple.yaml",
    "microsoft": "geo/geosite/microsoft.yaml",
    // 游戏规则集
    "steam": "geo/geosite/steam.yaml",
    "steam-cn": "geo/geosite/steam@cn.yaml",
    "epic": "geo/geosite/epicgames.yaml",
    // 学术规则集
    "scholar": "geo/geosite/category-scholar-!cn.yaml",
    // 地理位置规则集
    "non-cn": "geo/geosite/geolocation-!cn.yaml",
    "cn-domain": "geo/geosite/cn.yaml",
    "telegram-ip": "geo/geoip/telegram.yaml",
    "cn-ip": "geo/geoip/cn.yaml",
  };

  config["rule-providers"] = Object.fromEntries(
    Object.entries(ruleProviders).map(([name, path]) => [
      name,
      {
        type: "http",
        behavior: path.includes("geoip") ? "ipcidr" : "domain",
        url: `${repo}/${path}`,
        path: `./ruleset/${name}.yaml`,
        interval: 86400,
        proxy: "🚀 自动选择" 
      }
    ])
  );

  // =========================================================================
  // --- 6. 策略分流规则 (Rules) ---
  // =========================================================================
  config["rules"] = [
    // --- 🏠 局域网直连 ---
    "RULE-SET,lan-domain,DIRECT",
    "RULE-SET,lan-ip,DIRECT,no-resolve", 

    // --- 🚫 广告拦截 (必须放在最前，防止被其他规则放行) ---
    "RULE-SET,ads,🚫 广告拦截",

    // --- 🧲 BT/P2P 防封保护 (必须直连，防止机场封号) ---
    "PROCESS-NAME,qBittorrent.exe,DIRECT",
    "PROCESS-NAME,Thunder.exe,DIRECT",
    "RULE-SET,bt-trackers,DIRECT",
    "RULE-SET,bt-peers,DIRECT,no-resolve",

    // --- ⏬ 高速下载与薅羊毛分流 ---
    "PROCESS-NAME,IDM.exe,⏬ 负载均衡",
    "RULE-SET,download-games-cn,DIRECT",
    "RULE-SET,download-games,⏬ 负载均衡",
    "RULE-SET,download-android,⏬ 负载均衡",

    // --- 🎓 学术分流 ---
    "DOMAIN-KEYWORD,sci-hub,🎓 学术网站", 
    "RULE-SET,scholar,🎓 学术网站", 

    // --- 🎮 游戏分流 ---
    "DOMAIN-SUFFIX,steamusercontent.com,🎮 游戏服务",
    "RULE-SET,steam-cn,DIRECT",
    "DOMAIN-SUFFIX,steamserver.net,DIRECT",
    "RULE-SET,steam,🎮 游戏服务",
    "RULE-SET,epic,🎮 游戏服务",
    "DOMAIN-SUFFIX,epicgames.com,DIRECT",

    // --- 🤖 AI 服务分流 ---
    "RULE-SET,openai,🤖 OpenAI",
    "RULE-SET,gemini,♊ Gemini",
    "RULE-SET,claude,🦀 Claude",

    // --- 📺 常用业务与流媒体 ---
    "RULE-SET,bilibili,📺 哔哩哔哩",
    "RULE-SET,youtube,📺 YouTube",
    "RULE-SET,netflix,🎬 Netflix",
    "RULE-SET,github,🐱 GitHub", 
    "PROCESS-NAME,Telegram.exe,✈️ Telegram",
    "PROCESS-NAME,Telegram,✈️ Telegram",
    "RULE-SET,telegram,✈️ Telegram",
    "RULE-SET,telegram-ip,✈️ Telegram,no-resolve",
    "RULE-SET,google,🚅 Google",
    "RULE-SET,apple,🍎 Apple",
    "RULE-SET,microsoft,Ⓜ️ Microsoft",

    // ===== 规则顺序方案 =====
    // 方案 A（默认）：直连优先，性能最佳，适用于绝大多数场景
    // 方案 B（备选）：代理优先，分流更激进，适合强迫症用户
    // 切换方法：注释方案 A，取消注释方案 B

    // --- 地理位置分流 A (直连优先方案) ---
    "RULE-SET,cn-domain,DIRECT",
    "RULE-SET,cn-ip,DIRECT,no-resolve",
    "RULE-SET,non-cn,📍 节点选择",

    // --- 地理位置分流 B （代理优先） ---
    //"RULE-SET,non-cn,📍 节点选择",
    //"RULE-SET,cn-domain,DIRECT",
    //"RULE-SET,cn-ip,DIRECT,no-resolve",

    // --- 🐟 兜底 ---
    "MATCH,🐟 漏网之鱼"
  ];

   // =========================================================================
  // --- 7. Sniffer 嗅探防漏网配置 ---
  // =========================================================================
  config["sniffer"] = {
    "enable": true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    "override-destination": true,
    "sniff": {
      "TLS": { "ports": [443, 8443] },
      "HTTP": { "ports": [80, "8080-8880"], "override-destination": true }
    }
  };

  return config;
}