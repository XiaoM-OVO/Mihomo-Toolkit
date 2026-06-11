// =========================================================================
//  📦 Mihomo-Toolkit | 通用动态策略组脚本 | ALL-IN-ONE
// ------------------------------------------------------------------------
// 版本: v2.2.0 (Build 2026.06.11)
// 作者: XiaoM-OVO
// 描述: 专为 Mihomo 内核客户端设计的简易动态路由策略组脚本。
// 功能: 动态清洗 / 智能分流 / 自动容错 / 多场景适配
// 仓库: https://github.com/XiaoM-OVO/mihomo-toolkit
// =========================================================================
// 💡 【节点清洗图标说明】
// 🤖 : OpenAI / ChatGPT      ♊ : Google Gemini       🦀 : Anthropic Claude
// 📺 : 流媒体访问 (NF/P+)     🎮 : 游戏 / FullCone      ⚡ : Hysteria / 高速
// 🛡️ : AnyTLS / 安全协议      📱 : WAP 移动优化         ⏬ : 下载 / BT 专用
// 🆓 : 免费 / 公益节点         🗑️ : 清洗失败节点          🏠 ：住宅IP / 家宽
// =========================================================================

function main(config) {

  // =========================================================================
  // ⚙️ 用户自定义配置区 (开关配置) - true 为开启，false 为关闭
  // =========================================================================
  const USER_CONFIG = {
    // 【1. 脚本总控】
    enableScript: true,          // 🟢 总开关：设为 false 则原样输出订阅内容，不修改任何节点

    // 【2. 常用功能分流】
    enableAdBlock: true,         // 🚫 广告拦截：去除网页及 APP 广告
    enableAI: true,              // 🤖 AI 助手：OpenAI, Gemini, Claude 等
    enableGitHub: true,          // 🐱 开发者选项：GitHub, GitLab 等
    enableTelegram: true,        // ✈️ 社交通讯：Telegram 独立分流
    enableScholar: true,         // 🎓 学术研究：Google Scholar 等
    enableYouTube: true,         // ▶️ 影音娱乐：YouTube 独立分流
    enableNetflix: true,         // 🎬 影音娱乐：Netflix 独立分流
    enableDisney: false,         // 🪄 影音娱乐：Disney+ 独立分流
    enableBilibili: true,        // 📺 影音娱乐：哔哩哔哩港澳台
    enableGame: true,            // 🎮 游戏平台：Steam, Epic 等
    enableSystemServices: true,  // 🪟 系统服务：Microsoft, Apple, Google 服务

    // 【3. 专项场景分流】
    enableTikTok: false,         // 🎵 TikTok：自动过滤香港节点
    enableSpotify: false,        // 🎧 Spotify：音乐流媒体
    enableSocial: false,         // 💬 海外社交：Twitter, Meta 等
    enableCrypto: false,         // 🪙 加密货币：Binance 等交易平台
    enablePayPal: false,         // 💳 金融支付：PayPal 独立分流
    enableDomesticGroup: false,  // 🇨🇳 中国分流：开启后增加专门的"中国"策略组
    enableResidential: false,    // 🏠 家宽分流：自动提取住宅/ISP节点，并作为 AI、流媒体、金融的首选

    // 【4. 路由逻辑与设备优化】
    proxyFirst: true,            // 🧭 路由偏好：true(代理优先-推荐,漏网之鱼走代理), false(直连优先-适合重度国内用户)
    osType: "windows",           // 💻 设备类型: "windows", "mac", "linux", "all"
    enableQUICReject: false,     // ⚡ 屏蔽 QUIC: 强制降级至 TCP，避免 UDP 丢包/限速导致的卡顿或断流。若游戏/语音异常请关闭。
    enableIPv6: false,           // 🌐 全局 IPv6 总开关：控制 TUN、DNS 及路由（本地无物理 IPv6 请务必设为 false！）
    removeInfoNodes: false,      // 🗑️ 纯净节点: 彻底过滤流量/到期时间等营销节点

    // 【5. 核心性能与策略组高级参数】
    useMRS: true,                // 🚀 极速模式: true(MRS格式-性能), false(YAML格式-兼容)
    regionGroupType: "url-test", // ⚙️ 地区组行为: "url-test"(自动), "select"(手动), "fallback"(故障转移)
    enableRegionHashLB: false,   // ⚖️ 地区散列: 开启后在核心地区组顶部增加"⚖️ 负载均衡-哈希(地区)"选项，建议配合 regionGroupType:"select" 使用
    testInterval: 300,           // 🕒 测速间隔: 单位秒
    testTolerance: 50,           // ⚖️ 切换阈值: 延迟差低于此值不切换 IP
    testURL: "http://cp.cloudflare.com/generate_204",  // 🔗 延迟测速地址
    ruleProviderCDN: "https://fastly.jsdelivr.net/gh", // 🔗 规则集 CDN

    // 【6. 底层核心配置覆写】
    overwriteTun: true,          // 🖧 覆写 TUN 配置：开启后将强制接管并优化虚拟网卡与严格路由防漏
    overwriteDns: true,          // 📡 覆写 DNS 配置：开启后将强制使用 Fake-IP 与纯净 DNS 解析体系
    overwriteSniffer: true,      // 🔎 覆写 Sniffer 配置：开启后将强制开启深度包检测增强分流
  };

  if (!USER_CONFIG.enableScript) return config;
  const proxies = config.proxies || [];

  // =========================================================================
  // --- 1. 常量与字典预定义 ---
  // =========================================================================
  const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)";

  const REGION_DEFS = [
    { id: "hk",  name: "香港",    icon: "🇭🇰", reg: new RegExp(`${IN_PREFIX}港|香港|香江|(?<![a-zA-Z])HKT?(?![a-zA-Z])|Hong Kong`, "i") },
    { id: "tw",  name: "台湾",    icon: "🇹🇼", reg: new RegExp(`${IN_PREFIX}台|台湾|台灣|台北|新北|(?<![a-zA-Z])TW(?![a-zA-Z])|Taiwan`, "i") },
    { id: "jp",  name: "日本",    icon: "🇯🇵", reg: new RegExp(`${IN_PREFIX}日|日本|东京|大阪|埼玉|(?<![a-zA-Z])JP(?![a-zA-Z])|Japan`, "i") },
    { id: "kr",  name: "韩国",    icon: "🇰🇷", reg: new RegExp(`${IN_PREFIX}韩|韩国|首尔|(?<![a-zA-Z])KR(?![a-zA-Z])|Korea`, "i") },
    { id: "sg",  name: "新加坡",  icon: "🇸🇬", reg: new RegExp(`${IN_PREFIX}新|新加坡|狮城|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore`, "i") },
    { id: "us",  name: "美国",    icon: "🇺🇸", reg: new RegExp(`${IN_PREFIX}美|美国|西美|洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|亚特兰大|凤凰城|(?<![a-zA-Z])(?:US|LAX)(?![a-zA-Z])|Los Angeles|America`, "i") },
    { id: "eu",  name: "英国",    icon: "🇬🇧", reg: /英国|伦敦|(?<![a-zA-Z])UK(?![a-zA-Z])|United Kingdom|Britain/i },
    { id: "eu",  name: "德国",    icon: "🇩🇪", reg: /德国|法兰克福|(?<![a-zA-Z])DE(?![a-zA-Z])|Germany/i },
    { id: "eu",  name: "法国",    icon: "🇫🇷", reg: /法国|巴黎|(?<![a-zA-Z])FR(?![a-zA-Z])|France/i },
    { id: "eu",  name: "俄罗斯",  icon: "🇷🇺", reg: /俄罗斯|莫斯科|伯力|圣彼得堡|(?<![a-zA-Z])RU(?![a-zA-Z])|Russia/i },
    { id: "eu",  name: "乌克兰",  icon: "🇺🇦", reg: /乌克兰|基辅|(?<![a-zA-Z])UA(?![a-zA-Z])|Ukraine/i },
    { id: "eu",  name: "土耳其",  icon: "🇹🇷", reg: /土耳其|伊斯坦布尔|(?<![a-zA-Z])TR(?![a-zA-Z])|Turkey/i },
    { id: "eu",  name: "西班牙",  icon: "🇪🇸", reg: /西班牙|马德里|(?<![a-zA-Z])ES(?![a-zA-Z])|Spain/i },
    { id: "sea", name: "马来西亚",icon: "🇲🇾", reg: /马来|马来西亚|吉隆坡|(?<![a-zA-Z])MY(?![a-zA-Z])|Malaysia/i },
    { id: "sea", name: "泰国",    icon: "🇹🇭", reg: /泰国|曼谷|(?<![a-zA-Z])TH(?![a-zA-Z])|Thailand/i },
    { id: "sea", name: "印尼",    icon: "🇮🇩", reg: /印尼|印度尼西亚|雅加达|(?<![a-zA-Z])ID(?![a-zA-Z])|Indonesia/i },
    { id: "sea", name: "菲律宾",  icon: "🇵🇭", reg: /菲律宾|马尼拉|(?<![a-zA-Z])PH(?![a-zA-Z])|Philippines/i },
    { id: "sea", name: "越南",    icon: "🇻🇳", reg: /越南|胡志明|(?<![a-zA-Z])VN(?![a-zA-Z])|Vietnam/i },
    {            name: "加拿大",  icon: "🇨🇦", reg: /加拿大|多伦多|温哥华|蒙特利尔|(?<![a-zA-Z])CA(?![a-zA-Z])|Canada/i },
    {            name: "印度",    icon: "🇮🇳", reg: /印度|孟买|新德里|(?<![a-zA-Z])IN(?![a-zA-Z])|India/i },
    {            name: "阿根廷",  icon: "🇦🇷", reg: /阿根廷|布宜诺斯艾利斯|(?<![a-zA-Z])AR(?![a-zA-Z])|Argentina/i },
    {            name: "尼日利亚",icon: "🇳🇬", reg: /尼日利亚|(?<![a-zA-Z])NG(?![a-zA-Z])|Nigeria/i },
    {            name: "澳大利亚",icon: "🇦🇺", reg: /澳大利亚|澳洲|悉尼|墨尔本|(?<![a-zA-Z])AU(?![a-zA-Z])|Australia|Sydney/i },
    {            name: "巴西",    icon: "🇧🇷", reg: /巴西|圣保罗|(?<![a-zA-Z])BR(?![a-zA-Z])|Brazil/i },
    {            name: "阿联酋",  icon: "🇦🇪", reg: /阿联酋|迪拜|(?<![a-zA-Z])(?:AE|UAE)(?![a-zA-Z])/i },
    { id: "cn",  name: "中国",    icon: "🇨🇳", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(CN|PRC)(?![a-zA-Z])|China/i }
  ];

  const ICON_RULES = [
    { reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i,                                                            icon: "🤖", pool: "chatgpt" },
    { reg: /\bGemini\b/i,                                                                             icon: "♊", pool: "gemini" },
    { reg: /\bClaude\b/i,                                                                             icon: "🦀", pool: "claude" },
    { reg: /(?:家宽|住宅|双ISP|原生|Residential|Resi|ISP|Home|HKT|HKBN|HGC|WTT|Hinet|Kbro|So[-_]?net|Nuro|Singtel|StarHub)/i, icon: "🏠", pool: "residential" },
    { reg: /(?:游戏)|\b(?:Game|FullCone)\b/i,                                                         icon: "🎮", pool: "game" },
    { reg: /(?:流媒体|解锁)|\b(?:Netflix|NF|Disney\+|YouTube)\b/i,                                    icon: "📺" },
    { reg: /(?:下载)|\bBT\b/i,                                                                        icon: "⏬" },
    { reg: /(?:免费|白嫖|公益)/i,                                                                      icon: "🆓" },
    { reg: /\bWAP\b/i,                                                                                icon: "📱" },
    { reg: /\b(?:HY2|Hysteria)\b/i,                                                                   icon: "⚡" },
    { reg: /-A$|\bAnyTLS\b/i,                                                                         icon: "🛡️" }
  ];

  const REGEX_INFO_NODE  = /剩余流量|套餐到期|有效时间|官网|过期|通知|更新|重置|交流群|TG群|联系客服|获取|公告|维护|不可用|测速|关注|群组|扣费|失联|地址|禁止|仅限|教程|说明|提示|导致|太旧|网站|客服|如果|显示|客户端/;
  const REGEX_ENTRY_CITY = /(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|香港|台湾|日本|韩国|新加坡|美国)/;
  const REGEX_MULTI      = /(?:^|[\s_\-\(\)\[\]【】])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*[xX×]|[xX×]\s*(\d+(?:\.\d+)?))(?=[\s_\-\(\)\[\]【】]|$)/i;
  const REGEX_LINE       = /(IEPL|IPLC|BGP|CN2|GIA|专线|直连|中转|隧道|CMI|CUG|PCCW|HGC|HSBC|优化|9929|4837)/gi;
  const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;
  const REGEX_ALL_FLAGS  = /\p{Regional_Indicator}{2}/gu;

  const TAG_MAP = { "深圳":"深", "广州":"广", "上海":"沪", "北京":"京", "杭州":"杭", "四川":"川", "江苏":"苏", "宁波":"甬", "东莞":"莞" };
  const AI_PREFERRED_REGIONS = ["us", "jp", "tw", "sg", "kr", "eu"];

  // =========================================================================
  // --- 2. 节点双重遍历：清洗、计数与分发入桶 ---
  // =========================================================================
  const BUCKETS = {
    hk: [], tw: [], jp: [], kr: [], sg: [], us: [], eu: [], sea: [], cn: [], other: [],
    garbage: [], download: [], info: [], allStandard: [], residential: [],
    chatgpt: [], gemini: [], claude: [], game: []
  };

  // 【第一次遍历】：过滤节点并提取地区/专线/倍率等信息
  const processedData = proxies.map(proxy => {
    const rawName = proxy.name;
    if (['DIRECT', 'REJECT', 'COMPATIBLE'].includes(rawName)) return { skip: true };

    if (REGEX_INFO_NODE.test(rawName)) {
      if (USER_CONFIG.removeInfoNodes) return { skip: true };
      return { isInfo: true, proxy };
    }

    let name = rawName.replace(/\p{Extended_Pictographic}/gu, m => {
      const cp = m.codePointAt(0);
      return (cp >= 0x1F1E6 && cp <= 0x1F1FF) ? m : "";
    });

    let suffixArr = [], icons = [], featurePools = [];
    let entryStr = "", multiStr = "", lineArr = [], multiNum = 1.0;

    const entryMatch = name.match(REGEX_ENTRY_CITY);
    if (entryMatch) entryStr = TAG_MAP[entryMatch[1]] || entryMatch[1];

    let isLowMulti = false;
    name = name.replace(REGEX_MULTI, (m, m1, m2, m3) => {
      const num = parseFloat(m1 || m2 || m3);
      if (!isNaN(num)) {
        multiNum = num;
        multiStr = `x${num}`;
        if (num < 1) isLowMulti = true;
      }
      return "";
    });

    // REGEX_LINE 已声明为 /gi，直接使用（注意每次调用前需重置 lastIndex）
    REGEX_LINE.lastIndex = 0;
    name = name.replace(REGEX_LINE, match => {
      lineArr.push(match.length > 2 ? match.toUpperCase() : match);
      return "";
    });

    if (entryStr) suffixArr.push(entryStr);
    if (lineArr.length) suffixArr.push(...new Set(lineArr));
    if (multiStr) suffixArr.push(multiStr);

    ICON_RULES.forEach(rule => {
      const newName = name.replace(new RegExp(rule.reg.source, "ig"), "");
      if (newName !== name) {
        icons.push(rule.icon);
        if (rule.pool) featurePools.push(rule.pool);
        name = newName;
      }
    });

    if (isLowMulti && !icons.includes("⏬")) icons.push("⏬");

    let regionInfo = REGION_DEFS.find(item => item.reg.test(name));
    if (regionInfo) {
      name = name.replace(REGEX_ALL_FLAGS, "");
      name = name.replace(new RegExp(regionInfo.reg.source, "ig"), "");
    } else {
      const flagMatch = name.match(REGEX_UNKNOWN_FLAG);
      if (flagMatch) {
        regionInfo = { id: "other", icon: flagMatch[1], name: flagMatch[2].trim() };
        name = name.replace(REGEX_ALL_FLAGS, "").replace(flagMatch[2], "");
      }
    }

    name = name.replace(/[\[\]{}()<>（）【】]/g, "").replace(/\b\d{1,3}\b/g, "").replace(/[-_\|\s]+/g, " ").trim() || "其他";
    const groupKey = regionInfo ? regionInfo.name : name;

    return { proxy, regionInfo, groupKey, rawName, icons, featurePools, suffixArr, multiNum };
  }).filter(d => d && !d.skip);

  const counts = {};
  processedData.forEach(d => { if (!d.isInfo) counts[d.groupKey] = (counts[d.groupKey] || 0) + 1; });

  // 【第二次遍历】：统一规范重命名，并把节点扔进对应的策略桶里
  const groupTrack = {};
  processedData.forEach(item => {
    if (item.isInfo) { BUCKETS.info.push(item.proxy.name); return; }

    const { proxy, regionInfo, groupKey, rawName, icons, featurePools, suffixArr } = item;
    groupTrack[groupKey] = (groupTrack[groupKey] || 0) + 1;

    const numStr   = counts[groupKey] > 1 ? ` [${groupTrack[groupKey].toString().padStart(2, "0")}]` : "";
    let finalName  = regionInfo ? `${regionInfo.icon} ${regionInfo.name}${numStr}` : `🗑️ ${rawName}${numStr}`;
    if (icons.length)                       finalName += ` ${[...new Set(icons)].join("")}`;
    if (regionInfo && suffixArr.length)     finalName += ` | ${suffixArr.join(" ")}`;
    proxy.name = finalName;

    // 分发入桶
    if (icons.includes("⏬")) {
      BUCKETS.download.push(finalName);
    } else if (USER_CONFIG.enableResidential && icons.includes("🏠")) {
      featurePools.forEach(p => BUCKETS[p].push(finalName));
    } else {
      BUCKETS.allStandard.push(finalName);
      featurePools.forEach(p => BUCKETS[p].push(finalName));
      if (!regionInfo) BUCKETS.garbage.push(finalName);
      else BUCKETS[regionInfo.id || "other"].push(finalName);
    }
  });

  config.proxies = proxies.filter(p => ["DIRECT", "REJECT", "COMPATIBLE"].includes(p.name))
    .concat(processedData.map(d => d.proxy));

  // =========================================================================
  // --- 3. 动态可用策略组构建 ---
  // =========================================================================
  const safeList = (list, defaultNodes = ["DIRECT"]) => list.length > 0 ? list : defaultNodes;

  const REGION_NAMES = {
    cn: "🇨🇳 大陆节点", hk: "🇭🇰 香港节点", tw: "🇹🇼 台湾节点", jp: "🇯🇵 日本节点",
    kr: "🇰🇷 韩国节点", sg: "🇸🇬 新加坡节点", us: "🇺🇸 美国节点", eu: "🇪🇺 欧洲节点", sea: "🏝️ 东南亚节点"
  };

  const activeRegionGroups = Object.keys(REGION_NAMES).filter(k => BUCKETS[k].length > 0).map(k => REGION_NAMES[k]);
  if (BUCKETS.other.length)   activeRegionGroups.push("🌐 其他节点");
  if (BUCKETS.garbage.length) activeRegionGroups.push("🗑️ 未知识别");

  const hasGlobalProxy  = activeRegionGroups.some(g => g !== "🇨🇳 大陆节点" && g !== "🗑️ 未知识别");
  const hasLoadBalancer = BUCKETS.download.length > 0;

  const standardOptions = ["📍 手动选择", "🚀 自动选择", "♻️ 故障转移"];
  if (USER_CONFIG.enableResidential && BUCKETS.residential.length) standardOptions.push("🏠 家宽专用");
  standardOptions.push(...activeRegionGroups);

  // 手动选择组的候选列表（不含负载均衡，打破循环引用）
  const coreSelectProxies = ["🚀 自动选择", "♻️ 故障转移"];
  if (USER_CONFIG.enableResidential && BUCKETS.residential.length) coreSelectProxies.push("🏠 家宽专用");
  coreSelectProxies.push(...activeRegionGroups, "DIRECT", ...BUCKETS.info);

  // =========================================================================
  // --- 4. 组装 Proxy-Groups ---
  // =========================================================================
  const buildSelect = (name, proxies, hidden = false) => ({
    name, type: "select", proxies: [...new Set(proxies)], hidden
  });

  const buildRegionGroup = (name, proxies, hidden = false) => {
    const { regionGroupType: type, testURL: url, testInterval: interval, testTolerance: tolerance } = USER_CONFIG;
    const base = { name, type, proxies: [...new Set(safeList(proxies))], hidden };
    if (type !== "select") {
      Object.assign(base, { url, interval, lazy: true });
      if (type === "url-test") base.tolerance = tolerance;
    }
    return base;
  };

  const appGroups = [];
  const resiPrefix = (USER_CONFIG.enableResidential && BUCKETS.residential.length) ? ["🏠 家宽专用"] : [];

  // AI 三组（特殊：每个 AI 有专属节点桶）
  if (USER_CONFIG.enableAI) {
    const aiCore = AI_PREFERRED_REGIONS.map(id => REGION_NAMES[id]).filter(g => activeRegionGroups.includes(g));
    [
      { name: "🤖 OpenAI",  bucket: BUCKETS.chatgpt },
      { name: "♊ Gemini",  bucket: BUCKETS.gemini  },
      { name: "🦀 Claude",  bucket: BUCKETS.claude  },
    ].forEach(({ name, bucket }) => {
      const show = aiCore.length > 0 || bucket.length > 0;
      appGroups.push(buildSelect(name, [...resiPrefix, ...aiCore, ...bucket, "📍 手动选择", "DIRECT"], !show));
    });
  }

  // 学术（特殊：指定首选地区）
  if (USER_CONFIG.enableScholar) {
    const scholarProxies = ["🇺🇸 美国节点", "🇪🇺 欧洲节点", "🇯🇵 日本节点", "🇸🇬 新加坡节点", "🇹🇼 台湾节点", "🇭🇰 香港节点"].filter(g => activeRegionGroups.includes(g));
    appGroups.push(buildSelect("🎓 学术网站", [...scholarProxies, "📍 手动选择", "DIRECT"], scholarProxies.length === 0));
  }

  // 加密货币（特殊：指定首选地区）
  if (USER_CONFIG.enableCrypto) {
    const cryptoCore = ["🇹🇼 台湾节点", "🇯🇵 日本节点", "🇪🇺 欧洲节点"].filter(g => activeRegionGroups.includes(g));
    appGroups.push(buildSelect("🪙 加密货币", [...resiPrefix, ...cryptoCore, "📍 手动选择", "DIRECT"], !hasGlobalProxy));
  }

  // PayPal（特殊：直连优先 + 家宽前置）
  if (USER_CONFIG.enablePayPal) {
    appGroups.push(buildSelect("💳 PayPal", ["DIRECT", ...resiPrefix, "📍 手动选择", ...activeRegionGroups], !hasGlobalProxy));
  }

  // 游戏（特殊：直连优先 + 游戏专属桶）
  if (USER_CONFIG.enableGame) {
    appGroups.push(buildSelect("🎮 游戏服务", ["DIRECT", ...standardOptions, ...BUCKETS.game], !hasGlobalProxy));
  }

  // 标准应用组：统一模板，仅差名字和开关
  const STANDARD_APP_GROUPS = [
    { key: "enableSocial",   name: "💬 社交平台" },
    { key: "enableYouTube",  name: "▶️ YouTube"  },
    { key: "enableNetflix",  name: "🎬 Netflix"  },
    { key: "enableDisney",   name: "🪄 Disney+"  },
    { key: "enableGitHub",   name: "🐱 GitHub"   },
    { key: "enableTelegram", name: "✈️ Telegram" },
    { key: "enableSpotify",  name: "🎧 Spotify"  },
  ];
  STANDARD_APP_GROUPS.forEach(({ key, name }) => {
    if (USER_CONFIG[key]) appGroups.push(buildSelect(name, [...standardOptions, "DIRECT"], !hasGlobalProxy));
  });

  // 哔哩哔哩（特殊：港台前置 + 国内分流联动）
  if (USER_CONFIG.enableBilibili) {
    const biliCore    = ["🇹🇼 台湾节点", "🇭🇰 香港节点"].filter(g => activeRegionGroups.includes(g));
    const biliProxies = USER_CONFIG.enableDomesticGroup ? ["🇨🇳 中国分流", ...biliCore, "DIRECT"] : ["DIRECT", ...biliCore];
    appGroups.push(buildSelect("📺 哔哩哔哩", biliProxies, !USER_CONFIG.enableDomesticGroup && biliCore.length === 0));
  }

  // TikTok（特殊：过滤香港节点）
  if (USER_CONFIG.enableTikTok) {
    const tiktokCore = activeRegionGroups.filter(g => !["🇭🇰 香港节点", "🇨🇳 大陆节点", "🗑️ 未知识别"].includes(g));
    appGroups.push(buildSelect("🎵 TikTok", [...resiPrefix, ...tiktokCore, "📍 手动选择", "DIRECT"], tiktokCore.length === 0));
  }

  // 系统服务（特殊：Microsoft / Apple 直连优先）
  if (USER_CONFIG.enableSystemServices) {
    appGroups.push(
      buildSelect("🪟 Microsoft", ["DIRECT", ...standardOptions], !hasGlobalProxy),
      buildSelect("🔍 Google",    [...standardOptions, "DIRECT"], !hasGlobalProxy),
      buildSelect("🍎 Apple",     ["DIRECT", ...standardOptions], !hasGlobalProxy)
    );
  }

  if (USER_CONFIG.enableAdBlock) appGroups.push(buildSelect("🚫 广告拦截", ["REJECT-DROP", "REJECT", "DIRECT"]));

  // 【核心控制组】
  const { testURL, testInterval, testTolerance } = USER_CONFIG;
  const finalGroups = [
    buildSelect("📍 手动选择", coreSelectProxies),
    { name: "🚀 自动选择", type: "url-test", url: testURL, interval: testInterval, tolerance: testTolerance, proxies: safeList(BUCKETS.allStandard) },
    { name: "♻️ 故障转移", type: "fallback",  url: testURL, interval: testInterval, proxies: safeList([...activeRegionGroups, "DIRECT"]) }
  ];

  if (USER_CONFIG.enableResidential && BUCKETS.residential.length) {
    finalGroups.push({ name: "🏠 家宽专用", type: "fallback", url: testURL, interval: testInterval, proxies: safeList([...new Set(BUCKETS.residential)]) });
  }
  if (hasLoadBalancer) {
    finalGroups.push(buildSelect("⏬ 下载策略", ["DIRECT", "🔄 负载均衡-轮询", "🚀 自动选择", ...BUCKETS.download]));
    finalGroups.push({ name: "🔄 负载均衡-轮询", type: "load-balance", strategy: "round-robin", url: testURL, interval: 300, lazy: true, proxies: safeList(BUCKETS.download), hidden: true });
  }

  if (USER_CONFIG.enableDomesticGroup) finalGroups.push(buildSelect("🇨🇳 中国分流", ["DIRECT", ...standardOptions]));

  finalGroups.push(...appGroups);
  if (USER_CONFIG.enableIPv6) finalGroups.push(buildSelect("🌐 IPv6控制台", ["📍 手动选择", "REJECT", "DIRECT"]));

  // 漏网之鱼
  let fallbackProxies = ["📍 手动选择", "🚀 自动选择"];
  if (hasLoadBalancer) fallbackProxies.push("⏬ 下载策略");
  if (USER_CONFIG.proxyFirst) fallbackProxies.push("DIRECT");
  else fallbackProxies = ["DIRECT", ...fallbackProxies];
  finalGroups.push(buildSelect("🐟 漏网之鱼", fallbackProxies));

  // 动态将散列算法按地区注入到各个地区组顶部
  if (USER_CONFIG.enableRegionHashLB) {
    const hashWhitelist = ["hk", "tw", "jp", "kr", "sg", "us", "cn"];

    Object.entries(REGION_NAMES).forEach(([id, name]) => {
      if (hashWhitelist.includes(id) && BUCKETS[id].length > 1) {
        const regionName = name.split(" ")[1].replace("节点", "");
        const regionTag = id.toUpperCase();
        const hashGroupName = `⚖️ 负载均衡-哈希 (${regionTag})`;

        finalGroups.push({
          name: hashGroupName,
          type: "load-balance",
          strategy: "consistent-hashing",
          url: USER_CONFIG.testURL,
          interval: USER_CONFIG.testInterval,
          lazy: true,
          proxies: [...BUCKETS[id]],
          hidden: true
        });

        BUCKETS[id].unshift(hashGroupName);
      }
    });
  }

  finalGroups.push(...Object.entries(REGION_NAMES).map(([id, name]) => buildRegionGroup(name, BUCKETS[id], BUCKETS[id].length === 0)));
  finalGroups.push(buildSelect("🌐 其他节点",  safeList(BUCKETS.other),   BUCKETS.other.length === 0));
  finalGroups.push(buildSelect("🗑️ 未知识别", safeList(BUCKETS.garbage), BUCKETS.garbage.length === 0));

  config["proxy-groups"] = finalGroups;

  // =========================================================================
  // --- 5 & 6. 规则集 + 分流规则（FEATURE_MAP 统一驱动）---
  // =========================================================================
  const REPO       = `${USER_CONFIG.ruleProviderCDN}/MetaCubeX/meta-rules-dat@meta`;
  const ruleFormat = USER_CONFIG.useMRS ? "mrs" : "yaml";

  // 始终加载的基础规则集
  const PROVIDER_BASE = {
    "lan-domain":        "geosite/private",
    "lan-ip":            "geoip/private",
    "non-cn":            "geosite/geolocation-!cn",
    "cn-domain":         "geosite/cn",
    "cn-ip":             "geoip/cn",
    "bt-trackers-pt":    "geosite/category-pt",
    "bt-trackers-public":"geosite/category-public-tracker",
    "download-android":  "geosite/category-android-app-download",
    "download-games":    "geosite/category-game-platforms-download",
    "download-games-cn": "geosite/category-game-platforms-download@cn"
  };

  const routingRules = [
    "RULE-SET,lan-domain,DIRECT",
    "RULE-SET,lan-ip,DIRECT,no-resolve"
  ];

  if (USER_CONFIG.enableIPv6) {
    routingRules.push(
      "IP-CIDR6,::1/128,DIRECT,no-resolve",
      "IP-CIDR6,fc00::/7,DIRECT,no-resolve",
      "IP-CIDR6,fe80::/10,DIRECT,no-resolve"
    );
  }
  if (USER_CONFIG.enableQUICReject) routingRules.push("AND,((NETWORK,UDP),(DST-PORT,443)),REJECT-DROP");

  // 功能特性映射表：每项声明该功能需要注册哪些规则集、追加哪些路由规则
  const FEATURE_MAP = [
    {
      key: "enableAdBlock",
      providers: { ads: "geosite/category-ads-all" },
      rules: ["RULE-SET,ads,🚫 广告拦截"]
    },
    {
      key: "enableAI",
      providers: { openai: "geosite/openai", gemini: "geosite/google-gemini", claude: "geosite/anthropic" },
      rules: ["RULE-SET,openai,🤖 OpenAI", "RULE-SET,gemini,♊ Gemini", "RULE-SET,claude,🦀 Claude"]
    },
    {
      key: "enableScholar",
      providers: { scholar: "geosite/category-scholar-!cn" },
      rules: ["DOMAIN-KEYWORD,sci-hub,🎓 学术网站", "RULE-SET,scholar,🎓 学术网站"]
    },
    {
      key: "enableGame",
      providers: { steam: "geosite/steam", "steam-cn": "geosite/steam@cn", epic: "geosite/epicgames" },
      rules: [
        "DOMAIN-SUFFIX,steamusercontent.com,🎮 游戏服务", "DOMAIN-SUFFIX,steamserver.net,DIRECT",
        "RULE-SET,steam-cn,DIRECT", "RULE-SET,steam,🎮 游戏服务",
        "DOMAIN-SUFFIX,epicgames.com,DIRECT", "RULE-SET,epic,🎮 游戏服务"
      ]
    },
    { key: "enableBilibili", providers: { bilibili: "geosite/bilibili" },   rules: ["RULE-SET,bilibili,📺 哔哩哔哩"] },
    { key: "enableYouTube",  providers: { youtube:  "geosite/youtube"  },   rules: ["RULE-SET,youtube,▶️ YouTube"]  },
    { key: "enableNetflix",  providers: { netflix:  "geosite/netflix"  },   rules: ["RULE-SET,netflix,🎬 Netflix"]  },
    { key: "enableDisney",   providers: { disney:   "geosite/disney"   },   rules: ["RULE-SET,disney,🪄 Disney+"]   },
    { key: "enableGitHub",   providers: { github:   "geosite/github"   },   rules: ["RULE-SET,github,🐱 GitHub"]    },
    { key: "enableCrypto",   providers: { crypto:   "geosite/category-cryptocurrency" }, rules: ["RULE-SET,crypto,🪙 加密货币"] },
    { key: "enablePayPal",   providers: { paypal:   "geosite/paypal"   },   rules: ["RULE-SET,paypal,💳 PayPal"]    },
    { key: "enableSpotify",  providers: { spotify:  "geosite/spotify"  },   rules: ["RULE-SET,spotify,🎧 Spotify"]  },
    { key: "enableTikTok",   providers: { tiktok:   "geosite/tiktok"   },   rules: ["RULE-SET,tiktok,🎵 TikTok"]    },
    {
      key: "enableSocial",
      providers: { twitter: "geosite/twitter", facebook: "geosite/facebook", instagram: "geosite/instagram", discord: "geosite/discord" },
      rules: ["RULE-SET,twitter,💬 社交平台", "RULE-SET,facebook,💬 社交平台", "RULE-SET,instagram,💬 社交平台", "RULE-SET,discord,💬 社交平台"]
    },
    {
      key: "enableSystemServices",
      providers: { google: "geosite/google", apple: "geosite/apple", microsoft: "geosite/microsoft" },
      rules: ["RULE-SET,google,🔍 Google", "RULE-SET,apple,🍎 Apple", "RULE-SET,microsoft,🪟 Microsoft"]
    },
  ];

  FEATURE_MAP.forEach(({ key, providers, rules }) => {
    if (!USER_CONFIG[key]) return;
    Object.assign(PROVIDER_BASE, providers);
    routingRules.push(...rules);
  });

  // Telegram 单独处理（进程规则依赖 OS 判断）
  if (USER_CONFIG.enableTelegram) {
    const osTarget = USER_CONFIG.osType.toLowerCase();
    const isWin = ["windows", "all"].includes(osTarget);
    const isMac = ["mac",     "all"].includes(osTarget);
    const isLin = ["linux",   "all"].includes(osTarget);
    if (isWin)        routingRules.push("PROCESS-NAME,Telegram.exe,✈️ Telegram");
    if (isMac||isLin) routingRules.push("PROCESS-NAME,Telegram,✈️ Telegram");
    routingRules.push("RULE-SET,telegram,✈️ Telegram", "RULE-SET,telegram-ip,✈️ Telegram,no-resolve");
    Object.assign(PROVIDER_BASE, { telegram: "geosite/telegram", "telegram-ip": "geoip/telegram" });
  }

  // 下载 / BT 进程规则（依赖 OS 判断，规则集已在 PROVIDER_BASE 基础段）
  const lbTarget = hasLoadBalancer ? "⏬ 下载策略" : "📍 手动选择";
  const osTarget = USER_CONFIG.osType.toLowerCase();
  const isWin = ["windows", "all"].includes(osTarget);
  const isMac = ["mac",     "all"].includes(osTarget);
  const isLin = ["linux",   "all"].includes(osTarget);

  if (isWin) {
    routingRules.push(
      ...["qBittorrent", "Thunder", "BitComet", "uTorrent", "aria2c"].map(p => `PROCESS-NAME,${p}.exe,DIRECT`),
      ...["IDMan", "fdm"].map(p => `PROCESS-NAME,${p}.exe,${lbTarget}`)
    );
  }
  if (isMac)        routingRules.push(...["Thunder", "BitComet", "uTorrent"].map(p => `PROCESS-NAME,${p},DIRECT`));
  if (isMac||isLin) routingRules.push(...["qbittorrent", "aria2c", "transmission-daemon"].map(p => `PROCESS-NAME,${p},DIRECT`));

  routingRules.push(
    "RULE-SET,bt-trackers-pt,DIRECT",
    "RULE-SET,bt-trackers-public,DIRECT",
    "RULE-SET,download-games-cn,DIRECT",
    "DOMAIN-KEYWORD,tracker,DIRECT",
    "DOMAIN-KEYWORD,announce,DIRECT",
    `RULE-SET,download-games,${lbTarget}`,
    `RULE-SET,download-android,${lbTarget}`
  );

  // CN 分流顺序（代理优先 vs 直连优先）
  const cnTarget    = USER_CONFIG.enableDomesticGroup ? "🇨🇳 中国分流" : "DIRECT";
  const nonCnTarget = USER_CONFIG.proxyFirst ? "🚀 自动选择" : "📍 手动选择";
  if (USER_CONFIG.proxyFirst) {
    routingRules.push(`RULE-SET,non-cn,${nonCnTarget}`, `RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`);
  } else {
    routingRules.push(`RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`, `RULE-SET,non-cn,${nonCnTarget}`);
  }

  if (USER_CONFIG.enableIPv6) routingRules.push("IP-CIDR6,::/0,🌐 IPv6控制台,no-resolve");
  routingRules.push("MATCH,🐟 漏网之鱼");

  config["rules"] = routingRules;

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
  // --- 7. TUN 模式与严格路由防漏 ---
  // =========================================================================
  if (USER_CONFIG.overwriteTun) {
    config["ipv6"] = USER_CONFIG.enableIPv6;
    config["tun"] = {
      ...(config.tun || {}),
      "stack": "system",
      "device": "Mihomo",
      "auto-route": true,
      "strict-route": true,
      "auto-detect-interface": true,
      "route-exclude-address": ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"]
    };
  }

  // =========================================================================
  // --- 8. Fake-IP 与纯净 DNS 体系 ---
  // =========================================================================
  if (USER_CONFIG.overwriteDns) {
    const nsPolicySets = ["cn-domain"];
    config["dns"] = {
      "enable": true,
      "listen": "0.0.0.0:1053",
      "ipv6": USER_CONFIG.enableIPv6,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "fake-ip-filter-mode": "blacklist",
      "respect-rules": true,
      "use-hosts": true,
      "use-system-hosts": false,
      "fake-ip-filter": [
        "*.lan", "*.local", "*.arpa", "time.*.com", "ntp.*.com",
        "localhost.ptlogin2.qq.com",
        "*.msftncsi.com", "www.msftconnecttest.com", "ipv6.msftncsi.com",
        "*.ipv6-literal.net", "google.cn", "*.music.163.com", "*.music.126.net"
      ],
      "default-nameserver":              ["223.5.5.5", "119.29.29.29"],
      "direct-nameserver":               ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"],
      "direct-nameserver-follow-policy": true,
      "proxy-server-nameserver":         ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"],
      "nameserver":                      ["https://8.8.8.8/dns-query", "https://1.1.1.1/dns-query"],
      "nameserver-policy": {
        [`rule-set:${nsPolicySets.join(",")}`]: ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"]
      }
    };
  }

  // =========================================================================
  // --- 9. Sniffer 深度包检测（增强分流准确性）---
  // =========================================================================
  if (USER_CONFIG.overwriteSniffer) {
    config["sniffer"] = {
      "enable": true, "force-dns-mapping": true, "parse-pure-ip": true, "override-destination": true,
      "sniff": {
        "TLS":  { "ports": [443, 8443] },
        "HTTP": { "ports": [80, "8080-8880"], "override-destination": true }
      }
    };
  }

  // EOF: May your routing be fast and your connection secure. 🚀
  return config;
}