// =========================================================================
// Clash Verge Rev (Mihomo内核) 简易优化配置脚本
// 版本: v1.5.0(2026-06-03)
// 作者: XiaoM-OVO
// 仓库: https://github.com/XiaoM-OVO/cvr-config
// 说明: 自动清洗节点名称 + 结构化自动分类 + 智能隐藏无节点策略组 + Lazy懒测速优化 + BT安全隔离
// =========================================================================
// 💡 【节点清洗图标说明】
// 🤖 : OpenAI / ChatGPT      ♊ : Google Gemini       🦀 : Anthropic Claude
// 📺 : 流媒体访问 (NF/P+)     🎮 : 游戏 / FullCone      ⚡ : Hysteria / 高速
// 🛡️ : AnyTLS / 安全协议      📱 : WAP 移动优化         ⏬ : 下载专用
// 🆓 : 免费 / 公益节点         🗑️ ：未知识别
// =========================================================================
function main(config) {
  const proxies = config.proxies || [];

  // =========================================================================
  // --- 1. 节点名称清洗与重组 (高级结构化处理) ---
  // =========================================================================
  const regionReplacements = [
    { reg: /(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)?港|HKT?|Hong Kong/i, name: "香港", icon: "🇭🇰" },
    { reg: /(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)?台|TW|Taiwan/i, name: "台湾", icon: "🇹🇼" },
    { reg: /(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)?日|JP|Japan/i, name: "日本", icon: "🇯🇵" },
    { reg: /(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)?(?:韩|韩国)|KR|Korea/i, name: "韩国", icon: "🇰🇷" },
    { reg: /(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)新|(?:新加坡|狮城)|SG|Singapore/i, name: "新加坡", icon: "🇸🇬" },
    { reg: /(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)?(?:美|美国)|USLA|US|LA|Los Angeles/i, name: "美国", icon: "🇺🇸" },
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

    // 智能提取入口标志 (兼容: "深港"、"深圳-香港"、"上海->日本" 等复杂格式)
    let entryTag = "";
    const entryMatch = name.match(/(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|香港|台湾|日本|韩国|新加坡|美国)/);
    if (entryMatch) {
      const tagMap = {"深圳":"深", "广州":"广", "上海":"沪", "北京":"京", "杭州":"杭", "四川":"川", "江苏":"苏", "宁波":"甬", "东莞":"莞"};
      entryTag = tagMap[entryMatch[1]] || entryMatch[1];
    }

    // 倍率提取
    name = name.replace(
      /(?:^|[\s_\-\(\)\[\]【】])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*[xX×]|[xX×]\s*(\d+(?:\.\d+)?))(?=[\s_\-\(\)\[\]【】]|$)/ig,
      (match, m1, m2, m3) => {
        let num = m1 || m2 || m3;
        if (num !== undefined) {
          multiStr = "x" + parseFloat(num);
        }
        return "";
      }
    );

    // 提取线路特征
    const lineKeywords = ["IEPL", "IPLC", "BGP", "CN2", "GIA", "专线", "直连", "中转", "隧道", "CMI", "CUG", "PCCW", "HGC", "HSBC", "优化", "9929", "4837"];
    const lineRegex = new RegExp(lineKeywords.join("|"), "ig");
    let lineMatch;
    let lineInfos = [];
    let icons = [];
    while ((lineMatch = lineRegex.exec(name)) !== null) { 
      lineInfos.push(lineMatch[0].length > 2 ? lineMatch[0].toUpperCase() : lineMatch[0]); 
    }
    
    // 如果有入口标识，放到标签数组里
    if (entryTag) suffixArr.push(entryTag);
    if (lineInfos.length > 0) { 
      suffixArr.push(...Array.from(new Set(lineInfos))); 
      name = name.replace(lineRegex, ""); 
    }
    if (multiStr) suffixArr.push(multiStr);
    
    // 自动识别低倍率节点作为下载专属节点
    let isLowMulti = multiStr && parseFloat(multiStr.slice(1)) < 1;
    if (isLowMulti) icons.push("⏬");

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
    name = name.replace(/[\[\]{}()<>（）【】]/g, '')
               .replace(/\d+/g, "")
               .replace(/[-_\|\s]+/g, " ")
               .trim();
    name = name || "其他"; 
    
    let groupKey = regionInfo ? regionInfo.name : name;
    return { proxy, regionInfo, groupKey, name, icons, suffixArr, rawName };
  }).filter(d => d && !d.skip && !d.isInfo);

  // 统计各组数量并附加序号
  const counts = {};
  processedData.forEach(d => { counts[d.groupKey] = (counts[d.groupKey] || 0) + 1; });

  const groupTrack = {};
  processedData.forEach(d => {
    let finalName = "";

    if (!d.regionInfo) {
      // 🗑️ 垃圾桶逻辑：没认出是哪个国家，还原原名，并加上垃圾桶标记
      finalName = `🗑️ ${d.rawName}`;
    } else {
      // 正常地区归类逻辑
      groupTrack[d.groupKey] = (groupTrack[d.groupKey] || 0) + 1;
      let numStr = counts[d.groupKey] > 1 ? ` [${groupTrack[d.groupKey].toString().padStart(2, '0')}]` : "";
      finalName = `${d.regionInfo.icon} ${d.regionInfo.name}${numStr}`;
    }

    // 保留提取出的功能图标（例如 ⏬，让它在垃圾桶里依然能下BT）
    if (d.icons.length > 0) finalName += ` ${Array.from(new Set(d.icons)).join("")}`;
    
    // 仅正常节点添加线路等后缀，垃圾节点保持原状
    if (d.regionInfo && d.suffixArr.length > 0) finalName += ` | ${d.suffixArr.join(" ")}`;
    
    d.proxy.name = finalName;
  });
  // =========================================================================
  // --- 2. 节点彻底物理隔离与特征提取 ---
  // =========================================================================
  const proxyNames = proxies.map(p => p.name);
  const validProxies = proxyNames.filter(n => !/剩余流量|套餐到期|有效|官网|过期|通知|更新|重置/.test(n));
  const infoNodes = proxyNames.filter(n => /剩余流量|套餐到期|有效|官网|过期|通知|更新|重置/.test(n));
  
  // ⚡ 核心逻辑：从主路线中彻底剥离所有含有 "⏬" 的节点，不参与日常测速与分流。
  const downloadOrLowMultiNodes = validProxies.filter(n => n.includes("⏬"));
  const standardProxies = validProxies.filter(n => !n.includes("⏬")); 
  const allStandardProxies = standardProxies.length > 0 ? standardProxies : ["DIRECT"];

  // 提取特征节点
  const ChatGPTNodes = standardProxies.filter(n => n.includes("🤖"));
  const GeminiNodes = standardProxies.filter(n => n.includes("♊"));
  const ClaudeNodes = standardProxies.filter(n => n.includes("🦀"));
  const gameNodes = standardProxies.filter(n => n.includes("🎮"));

  // =========================================================================
  // --- 3. 地区自动归类 (仅对标准节点生效) ---
  // =========================================================================
  const regionMap = {
    hk: { name: "🇭🇰 香港节点", keywords: ["香港", "HK", "Hong Kong", "🇭🇰"] },
    tw: { name: "🇹🇼 台湾节点", keywords: ["台湾", "TW", "Taiwan", "🇹🇼"] },
    jp: { name: "🇯🇵 日本节点", keywords: ["日本", "JP", "Japan", "🇯🇵"] },
    kr: { name: "🇰🇷 韩国节点", keywords: ["韩国", "KR", "Korea", "🇰🇷"] },
    sg: { name: "🇸🇬 新加坡节点", keywords: ["新加坡", "SG", "Singapore", "🇸🇬"] },
    us: { name: "🇺🇸 美国节点", keywords: ["美国", "US", "USA", "United States", "🇺🇸"] },
    eu: { name: "🇪🇺 欧洲节点", keywords: ["英国", "德国", "法国", "荷兰", "乌克兰", "俄罗斯", "土耳其", "欧洲", "🇬🇧", "🇩🇪", "🇫🇷", "🇪🇺", "🇷🇺", "🇹🇷", "🇺🇦"] }
  };

  const matched = new Set();
  const regionNodes = { hk: [], tw: [], jp: [], kr: [], sg: [], us: [], eu: [] };

  // ⚡ 核心分离：先把垃圾桶节点剥离出来
  const garbageNodes = standardProxies.filter(n => n.includes("🗑️"));
  const normalStandardProxies = standardProxies.filter(n => !n.includes("🗑️"));

  // 只将正常的地区节点塞入地区混池
  normalStandardProxies.forEach(name => {
    for (const [key, meta] of Object.entries(regionMap)) {
      if (meta.keywords.some(kw => name.includes(kw))) {
        regionNodes[key].push(name);
        matched.add(name);
        break; 
      }
    }
  });
  
  // 真正的“其他国家”节点（如加拿大、澳洲等）
  const otherNodes = normalStandardProxies.filter(n => !matched.has(n));
  
  // 动态生成可用地区组
  const activeRegionGroups = Object.keys(regionMap)
    .filter(key => regionNodes[key].length > 0)
    .map(key => regionMap[key].name);
    
  if (otherNodes.length > 0) activeRegionGroups.push("🌐 其他节点");
  if (garbageNodes.length > 0) activeRegionGroups.push("🗑️ 未知识别"); // 如果有垃圾，挂在菜单最后

  // =========================================================================
  // --- 4. 动态防ban组提取 (AI 与 学术) ---
  // =========================================================================
  const safeList = (list) => (list && list.length > 0) ? list : ["DIRECT"];

  // 🤖 AI 专属动态安全池
  const aiSafeRegions = ["🇺🇸 美国节点", "🇯🇵 日本节点", "🇹🇼 台湾节点", "🇸🇬 新加坡节点", "🇰🇷 韩国节点", "🇪🇺 欧洲节点"];
  const activeAIGroups = aiSafeRegions.filter(g => activeRegionGroups.includes(g));
  const aiProxies = activeAIGroups.length > 0 ? activeAIGroups : ["DIRECT"];

  // 🎓 学术网站动态安全池
  const scholarSafeRegions = ["🇺🇸 美国节点", "🇪🇺 欧洲节点", "🇯🇵 日本节点", "🇸🇬 新加坡节点", "🇹🇼 台湾节点", "🇭🇰 香港节点"];
  const activeScholarGroups = scholarSafeRegions.filter(g => activeRegionGroups.includes(g));
  const scholarProxies = activeScholarGroups.length > 0 ? [...activeScholarGroups, "📍 节点选择", "DIRECT"] : ["📍 节点选择", "DIRECT"];

  // 📺 B站港澳台解锁池
  const biliRegions = ["🇹🇼 台湾节点", "🇭🇰 香港节点"];
  const activeBiliGroups = biliRegions.filter(g => activeRegionGroups.includes(g));
  const biliProxies = activeBiliGroups.length > 0 ? ["DIRECT", ...activeBiliGroups] : ["DIRECT"];

  // 主菜单选项构建
  const standardOptions = [ "📍 节点选择", "🚀 自动选择", "🛡️ 故障转移" ];
  if (downloadOrLowMultiNodes.length > 0) standardOptions.push("⏬ 负载均衡");
  standardOptions.push(...activeRegionGroups);

  // 生成主控制组内选项 (无低倍率时自动隐藏入口)
  const coreSelectProxies = ["🚀 自动选择", "🛡️ 故障转移"];
  if (downloadOrLowMultiNodes.length > 0) coreSelectProxies.push("⏬ 负载均衡");
  coreSelectProxies.push(...infoNodes, ...activeRegionGroups, "DIRECT");

  // =========================================================================
  // --- 5. 策略组构建 (Proxy Groups) ---
  // =========================================================================
  config["proxy-groups"] = [
    // --- 核心控制组 ---
    { name: "📍 节点选择", type: "select", proxies: coreSelectProxies },
    { name: "🚀 自动选择", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, tolerance: 50, proxies: allStandardProxies },
    { name: "🛡️ 故障转移", type: "fallback", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: safeList([...activeRegionGroups, "DIRECT"]) },
    
    // --- ⏬ 下载专属孤岛 ---
    { 
      name: "⏬ 负载均衡", 
      type: "select", 
      proxies: downloadOrLowMultiNodes.length > 0 ? ["DIRECT", "⚖️ 负载均衡内部池", "🚀 自动选择", ...downloadOrLowMultiNodes] : ["DIRECT"],
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
    
    // --- 🤖 AI 智能服务 ---
    { name: "🤖 OpenAI", type: "select", proxies: [...aiProxies, ...safeList(ChatGPTNodes)] },
    { name: "♊ Gemini", type: "select", proxies: [...aiProxies, ...safeList(GeminiNodes)] },
    { name: "🦀 Claude", type: "select", proxies: [...aiProxies, ...safeList(ClaudeNodes)] },
    
    // --- 业务与流媒体分流 ---
    { name: "🎓 学术网站", type: "select", proxies: scholarProxies },
    { name: "🎮 游戏服务", type: "select", proxies: ["DIRECT", ...standardOptions, ...safeList(gameNodes)] },
    { name: "📺 哔哩哔哩", type: "select", proxies: biliProxies, hidden: activeBiliGroups.length === 0 },
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
    { name: "🇪🇺 欧洲节点", type: "select", proxies: safeList(regionNodes.eu), hidden: regionNodes.eu.length === 0 },
    { name: "🌐 其他节点", type: "select", proxies: safeList(otherNodes), hidden: otherNodes.length === 0 },
    { name: "🗑️ 未知识别", type: "select", proxies: safeList(garbageNodes), hidden: garbageNodes.length === 0 }
  ];

  // =========================================================================
  // --- 6. 规则集配置 (Rule Providers) ---
  // =========================================================================
  const repo = "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta";
  const ruleProviders = {
    "lan-domain": "geo/geosite/private.yaml",
    "lan-ip": "geo/geoip/private.yaml",
    "ads": "geo/geosite/category-ads-all.yaml",
    "bt-trackers": "geo/geosite/bt.yaml",
    "bt-peers": "geo/geoip/bt.yaml",
    "download-android": "geo/geosite/category-android-app-download.yaml",
    "download-games": "geo/geosite/category-game-platforms-download.yaml",
    "download-games-cn": "geo/geosite/category-game-platforms-download@cn.yaml",
    "openai": "geo/geosite/openai.yaml",
    "gemini": "geo/geosite/google-gemini.yaml",
    "claude": "geo/geosite/anthropic.yaml",
    "github": "geo/geosite/github.yaml",
    "telegram": "geo/geosite/telegram.yaml",
    "bilibili": "geo/geosite/bilibili.yaml",
    "youtube": "geo/geosite/youtube.yaml",
    "netflix": "geo/geosite/netflix.yaml",
    "google": "geo/geosite/google.yaml",
    "apple": "geo/geosite/apple.yaml",
    "microsoft": "geo/geosite/microsoft.yaml",
    "steam": "geo/geosite/steam.yaml",
    "steam-cn": "geo/geosite/steam@cn.yaml",
    "epic": "geo/geosite/epicgames.yaml",
    "scholar": "geo/geosite/category-scholar-!cn.yaml",
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
  // --- 7. 策略分流规则 (Rules) ---
  // =========================================================================
  config["rules"] = [
    //"AND,((NETWORK,UDP),(DST-PORT,443)),REJECT",     //🚫 阻止UDP 443端口,防止DNS泄漏（可选，但牺牲体验）
    // --- 🏠 局域网直连 ---
    "RULE-SET,lan-domain,DIRECT",
    "RULE-SET,lan-ip,DIRECT,no-resolve", 

    // --- 🚫 广告拦截 ---
    "RULE-SET,ads,🚫 广告拦截",

    // --- 🧲 BT/P2P 严密防封 (防测速防漏) ---
    "PROCESS-NAME,qBittorrent.exe,DIRECT",
    "PROCESS-NAME,Thunder.exe,DIRECT",
    "RULE-SET,bt-trackers,DIRECT",
    "RULE-SET,bt-peers,DIRECT,no-resolve",
    "DOMAIN-KEYWORD,tracker,DIRECT", // 关键字双重保险
    "DOMAIN-KEYWORD,announce,DIRECT",

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

    // --- 🐟 漏网之鱼 ---
    "MATCH,🐟 漏网之鱼"
  ];

   // =========================================================================
  // --- 8. Sniffer 嗅探防漏网配置 ---
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