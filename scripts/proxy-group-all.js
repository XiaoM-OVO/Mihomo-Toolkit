// =========================================================================
//  📦 Mihomo-Toolkit | 通用动态策略组脚本 | ALL-IN-ONE
// ------------------------------------------------------------------------
// 版本: v1.5.1 (2026-06-04)
// 作者: XiaoM-OVO
// 仓库: https://github.com/XiaoM-OVO/mihomo-toolkit
// 核心特性: 智能清洗 / 动态分组 / BT 阻断 / AI 分流 / 规则优化
// =========================================================================
// 💡 【节点清洗图标说明】
// 🤖 : OpenAI / ChatGPT      ♊ : Google Gemini       🦀 : Anthropic Claude
// 📺 : 流媒体访问 (NF/P+)     🎮 : 游戏 / FullCone      ⚡ : Hysteria / 高速
// 🛡️ : AnyTLS / 安全协议      📱 : WAP 移动优化         ⏬ : 下载 / BT 专用
// 🆓 : 免费 / 公益节点         🗑️ : 清洗失败节点
// =========================================================================

function main(config) {
  const proxies = config.proxies || [];

  // =========================================================================
  // --- 1. 全局配置与字典定义 ---
  // =========================================================================
  const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)"; // 公共入口前缀
  
  // 地区合并映射：groupId 用于绑定最后的测速策略组，没有 groupId 的归为"其他"
  const REGION_DEFS = [
    { id: "hk", name: "香港", icon: "🇭🇰", reg: new RegExp(`${IN_PREFIX}港|香港|(?<![a-z])HKT?(?![a-z])|Hong Kong`, "i") },
    { id: "tw", name: "台湾", icon: "🇹🇼", reg: new RegExp(`${IN_PREFIX}台|台湾|台灣|台北|新北|(?<![a-z])TW(?![a-z])|Taiwan`, "i") },
    { id: "jp", name: "日本", icon: "🇯🇵", reg: new RegExp(`${IN_PREFIX}日|日本|东京|大阪|埼玉|(?<![a-z])JP(?![a-z])|Japan`, "i") },
    { id: "kr", name: "韩国", icon: "🇰🇷", reg: new RegExp(`${IN_PREFIX}韩|韩国|首尔|(?<![a-z])KR(?![a-z])|Korea`, "i") },
    { id: "sg", name: "新加坡", icon: "🇸🇬", reg: new RegExp(`${IN_PREFIX}新|新加坡|狮城|(?<![a-z])SG(?![a-z])|Singapore`, "i") },
    { id: "us", name: "美国", icon: "🇺🇸", reg: new RegExp(`${IN_PREFIX}美|美国|洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|(?<![a-z])(?:US|LA)(?![a-z])|Los Angeles|America`, "i") },
    // 欧洲大区 (共用 eu 分组)
    { id: "eu", name: "英国", icon: "🇬🇧", reg: /英国|伦敦|(?<![a-z])UK(?![a-z])|United Kingdom|Britain/i },
    { id: "eu", name: "德国", icon: "🇩🇪", reg: /德国|法兰克福|(?<![a-z])DE(?![a-z])|Germany/i },
    { id: "eu", name: "法国", icon: "🇫🇷", reg: /法国|巴黎|(?<![a-z])FR(?![a-z])|France/i },
    { id: "eu", name: "俄罗斯", icon: "🇷🇺", reg: /俄罗斯|莫斯科|伯力|圣彼得堡|(?<![a-z])RU(?![a-z])|Russia/i },
    { id: "eu", name: "乌克兰", icon: "🇺🇦", reg: /乌克兰|基辅|(?<![a-z])UA(?![a-z])|Ukraine/i },
    { id: "eu", name: "土耳其", icon: "🇹🇷", reg: /土耳其|伊斯坦布尔|(?<![a-z])TR(?![a-z])|Turkey/i },
    // 其他地区
    { name: "加拿大", icon: "🇨🇦", reg: /加拿大|多伦多|温哥华|蒙特利尔|(?<![a-z])CA(?![a-z])|Canada/i },
    { name: "印度", icon: "🇮🇳", reg: /印度|孟买|新德里|(?<![a-z])IN(?![a-z])|India/i },
    { name: "阿根廷", icon: "🇦🇷", reg: /阿根廷|布宜诺斯艾利斯|(?<![a-z])AR(?![a-z])|Argentina/i },
    { name: "尼日利亚", icon: "🇳🇬", reg: /尼日利亚|(?<![a-z])NG(?![a-z])|Nigeria/i },
    { name: "越南", icon: "🇻🇳", reg: /越南|胡志明|(?<![a-z])VN(?![a-z])|Vietnam/i },
    { name: "澳大利亚", icon: "🇦🇺", reg: /澳大利亚|澳洲|悉尼|墨尔本|(?<![a-z])AU(?![a-z])|Australia|Sydney/i },
    { name: "巴西", icon: "🇧🇷", reg: /巴西|圣保罗|(?<![a-z])BR(?![a-z])|Brazil/i },
    { name: "阿联酋", icon: "🇦🇪", reg: /阿联酋|迪拜|(?<![a-z])(?:AE|UAE)(?![a-z])/i }
  ];

  const ICON_RULES = [
    { reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i, icon: "🤖", pool: "chatgpt" },
    { reg: /\bGemini\b/i, icon: "♊", pool: "gemini" },
    { reg: /\bClaude\b/i, icon: "🦀", pool: "claude" },
    { reg: /(?:游戏)|\b(?:Game|FullCone)\b/i, icon: "🎮", pool: "game" },
    { reg: /(?:流媒体|解锁)|\b(?:Netflix|NF|Disney\+|YouTube)\b/i, icon: "📺" },
    { reg: /(?:下载)|\bBT\b/i, icon: "⏬" },
    { reg: /(?:免费|白嫖|公益)/i, icon: "🆓" },
    { reg: /\bWAP\b/i, icon: "📱" },
    { reg: /\b(?:HY2|Hysteria)\b/i, icon: "⚡" },
    { reg: /-A$|\bAnyTLS\b/i, icon: "🛡️" }
  ];

  // =========================================================================
  // --- 2. 节点双重遍历：清洗、计数与分发入桶 ---
  // =========================================================================
  const BUCKETS = {
    hk: [], tw: [], jp: [], kr: [], sg: [], us: [], eu: [], other: [],
    garbage: [], download: [], info: [], allStandard: [],
    chatgpt: [], gemini: [], claude: [], game: []
  };
  
  const groupTotals = {}; // 记录每组的总节点数
  const parsedList = [];  // 暂存第一遍解析后的信息

  // ▶️ [第一遍遍历]：提取特征并统计各地区总数
  proxies.forEach(proxy => {
    let name = proxy.name;
    let originalName = proxy.name; // 留底备用

    // 1. 基础过滤
    if (['DIRECT', 'REJECT', 'COMPATIBLE'].includes(name)) return;
    if (/剩余流量|套餐到期|有效|官网|过期|通知|更新|重置/.test(name)) {
      BUCKETS.info.push(name);
      return;
    }

    let suffixArr = [], icons = [], featurePools = [];
    let entryStr = "", multiStr = "", lineArr = [];
    
    // 2. 提取入口标志
    const tagMap = {"深圳":"深", "广州":"广", "上海":"沪", "北京":"京", "杭州":"杭", "四川":"川", "江苏":"苏", "宁波":"甬", "东莞":"莞"};
    const entryMatch = name.match(/(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|香港|台湾|日本|韩国|新加坡|美国)/);
    if (entryMatch) entryStr = tagMap[entryMatch[1]] || entryMatch[1];

    // 3. 提取倍率
    let isLowMulti = false;
    name = name.replace(/(?:^|[\s_\-\(\)\[\]【】])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*[xX×]|[xX×]\s*(\d+(?:\.\d+)?))(?=[\s_\-\(\)\[\]【】]|$)/ig, (m, m1, m2, m3) => {
      let num = parseFloat(m1 || m2 || m3);
      if (!isNaN(num)) {
        multiStr = `x${num}`; 
        if (num < 1) isLowMulti = true;
      }
      return "";
    });

    // 4. 提取线路特征
    const lineRegex = /(IEPL|IPLC|BGP|CN2|GIA|专线|直连|中转|隧道|CMI|CUG|PCCW|HGC|HSBC|优化|9929|4837)/ig;
    let lineMatch;
    while ((lineMatch = lineRegex.exec(name)) !== null) {
      lineArr.push(lineMatch[0].length > 2 ? lineMatch[0].toUpperCase() : lineMatch[0]);
    }
    name = name.replace(lineRegex, "");

    if (entryStr) suffixArr.push(entryStr);
    if (lineArr.length > 0) suffixArr.push(...new Set(lineArr)); 
    if (multiStr) suffixArr.push(multiStr);

    // 5. 提取特殊功能标签并去杂质
    ICON_RULES.forEach(rule => {
      if (rule.reg.test(name)) {
        icons.push(rule.icon);
        if (rule.pool) featurePools.push(rule.pool);
        name = name.replace(rule.reg, "");
      }
    });
    if (isLowMulti && !icons.includes("⏬")) icons.push("⏬");

    // 6. 识别地区信息
    let regionInfo = REGION_DEFS.find(item => item.reg.test(name));
    if (regionInfo) {
      name = name.replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, ""); 
      name = name.replace(regionInfo.reg, "");
    }

    // 7. 清理并提取基础名称
    name = name.replace(/[\[\]{}()<>（）【】]/g, '').replace(/\d+/g, "").replace(/[-_\|\s]+/g, " ").trim() || "其他";
    
    let groupKey = regionInfo ? regionInfo.name : name;
    groupTotals[groupKey] = (groupTotals[groupKey] || 0) + 1; // 💡 第一遍只统计总数

    // 将解析好的数据存入数组，留给第二遍处理
    parsedList.push({
      proxy, regionInfo, groupKey, originalName, icons, featurePools, suffixArr
    });
  });

  // ▶️ [第二遍遍历]：精确重命名与分发入桶
  const groupCurrent = {}; // 记录当前跑到第几个

  parsedList.forEach(item => {
    let { proxy, regionInfo, groupKey, originalName, icons, featurePools, suffixArr } = item;
    
    groupCurrent[groupKey] = (groupCurrent[groupKey] || 0) + 1;
    
    // 💡 核心逻辑：只有该组总数 > 1，才添加 [01] 编号
    let numStr = groupTotals[groupKey] > 1 
      ? ` [${groupCurrent[groupKey].toString().padStart(2, '0')}]` 
      : "";
    
    let finalName = regionInfo 
      ? `${regionInfo.icon} ${regionInfo.name}${numStr}` 
      : `🗑️ ${originalName}`; // 识别失败归为垃圾桶

    if (icons.length > 0) finalName += ` ${[...new Set(icons)].join("")}`;
    if (regionInfo && suffixArr.length > 0) finalName += ` | ${suffixArr.join(" ")}`; 

    proxy.name = finalName; // 真正更新节点名称

    // 8. 彻底物理隔离与分发入桶
    if (icons.includes("⏬")) {
      BUCKETS.download.push(finalName);
    } else {
      BUCKETS.allStandard.push(finalName);
      featurePools.forEach(p => BUCKETS[p].push(finalName)); 

      if (!regionInfo) {
        BUCKETS.garbage.push(finalName);
      } else {
        BUCKETS[regionInfo.id || 'other'].push(finalName);
      }
    }
  });
  
  // =========================================================================
  // --- 3. 动态可用策略组构建 (防空组报错) ---
  // =========================================================================
  const safeList = (list, defaultNodes = ["DIRECT"]) => list.length > 0 ? list : defaultNodes;

  const REGION_NAMES = {
    hk: "🇭🇰 香港节点", tw: "🇹🇼 台湾节点", jp: "🇯🇵 日本节点", 
    kr: "🇰🇷 韩国节点", sg: "🇸🇬 新加坡节点", us: "🇺🇸 美国节点", eu: "🇪🇺 欧洲节点"
  };

  // 生成当前激活的地区组菜单
  const activeRegionGroups = Object.keys(REGION_NAMES)
    .filter(k => BUCKETS[k].length > 0)
    .map(k => REGION_NAMES[k]);

  if (BUCKETS.other.length > 0) activeRegionGroups.push("🌐 其他节点");
  if (BUCKETS.garbage.length > 0) activeRegionGroups.push("🗑️ 未知识别");

  // 动态池构建
  const aiProxies = safeList(["🇺🇸 美国节点", "🇯🇵 日本节点", "🇹🇼 台湾节点", "🇸🇬 新加坡节点", "🇰🇷 韩国节点", "🇪🇺 欧洲节点"].filter(g => activeRegionGroups.includes(g)));
  const scholarProxies = safeList(["🇺🇸 美国节点", "🇪🇺 欧洲节点", "🇯🇵 日本节点", "🇸🇬 新加坡节点", "🇹🇼 台湾节点", "🇭🇰 香港节点"].filter(g => activeRegionGroups.includes(g)), ["📍 节点选择", "DIRECT"]);
  const biliProxies = safeList(["🇹🇼 台湾节点", "🇭🇰 香港节点"].filter(g => activeRegionGroups.includes(g)));

  const standardOptions = ["📍 节点选择", "🚀 自动选择", "🛡️ 故障转移"];
  if (BUCKETS.download.length > 0) standardOptions.push("⏬ 负载均衡");
  standardOptions.push(...activeRegionGroups);

  const coreSelectProxies = ["🚀 自动选择", "🛡️ 故障转移"];
  if (BUCKETS.download.length > 0) coreSelectProxies.push("⏬ 负载均衡");
  coreSelectProxies.push(...BUCKETS.info, ...activeRegionGroups, "DIRECT");

  // =========================================================================
  // --- 4. 组装 Proxy-Groups (模板化处理) ---
  // =========================================================================
  const buildSelect = (name, proxies, hidden = false) => ({ name, type: "select", proxies: [...new Set(proxies)], hidden });
  const buildUrlTest = (name, proxies, hidden = false) => ({ 
    name, type: "url-test", url: "http://cp.cloudflare.com/generate_204", interval: 180, tolerance: 100, lazy: true, proxies: [...new Set(safeList(proxies))], hidden 
  });

  config["proxy-groups"] = [
    // --- 核心控制组 ---
    buildSelect("📍 节点选择", coreSelectProxies),
    { name: "🚀 自动选择", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, tolerance: 50, proxies: safeList(BUCKETS.allStandard) },
    { name: "🛡️ 故障转移", type: "fallback", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: safeList([...activeRegionGroups, "DIRECT"]) },
    
    // --- ⏬ 下载专属孤岛 ---
    buildSelect("⏬ 负载均衡", BUCKETS.download.length > 0 ? ["DIRECT", "⚖️ 负载均衡轮询池", "🚀 自动选择", ...BUCKETS.download] : ["DIRECT"], BUCKETS.download.length === 0),
    { name: "⚖️ 负载均衡轮询池", type: "load-balance", strategy: "round-robin", url: "http://www.gstatic.com/generate_204", interval: 300, lazy: true, proxies: safeList(BUCKETS.download), hidden: true },

    // --- 🤖 AI 智能服务 ---
    buildSelect("🤖 OpenAI", [...aiProxies, ...safeList(BUCKETS.chatgpt)]),
    buildSelect("♊ Gemini", [...aiProxies, ...safeList(BUCKETS.gemini)]),
    buildSelect("🦀 Claude", [...aiProxies, ...safeList(BUCKETS.claude)]),
    
    // --- 业务与流媒体分流 ---
    buildSelect("🎓 学术网站", scholarProxies),
    buildSelect("🎮 游戏服务", ["DIRECT", ...standardOptions, ...safeList(BUCKETS.game)]),
    buildSelect("📺 哔哩哔哩", ["DIRECT", ...biliProxies], biliProxies.length === 0 || biliProxies[0] === "DIRECT"),
    buildSelect("📺 YouTube", [...standardOptions, "DIRECT"]),
    buildSelect("🎬 Netflix", [...standardOptions, "DIRECT"]),
    buildSelect("🐱 GitHub", [...standardOptions, "DIRECT"]),
    buildSelect("✈️ Telegram", [...standardOptions, "DIRECT"]),

    // --- 系统基础服务 ---
    buildSelect("Ⓜ️ Microsoft", ["DIRECT", ...standardOptions]),
    buildSelect("🚅 Google", [...standardOptions, "DIRECT"]),
    buildSelect("🍎 Apple", ["DIRECT", ...standardOptions]),

    // --- 全局状态组 ---
    buildSelect("🐟 漏网之鱼", ["📍 节点选择", "🚀 自动选择", "DIRECT"]),
    buildSelect("🚫 广告拦截", ["REJECT", "DIRECT"]),
    
    // --- 地区自动测速组 ---
    ...Object.entries(REGION_NAMES).map(([id, name]) => buildUrlTest(name, BUCKETS[id], BUCKETS[id].length === 0)),
    buildSelect("🌐 其他节点", safeList(BUCKETS.other), BUCKETS.other.length === 0),
    buildSelect("🗑️ 未知识别", safeList(BUCKETS.garbage), BUCKETS.garbage.length === 0)
  ];

  // =========================================================================
  // --- 5. 规则集配置 (Rule Providers) ---
  // =========================================================================
  const REPO = "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta";
  const RULE_PROVIDERS = {
    "lan-domain": "geo/geosite/private.yaml", "lan-ip": "geo/geoip/private.yaml",
    "ads": "geo/geosite/category-ads-all.yaml", "bt-trackers-pt": "geo/geosite/category-pt.yaml",
    "bt-trackers-public": "geo/geosite/category-public-tracker.yaml",
    "download-android": "geo/geosite/category-android-app-download.yaml",
    "download-games": "geo/geosite/category-game-platforms-download.yaml",
    "download-games-cn": "geo/geosite/category-game-platforms-download@cn.yaml",
    "openai": "geo/geosite/openai.yaml", "gemini": "geo/geosite/google-gemini.yaml", "claude": "geo/geosite/anthropic.yaml",
    "github": "geo/geosite/github.yaml", "telegram": "geo/geosite/telegram.yaml", "bilibili": "geo/geosite/bilibili.yaml",
    "youtube": "geo/geosite/youtube.yaml", "netflix": "geo/geosite/netflix.yaml",
    "google": "geo/geosite/google.yaml", "apple": "geo/geosite/apple.yaml", "microsoft": "geo/geosite/microsoft.yaml",
    "steam": "geo/geosite/steam.yaml", "steam-cn": "geo/geosite/steam@cn.yaml", "epic": "geo/geosite/epicgames.yaml",
    "scholar": "geo/geosite/category-scholar-!cn.yaml", "non-cn": "geo/geosite/geolocation-!cn.yaml",
    "cn-domain": "geo/geosite/cn.yaml", "telegram-ip": "geo/geoip/telegram.yaml", "cn-ip": "geo/geoip/cn.yaml",
  };

  config["rule-providers"] = Object.fromEntries(
    Object.entries(RULE_PROVIDERS).map(([name, path]) => [
      name, { type: "http", behavior: path.includes("geoip") ? "ipcidr" : "domain", url: `${REPO}/${path}`, path: `./ruleset/${name}.yaml`, interval: 86400, proxy: "🚀 自动选择" }
    ])
  );
  // =========================================================================
  // --- 6. 策略分流规则与 Sniffer ---
  // =========================================================================
  config["rules"] = [
    //"AND,((NETWORK,UDP),(DST-PORT,443)),REJECT",     //🚫 阻止UDP 443端口,防止DNS泄漏（可选，但牺牲体验）

    "RULE-SET,lan-domain,DIRECT",
    "RULE-SET,lan-ip,DIRECT,no-resolve", 
    "RULE-SET,ads,🚫 广告拦截",

    "PROCESS-NAME,qBittorrent.exe,DIRECT",
    "PROCESS-NAME,Thunder.exe,DIRECT",
    "RULE-SET,bt-trackers-pt,DIRECT",
    "RULE-SET,bt-trackers-public,DIRECT",
    "DOMAIN-KEYWORD,tracker,DIRECT", 
    "DOMAIN-KEYWORD,announce,DIRECT",

    "PROCESS-NAME,IDM.exe,⏬ 负载均衡",
    "RULE-SET,download-games-cn,DIRECT",
    "RULE-SET,download-games,⏬ 负载均衡",
    "RULE-SET,download-android,⏬ 负载均衡",

    "DOMAIN-KEYWORD,sci-hub,🎓 学术网站", 
    "RULE-SET,scholar,🎓 学术网站", 

    "DOMAIN-SUFFIX,steamusercontent.com,🎮 游戏服务",
    "RULE-SET,steam-cn,DIRECT",
    "DOMAIN-SUFFIX,steamserver.net,DIRECT",
    "RULE-SET,steam,🎮 游戏服务",
    "RULE-SET,epic,🎮 游戏服务",
    "DOMAIN-SUFFIX,epicgames.com,DIRECT",

    "RULE-SET,openai,🤖 OpenAI",
    "RULE-SET,gemini,♊ Gemini",
    "RULE-SET,claude,🦀 Claude",

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

    "MATCH,🐟 漏网之鱼"
  ];
  // =========================================================================
  // --- 7. TUN模式与严格路由防漏 ---
  // =========================================================================
  const uiTun = config.tun || {}; 
  config["tun"] = {
    ...uiTun,                   // 保留界面上的 enable 状态
    "stack": "system",          // gvisor / mixed / system
    "device": "Mihomo",         // 虚拟网卡名称
    "auto-route": true,         // 自动设置全局路由
    "strict-route": true,       // ⚠️严格路由：防止 Windows 底层 UDP/DNS 泄漏
    "auto-detect-interface": true
  };

  // =========================================================================
  // --- 8. Fake-IP 与纯净 DNS 体系 ---
  // =========================================================================
  config["dns"] = {
    "enable": true,
    "listen": "0.0.0.0:1053",
    "ipv6": false,              // ⚠️ 禁用 IPv6 解析，防止本地 IPv6 偷跑
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter-mode": "blacklist",
    "respect-rules": true,
    "use-hosts": true,
    "use-system-hosts": false,
    "fake-ip-filter": [
      "*.lan", "*.local", "*.arpa", "time.*.com", "ntp.*.com",
      "localhost.ptlogin2.qq.com", "*.msftncsi.com", "www.msftconnecttest.com",
      "google.cn", "+.music.163.com", "+.music.126.net"
    ],
    // 默认 DNS (解析国内和直连域名)
    "default-nameserver": ["223.5.5.5", "119.29.29.29"],
    "direct-nameserver": ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
    "direct-nameserver-follow-policy": true,
    // 解析代理节点域名的 DNS
    "proxy-server-nameserver": ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
    // 兜底海外 DNS (走代理，确保返回距离节点最近的 IP)
    "nameserver": ["https://8.8.8.8/dns-query", "https://1.1.1.1/dns-query"],
    // 国内特定服务 DNS 策略分流
    "nameserver-policy": {
      "geosite:cn,apple,microsoft": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query"
      ]
    }
  };

  // =========================================================================
  // --- 9. Sniffer 深度包检测 (增强分流准确性) ---
  // =========================================================================
  config["sniffer"] = {
    "enable": true, "force-dns-mapping": true, "parse-pure-ip": true, "override-destination": true,
    "sniff": { "TLS": { "ports": [443, 8443] }, "HTTP": { "ports": [80, "8080-8880"], "override-destination": true } }
  };

  return config;
}