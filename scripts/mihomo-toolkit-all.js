// =========================================================================
//  📦 Mihomo-Toolkit | 通用动态策略组脚本 | ALL-IN-ONE
// ------------------------------------------------------------------------
// 版本: v2.1.0 (Build 2026.06.07)
// 作者: XiaoM-OVO
// 描述: 专为 Mihomo 内核客户端设计的简易动态路由策略组脚本。
// 功能: 动态清洗 / 智能分流 / 自动容错 / 多场景适配
// 仓库: https://github.com/XiaoM-OVO/mihomo-toolkit
// =========================================================================
// 💡 【节点清洗图标说明】
// 🤖 : OpenAI / ChatGPT      ♊ : Google Gemini       🦀 : Anthropic Claude
// 📺 : 流媒体访问 (NF/P+)     🎮 : 游戏 / FullCone      ⚡ : Hysteria / 高速
// 🛡️ : AnyTLS / 安全协议      📱 : WAP 移动优化         ⏬ : 下载 / BT 专用
// 🆓 : 免费 / 公益节点         🗑️ : 清洗失败节点
// =========================================================================

function main(config) {

  // =========================================================================
  // ⚙️ 用户自定义配置区 (开关配置) - true 为开启，false 为关闭
  // =========================================================================
  const USER_CONFIG = {
    // 【1. 脚本总控】
    enableScript: true,          // 🟢 总开关：设为 false 则原样输出订阅内容，不修改任何节点

    // 【2. 常用功能分流 (默认开启)】
    enableAdBlock: true,         // 🚫 广告拦截：去除网页及 APP 广告
    enableAI: true,              // 🤖 AI 助手：OpenAI, Gemini, Claude 等
    enableGitHub: true,          // 🐱 开发者选项：GitHub, GitLab 等
    enableTelegram: true,        // ✈️ 社交通讯：Telegram 独立分流
    enableScholar: true,         // 🎓 学术研究：Google Scholar 等
    enableYouTube: true,         // ▶️ 影音娱乐：YouTube 独立分流
    enableNetflix: true,         // 🎬 影音娱乐：Netflix 独立分流
    enableBilibili: true,        // 📺 影音娱乐：哔哩哔哩港澳台
    enableGame: true,            // 🎮 游戏平台：Steam, Epic 等
    enableSystemServices: true,  // 🪟 系统服务：Microsoft, Apple, Google 服务

    // 【3. 专项场景分流 (按需开启)】
    enableTikTok: false,         // 🎵 TikTok：自动过滤香港节点
    enableSpotify: false,        // 🎧 Spotify：音乐流媒体
    enableSocial: false,         // 💬 海外社交：Twitter, Meta 等
    enableCrypto: false,         // 🪙 加密货币：Binance 等交易平台
    enablePayPal: false,         // 💳 金融支付：PayPal 独立分流
    enableDomesticGroup: false,  // 🇨🇳 中国分流：开启后增加专门的“中国”策略组

    // 【4. 路由逻辑与设备优化】
    proxyFirst: false,           // 🧭 路由偏好：false(直连优先-推荐), true(代理优先-漏网走代理)
    osType: "windows",           // 💻 设备类型: "windows", "mac", "linux", "all"
    enableQUICReject: false,     // ⚡ 屏蔽 QUIC: 提升 YT 速度，若游戏语音异常请关闭
    removeInfoNodes: false,      // 🗑️ 纯净节点: 彻底过滤流量/到期时间等营销节点

    // 【5. 核心性能与策略组高级参数】
    useMRS: true,                // 🚀 极速模式: true(MRS格式-性能极高), false(YAML格式)
    regionGroupType: "url-test", // ⚙️ 地区组行为: "url-test"(自动), "select"(手动), "fallback"(故障转移)
    testURL: "http://cp.cloudflare.com/generate_204", // 🔗 延迟测速地址
    testInterval: 300,           // 🕒 测速间隔: 单位秒
    testTolerance: 50,           // ⚖️ 切换阈值: 延迟差低于此值不切换 IP
  };

  if (!USER_CONFIG.enableScript) return config;
  const proxies = config.proxies || [];

  // =========================================================================
  // --- 1. 常量与字典预定义 ---
  // =========================================================================
  const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)"; 
  
  const REGION_DEFS = [
    { id: "hk", name: "香港", icon: "🇭🇰", reg: new RegExp(`${IN_PREFIX}港|香港|(?<![a-zA-Z])HKT?(?![a-zA-Z])|Hong Kong`, "i") },
    { id: "tw", name: "台湾", icon: "🇹🇼", reg: new RegExp(`${IN_PREFIX}台|台湾|台灣|台北|新北|(?<![a-zA-Z])TW(?![a-zA-Z])|Taiwan`, "i") },
    { id: "jp", name: "日本", icon: "🇯🇵", reg: new RegExp(`${IN_PREFIX}日|日本|东京|大阪|埼玉|(?<![a-zA-Z])JP(?![a-zA-Z])|Japan`, "i") },
    { id: "kr", name: "韩国", icon: "🇰🇷", reg: new RegExp(`${IN_PREFIX}韩|韩国|首尔|(?<![a-zA-Z])KR(?![a-zA-Z])|Korea`, "i") },
    { id: "sg", name: "新加坡", icon: "🇸🇬", reg: new RegExp(`${IN_PREFIX}新|新加坡|狮城|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore`, "i") },
    { id: "us", name: "美国", icon: "🇺🇸", reg: new RegExp(`${IN_PREFIX}美|美国|洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|(?<![a-zA-Z])(?:US|LAX)(?![a-zA-Z])|Los Angeles|America`, "i") },
    { id: "eu", name: "英国", icon: "🇬🇧", reg: /英国|伦敦|(?<![a-zA-Z])UK(?![a-zA-Z])|United Kingdom|Britain/i },
    { id: "eu", name: "德国", icon: "🇩🇪", reg: /德国|法兰克福|(?<![a-zA-Z])DE(?![a-zA-Z])|Germany/i },
    { id: "eu", name: "法国", icon: "🇫🇷", reg: /法国|巴黎|(?<![a-zA-Z])FR(?![a-zA-Z])|France/i },
    { id: "eu", name: "俄罗斯", icon: "🇷🇺", reg: /俄罗斯|莫斯科|伯力|圣彼得堡|(?<![a-zA-Z])RU(?![a-zA-Z])|Russia/i },
    { id: "eu", name: "乌克兰", icon: "🇺🇦", reg: /乌克兰|基辅|(?<![a-zA-Z])UA(?![a-zA-Z])|Ukraine/i },
    { id: "eu", name: "土耳其", icon: "🇹🇷", reg: /土耳其|伊斯坦布尔|(?<![a-zA-Z])TR(?![a-zA-Z])|Turkey/i },
    { name: "加拿大", icon: "🇨🇦", reg: /加拿大|多伦多|温哥华|蒙特利尔|(?<![a-zA-Z])CA(?![a-zA-Z])|Canada/i },
    { name: "印度", icon: "🇮🇳", reg: /印度|孟买|新德里|(?<![a-zA-Z])IN(?![a-zA-Z])|India/i },
    { name: "阿根廷", icon: "🇦🇷", reg: /阿根廷|布宜诺斯艾利斯|(?<![a-zA-Z])AR(?![a-zA-Z])|Argentina/i },
    { name: "尼日利亚", icon: "🇳🇬", reg: /尼日利亚|(?<![a-zA-Z])NG(?![a-zA-Z])|Nigeria/i },
    { name: "越南", icon: "🇻🇳", reg: /越南|胡志明|(?<![a-zA-Z])VN(?![a-zA-Z])|Vietnam/i },
    { name: "澳大利亚", icon: "🇦🇺", reg: /澳大利亚|澳洲|悉尼|墨尔本|(?<![a-zA-Z])AU(?![a-zA-Z])|Australia|Sydney/i },
    { name: "巴西", icon: "🇧🇷", reg: /巴西|圣保罗|(?<![a-zA-Z])BR(?![a-zA-Z])|Brazil/i },
    { name: "阿联酋", icon: "🇦🇪", reg: /阿联酋|迪拜|(?<![a-zA-Z])(?:AE|UAE)(?![a-zA-Z])/i },
    { id: "cn", name: "中国", icon: "🇨🇳", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(CN|PRC)(?![a-zA-Z])|China/i }
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

  // 预编译正则，提升匹配效率
  const REGEX_INFO_NODE = /剩余流量|套餐到期|有效时间|官网|过期|通知|更新|重置|交流群|TG群|联系客服|获取/;
  const REGEX_ENTRY_CITY = /(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|香港|台湾|日本|韩国|新加坡|美国)/;
  // 💡 修复：移除全局标志 g，防止潜在的正则对象状态残留
  const REGEX_MULTI = /(?:^|[\s_\-\(\)\[\]【】])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*[xX×]|[xX×]\s*(\d+(?:\.\d+)?))(?=[\s_\-\(\)\[\]【】]|$)/i;
  const REGEX_LINE = /(IEPL|IPLC|BGP|CN2|GIA|专线|直连|中转|隧道|CMI|CUG|PCCW|HGC|HSBC|优化|9929|4837)/i;
  // 💡 优化：使用更规范的 Unicode 属性正则匹配国旗
  const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;
  const REGEX_ALL_FLAGS = /\p{Regional_Indicator}{2}/gu;
  
  const TAG_MAP = {"深圳":"深", "广州":"广", "上海":"沪", "北京":"京", "杭州":"杭", "四川":"川", "江苏":"苏", "宁波":"甬", "东莞":"莞"};
  const AI_PREFERRED_REGIONS = ["us", "jp", "tw", "sg", "kr", "eu"]; 

  // =========================================================================
  // --- 2. 节点双重遍历：清洗、计数与分发入桶 ---
  // =========================================================================
  const BUCKETS = {
    hk: [], tw: [], jp: [], kr: [], sg: [], us: [], eu: [], cn: [], other: [],
    garbage: [], download: [], info: [], allStandard: [],
    chatgpt: [], gemini: [], claude: [], game: []
  };

  // 【第一次遍历】：过滤节点并提取地区/专线/倍率等信息
  const processedData = proxies.map(proxy => {
    let rawName = proxy.name;
    
    if (['DIRECT', 'REJECT', 'COMPATIBLE'].includes(rawName)) return { skip: true };
    
    // 拦截机场营销与公告节点
    if (REGEX_INFO_NODE.test(rawName)) {
        if (USER_CONFIG.removeInfoNodes) return { skip: true }; 
        return { isInfo: true, proxy }; 
    }

    let name = rawName;
    
    // 🧹 清除多余的杂七杂八 Emoji，仅保留代表国家的国旗 Emoji
    name = name.replace(/\p{Extended_Pictographic}/gu, m => {
      const cp = m.codePointAt(0);
      return (cp >= 0x1F1E6 && cp <= 0x1F1FF) ? m : ""; 
    });

    let suffixArr = [], icons = [], featurePools = [];
    let entryStr = "", multiStr = "", lineArr = [];
    
    // 提取入口城市
    const entryMatch = name.match(REGEX_ENTRY_CITY);
    if (entryMatch) entryStr = TAG_MAP[entryMatch[1]] || entryMatch[1];

    // 提取倍率
    let isLowMulti = false;
    name = name.replace(REGEX_MULTI, (m, m1, m2, m3) => {
      let num = parseFloat(m1 || m2 || m3);
      if (!isNaN(num)) {
        multiStr = `x${num}`; 
        if (num < 1) isLowMulti = true;
      }
      return "";
    });

    // 提取专线特征
    let lineMatch;
    // 因为去掉了正则的 g 标志，使用安全的局部提取防死循环
    const tempLineRegex = new RegExp(REGEX_LINE.source, 'ig');
    while ((lineMatch = tempLineRegex.exec(name)) !== null) {
      lineArr.push(lineMatch[0].length > 2 ? lineMatch[0].toUpperCase() : lineMatch[0]);
    }
    name = name.replace(tempLineRegex, "");

    // 组装后缀数组
    if (entryStr) suffixArr.push(entryStr);
    if (lineArr.length > 0) suffixArr.push(...new Set(lineArr)); 
    if (multiStr) suffixArr.push(multiStr);

    // 提取功能特征与图标 (游戏/AI/流媒体等)
    ICON_RULES.forEach(rule => {
      const newName = name.replace(new RegExp(rule.reg.source, 'ig'), "");
      if (newName !== name) {
        icons.push(rule.icon);
        if (rule.pool) featurePools.push(rule.pool);
        name = newName;
      }
    });
    // 低倍率节点自动打上下载标记
    if (isLowMulti && !icons.includes("⏬")) icons.push("⏬");

    // 提取主要国家和地区
    let regionInfo = REGION_DEFS.find(item => item.reg.test(name));
    if (regionInfo) {
      name = name.replace(REGEX_ALL_FLAGS, ""); 
      name = name.replace(new RegExp(regionInfo.reg.source, "ig"), "");
    } else {
      // 未知地区匹配兜底
      const flagMatch = name.match(REGEX_UNKNOWN_FLAG);
      if (flagMatch) {
        regionInfo = { id: 'other', icon: flagMatch[1], name: flagMatch[2].trim() };
        name = name.replace(REGEX_ALL_FLAGS, "").replace(flagMatch[2], "");
      }
    }

    // 清理残余的标点符号与空字符
    name = name.replace(/[\[\]{}()<>（）【】]/g, '').replace(/\b\d{1,3}\b/g, "").replace(/[-_\|\s]+/g, " ").trim() || "其他";
    let groupKey = regionInfo ? regionInfo.name : name;

    return { proxy, regionInfo, groupKey, rawName, icons, featurePools, suffixArr };
  }).filter(d => d && !d.skip);

  // 统计每个分组的数量，用于后续添加数字序号
  const counts = {};
  processedData.forEach(d => { if (!d.isInfo) counts[d.groupKey] = (counts[d.groupKey] || 0) + 1; });

  // 【第二次遍历】：统一规范重命名，并把节点扔进对应的策略桶里
  const groupTrack = {}; 
  processedData.forEach(item => {
    if (item.isInfo) {
      BUCKETS.info.push(item.proxy.name);
      return; 
    }

    let { proxy, regionInfo, groupKey, rawName, icons, featurePools, suffixArr } = item;
    groupTrack[groupKey] = (groupTrack[groupKey] || 0) + 1;
    
    // 组装最终优雅的名称: 🇭🇰 香港 [01] 📺 | 深 BGP x1.5
    let numStr = counts[groupKey] > 1 ? ` [${groupTrack[groupKey].toString().padStart(2, '0')}]` : "";
    let finalName = regionInfo ? `${regionInfo.icon} ${regionInfo.name}${numStr}` : `🗑️ ${rawName}`; 
    
    if (icons.length > 0) finalName += ` ${[...new Set(icons)].join("")}`;
    if (regionInfo && suffixArr.length > 0) finalName += ` | ${suffixArr.join(" ")}`; 

    proxy.name = finalName; 

    // 根据标签分配节点到对应的可用组
    if (icons.includes("⏬")) {
      BUCKETS.download.push(finalName);
    } else {
      BUCKETS.allStandard.push(finalName);
      featurePools.forEach(p => BUCKETS[p].push(finalName)); 
      if (!regionInfo) BUCKETS.garbage.push(finalName);
      else BUCKETS[regionInfo.id || 'other'].push(finalName);
    }
  });
  
  // 回写回代理列表，保留原有的 DIRECT 等系统默认节点
  config.proxies = proxies.filter(p => ['DIRECT', 'REJECT', 'COMPATIBLE'].includes(p.name)).concat(processedData.map(d => d.proxy));
  
  // =========================================================================
  // --- 3. 动态可用策略组构建 ---
  // =========================================================================
  const safeList = (list, defaultNodes = ["DIRECT"]) => list.length > 0 ? list : defaultNodes;

  const REGION_NAMES = { cn: "🇨🇳 大陆节点", hk: "🇭🇰 香港节点", tw: "🇹🇼 台湾节点", jp: "🇯🇵 日本节点", kr: "🇰🇷 韩国节点", sg: "🇸🇬 新加坡节点", us: "🇺🇸 美国节点", eu: "🇪🇺 欧洲节点" };
  
  const activeRegionGroups = Object.keys(REGION_NAMES).filter(k => BUCKETS[k].length > 0).map(k => REGION_NAMES[k]);
  if (BUCKETS.other.length > 0) activeRegionGroups.push("🌐 其他节点");
  if (BUCKETS.garbage.length > 0) activeRegionGroups.push("🗑️ 未知识别");

  const hasGlobalProxy = activeRegionGroups.some(g => g !== "🇨🇳 大陆节点" && g !== "🗑️ 未知识别");

  const standardOptions = ["📍 节点选择", "🚀 自动选择", "♻️ 故障转移"];
  if (BUCKETS.download.length > 0) standardOptions.push("⚖️ 负载均衡");
  standardOptions.push(...activeRegionGroups);

  const coreSelectProxies = ["🚀 自动选择", "♻️ 故障转移"];
  if (BUCKETS.download.length > 0) coreSelectProxies.push("⚖️ 负载均衡");
  coreSelectProxies.push(...activeRegionGroups, "DIRECT", ...BUCKETS.info); 

  // =========================================================================
  // --- 4. 组装 Proxy-Groups (支持高度自动化的去重与隐藏) ---
  // =========================================================================
  const buildSelect = (name, proxies, hidden = false) => ({ 
    name, type: "select", proxies: [...new Set(proxies)], hidden 
  });

  const buildRegionGroup = (name, proxies, hidden = false) => {
    const type = USER_CONFIG.regionGroupType || "url-test";
    const base = { name, type, proxies: [...new Set(safeList(proxies))], hidden };
    if (type !== "select") {
      base.url = USER_CONFIG.testURL || "http://cp.cloudflare.com/generate_204";
      base.interval = USER_CONFIG.testInterval || 300;
      base.lazy = true;
      if (type === "url-test") base.tolerance = USER_CONFIG.testTolerance || 50;
    }
    return base;
  };

  const appGroups = [];
  
  if (USER_CONFIG.enableAI) {
    const aiCore = AI_PREFERRED_REGIONS.map(id => REGION_NAMES[id]).filter(g => activeRegionGroups.includes(g));
    const showOpenAI = aiCore.length > 0 || BUCKETS.chatgpt.length > 0;
    const showGemini = aiCore.length > 0 || BUCKETS.gemini.length > 0;
    const showClaude = aiCore.length > 0 || BUCKETS.claude.length > 0;
    appGroups.push(
      buildSelect("🤖 OpenAI", [...aiCore, ...BUCKETS.chatgpt, "📍 节点选择", "DIRECT"], !showOpenAI),
      buildSelect("♊ Gemini", [...aiCore, ...BUCKETS.gemini, "📍 节点选择", "DIRECT"], !showGemini),
      buildSelect("🦀 Claude", [...aiCore, ...BUCKETS.claude, "📍 节点选择", "DIRECT"], !showClaude)
    );
  }

  if (USER_CONFIG.enableScholar) {
    const scholarProxies = ["🇺🇸 美国节点", "🇪🇺 欧洲节点", "🇯🇵 日本节点", "🇸🇬 新加坡节点", "🇹🇼 台湾节点", "🇭🇰 香港节点"].filter(g => activeRegionGroups.includes(g));
    appGroups.push(buildSelect("🎓 学术网站", [...scholarProxies, "📍 节点选择", "DIRECT"], scholarProxies.length === 0));
  }
  if (USER_CONFIG.enableCrypto) {
    const cryptoCore = ["🇹🇼 台湾节点", "🇯🇵 日本节点", "🇪🇺 欧洲节点"].filter(g => activeRegionGroups.includes(g));
    appGroups.push(buildSelect("🪙 加密货币", [...cryptoCore, "📍 节点选择", "DIRECT"], !hasGlobalProxy));
  }
  if (USER_CONFIG.enablePayPal)   appGroups.push(buildSelect("💳 PayPal", ["DIRECT", "📍 节点选择", ...activeRegionGroups], !hasGlobalProxy));

  if (USER_CONFIG.enableGame)     appGroups.push(buildSelect("🎮 游戏服务", ["DIRECT", ...standardOptions, ...BUCKETS.game], !hasGlobalProxy));
  if (USER_CONFIG.enableSocial)   appGroups.push(buildSelect("💬 社交平台", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableYouTube)  appGroups.push(buildSelect("▶️ YouTube", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableNetflix)  appGroups.push(buildSelect("🎬 Netflix", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableGitHub)   appGroups.push(buildSelect("🐱 GitHub", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableTelegram) appGroups.push(buildSelect("✈️ Telegram", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableSpotify)  appGroups.push(buildSelect("🎧 Spotify", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  
  if (USER_CONFIG.enableBilibili) {
    const biliCore = ["🇹🇼 台湾节点", "🇭🇰 香港节点"].filter(g => activeRegionGroups.includes(g));
    const biliProxies = USER_CONFIG.enableDomesticGroup ? ["🇨🇳 中国分流", ...biliCore, "DIRECT"] : ["DIRECT", ...biliCore];
    appGroups.push(buildSelect("📺 哔哩哔哩", biliProxies, !USER_CONFIG.enableDomesticGroup && biliCore.length === 0));
  }
  
  if (USER_CONFIG.enableTikTok) {
    const tiktokCore = activeRegionGroups.filter(g => g !== "🇭🇰 香港节点" && g !== "🇨🇳 大陆节点" && g !== "🗑️ 未知识别");
    appGroups.push(buildSelect("🎵 TikTok", [...tiktokCore, "📍 节点选择", "DIRECT"], tiktokCore.length === 0));
  }

  if (USER_CONFIG.enableSystemServices) {
    appGroups.push(
      buildSelect("🪟 Microsoft", ["DIRECT", ...standardOptions], !hasGlobalProxy),
      buildSelect("🔍 Google", [...standardOptions, "DIRECT"], !hasGlobalProxy),
      buildSelect("🍎 Apple", ["DIRECT", ...standardOptions], !hasGlobalProxy)
    );
  }
  if (USER_CONFIG.enableAdBlock)  appGroups.push(buildSelect("🚫 广告拦截", ["REJECT", "DIRECT"]));

  // 【核心控制组】
  const finalGroups = [
    buildSelect("📍 节点选择", coreSelectProxies),
    { name: "🚀 自动选择", type: "url-test", url: USER_CONFIG.testURL, interval: USER_CONFIG.testInterval, tolerance: USER_CONFIG.testTolerance, proxies: safeList(BUCKETS.allStandard) },
    { name: "♻️ 故障转移", type: "fallback", url: USER_CONFIG.testURL, interval: USER_CONFIG.testInterval, proxies: safeList([...activeRegionGroups, "DIRECT"]) }
  ];

  // 【下载负载均衡池】
  finalGroups.push(buildSelect("⚖️ 负载均衡", BUCKETS.download.length > 0 ? ["DIRECT", "⚖️ 负载均衡轮询池", "🚀 自动选择", ...BUCKETS.download] : ["DIRECT"], BUCKETS.download.length === 0));
  finalGroups.push({ name: "⚖️ 负载均衡轮询池", type: "load-balance", strategy: "round-robin", url: USER_CONFIG.testURL, interval: 300, lazy: true, proxies: safeList(BUCKETS.download), hidden: true });

  if (USER_CONFIG.enableDomesticGroup) finalGroups.push(buildSelect("🇨🇳 中国分流", ["DIRECT", ...standardOptions, "🚀 自动选择"]));

  // 合并应用组与杂项组
  finalGroups.push(...appGroups);
  finalGroups.push(buildSelect("🐟 漏网之鱼", USER_CONFIG.proxyFirst ? ["📍 节点选择", "🚀 自动选择", "DIRECT"] : ["DIRECT", "📍 节点选择", "🚀 自动选择"]));

  finalGroups.push(...Object.entries(REGION_NAMES).map(([id, name]) => buildRegionGroup(name, BUCKETS[id], BUCKETS[id].length === 0)));
  finalGroups.push(buildSelect("🌐 其他节点", safeList(BUCKETS.other), BUCKETS.other.length === 0));
  finalGroups.push(buildSelect("🗑️ 未知识别", safeList(BUCKETS.garbage), BUCKETS.garbage.length === 0));

  config["proxy-groups"] = finalGroups;

  // =========================================================================
  // --- 5. 规则集配置 (Rule Providers) ---
  // =========================================================================
  const REPO = "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta";
  const ruleFormat = USER_CONFIG.useMRS ? "mrs" : "yaml"; 

  const PROVIDER_BASE = {
    "lan-domain": "geosite/private", 
    "lan-ip": "geoip/private",
    "non-cn": "geosite/geolocation-!cn", 
    "cn-domain": "geosite/cn", 
    "cn-ip": "geoip/cn",
    "bt-trackers-pt": "geosite/category-pt", 
    "bt-trackers-public": "geosite/category-public-tracker",
    "download-android": "geosite/category-android-app-download",
    "download-games": "geosite/category-game-platforms-download", 
    "download-games-cn": "geosite/category-game-platforms-download@cn"
  };

  if (USER_CONFIG.enableAdBlock) PROVIDER_BASE["ads"] = "geosite/category-ads-all";
  if (USER_CONFIG.enableAI) {
    Object.assign(PROVIDER_BASE, { "openai": "geosite/openai", "gemini": "geosite/google-gemini", "claude": "geosite/anthropic" });
  }
  if (USER_CONFIG.enableScholar)  PROVIDER_BASE["scholar"] = "geosite/category-scholar-!cn";
  if (USER_CONFIG.enableGame)     Object.assign(PROVIDER_BASE, { "steam": "geosite/steam", "steam-cn": "geosite/steam@cn", "epic": "geosite/epicgames" });
  if (USER_CONFIG.enableBilibili) PROVIDER_BASE["bilibili"] = "geosite/bilibili";
  if (USER_CONFIG.enableYouTube)  PROVIDER_BASE["youtube"] = "geosite/youtube";
  if (USER_CONFIG.enableNetflix)  PROVIDER_BASE["netflix"] = "geosite/netflix";
  if (USER_CONFIG.enableGitHub)   PROVIDER_BASE["github"] = "geosite/github";
  if (USER_CONFIG.enableCrypto)   PROVIDER_BASE["crypto"] = "geosite/category-cryptocurrency";
  if (USER_CONFIG.enablePayPal)   PROVIDER_BASE["paypal"] = "geosite/paypal";
  if (USER_CONFIG.enableSpotify)  PROVIDER_BASE["spotify"] = "geosite/spotify";
  if (USER_CONFIG.enableTikTok)   PROVIDER_BASE["tiktok"] = "geosite/tiktok";
  if (USER_CONFIG.enableSocial) {
    Object.assign(PROVIDER_BASE, { "twitter": "geosite/twitter", "facebook": "geosite/facebook", "instagram": "geosite/instagram", "discord": "geosite/discord" });
  }
  if (USER_CONFIG.enableTelegram) {
    Object.assign(PROVIDER_BASE, { "telegram": "geosite/telegram", "telegram-ip": "geoip/telegram" });
  }
  if (USER_CONFIG.enableSystemServices) {
    Object.assign(PROVIDER_BASE, { "google": "geosite/google", "apple": "geosite/apple", "microsoft": "geosite/microsoft" });
  }

  config["rule-providers"] = Object.fromEntries(
    Object.entries(PROVIDER_BASE).map(([name, route]) => [
      name, { 
        type: "http", 
        behavior: route.includes("geoip") ? "ipcidr" : "domain", 
        url: `${REPO}/geo/${route}.${ruleFormat}`, 
        path: `./ruleset/${name}.${ruleFormat}`, 
        interval: 86400, 
        format: ruleFormat, 
        proxy: "🚀 自动选择" 
      }
    ])
  );

  // =========================================================================
  // --- 6. 策略分流规则 ---
  // =========================================================================
  const routingRules = [
    "RULE-SET,lan-domain,DIRECT",
    "RULE-SET,lan-ip,DIRECT,no-resolve"
  ];

  if (USER_CONFIG.enableQUICReject) routingRules.push("AND,((NETWORK,UDP),(DST-PORT,443)),REJECT");
  if (USER_CONFIG.enableAdBlock)    routingRules.push("RULE-SET,ads,🚫 广告拦截");

  const osTarget = USER_CONFIG.osType.toLowerCase();
  const isWin = ["windows", "all"].includes(osTarget);
  const isMac = ["mac", "all"].includes(osTarget);
  const isLin = ["linux", "all"].includes(osTarget);

  if (isWin) routingRules.push("PROCESS-NAME,qBittorrent.exe,DIRECT", "PROCESS-NAME,Thunder.exe,DIRECT", "PROCESS-NAME,IDM.exe,⚖️ 负载均衡");
  if (isMac) routingRules.push("PROCESS-NAME,qbittorrent,DIRECT", "PROCESS-NAME,Thunder,DIRECT");
  if (isLin) routingRules.push("PROCESS-NAME,qbittorrent,DIRECT");
  if (isMac || isLin) routingRules.push("PROCESS-NAME,aria2c,DIRECT", "PROCESS-NAME,transmission-daemon,DIRECT");

  routingRules.push(
    "RULE-SET,bt-trackers-pt,DIRECT",
    "RULE-SET,bt-trackers-public,DIRECT",
    "DOMAIN-KEYWORD,tracker,DIRECT", 
    "DOMAIN-KEYWORD,announce,DIRECT",
    "RULE-SET,download-games-cn,DIRECT",
    "RULE-SET,download-games,⚖️ 负载均衡",
    "RULE-SET,download-android,⚖️ 负载均衡"
  );

  if (USER_CONFIG.enableScholar)  routingRules.push("DOMAIN-KEYWORD,sci-hub,🎓 学术网站", "RULE-SET,scholar,🎓 学术网站");
  if (USER_CONFIG.enableGame) {
    routingRules.push(
      "DOMAIN-SUFFIX,steamusercontent.com,🎮 游戏服务", "DOMAIN-SUFFIX,steamserver.net,DIRECT",
      "RULE-SET,steam-cn,DIRECT", "RULE-SET,steam,🎮 游戏服务",
      "DOMAIN-SUFFIX,epicgames.com,DIRECT", "RULE-SET,epic,🎮 游戏服务"
    );
  }

  if (USER_CONFIG.enableAI)       routingRules.push("RULE-SET,openai,🤖 OpenAI", "RULE-SET,gemini,♊ Gemini", "RULE-SET,claude,🦀 Claude");
  if (USER_CONFIG.enableCrypto)   routingRules.push("RULE-SET,crypto,🪙 加密货币");
  if (USER_CONFIG.enablePayPal)   routingRules.push("RULE-SET,paypal,💳 PayPal");
  if (USER_CONFIG.enableBilibili) routingRules.push("RULE-SET,bilibili,📺 哔哩哔哩");
  if (USER_CONFIG.enableYouTube)  routingRules.push("RULE-SET,youtube,▶️ YouTube");
  if (USER_CONFIG.enableNetflix)  routingRules.push("RULE-SET,netflix,🎬 Netflix");
  if (USER_CONFIG.enableGitHub)   routingRules.push("RULE-SET,github,🐱 GitHub");
  if (USER_CONFIG.enableSpotify)  routingRules.push("RULE-SET,spotify,🎧 Spotify");
  if (USER_CONFIG.enableTikTok)   routingRules.push("RULE-SET,tiktok,🎵 TikTok");
  
  if (USER_CONFIG.enableSocial) {
    routingRules.push("RULE-SET,twitter,💬 社交平台", "RULE-SET,facebook,💬 社交平台", "RULE-SET,instagram,💬 社交平台", "RULE-SET,discord,💬 社交平台");
  }

  if (USER_CONFIG.enableTelegram) {
    if (isWin) routingRules.push("PROCESS-NAME,Telegram.exe,✈️ Telegram");
    if (isMac || isLin) routingRules.push("PROCESS-NAME,Telegram,✈️ Telegram");
    routingRules.push("RULE-SET,telegram,✈️ Telegram", "RULE-SET,telegram-ip,✈️ Telegram,no-resolve");
  }
  
  if (USER_CONFIG.enableSystemServices) {
    routingRules.push("RULE-SET,google,🔍 Google", "RULE-SET,apple,🍎 Apple", "RULE-SET,microsoft,🪟 Microsoft");
  }

  const cnTarget = USER_CONFIG.enableDomesticGroup ? "🇨🇳 中国分流" : "DIRECT";
  
  if (USER_CONFIG.proxyFirst) {
    routingRules.push("RULE-SET,non-cn,📍 节点选择", `RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`);
  } else {
    routingRules.push(`RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`, "RULE-SET,non-cn,📍 节点选择");
  }

  routingRules.push("MATCH,🐟 漏网之鱼");
  config["rules"] = routingRules;
  
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