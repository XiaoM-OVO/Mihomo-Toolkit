// =========================================================================
//  📦 Mihomo-Toolkit | 通用动态策略组脚本 | ALL-IN-ONE
// ------------------------------------------------------------------------
// 版本: v2.4.0 (Build 2026.06.14)
// 作者: XiaoM-OVO
// 描述: 专为 Mihomo 内核客户端设计的简易动态路由策略组脚本。
// 功能: 动态清洗 / 智能分流 / 自动容错 / 多场景适配 / 动态图标组装
// 仓库: https://github.com/XiaoM-OVO/mihomo-toolkit
// =========================================================================
// 💡 【节点清洗图标说明】
// 🤖 : OpenAI / ChatGPT      ♊ : Google Gemini       🦀 : Anthropic Claude
// 📺 : 流媒体访问 (NF/P+)     🎮 : 游戏 / FullCone     ⚡ : HY2 / TUIC / 高速
// 🛡️ : AnyTLS / 安全协议      📱 : WAP 移动优化         ⏬ : 下载 / BT 专用
// 🆓 : 免费 / 公益节点         🗑️ : 清洗失败节点         🏠 ：住宅IP / 家宽
// =========================================================================

function main(config) {

  // =========================================================================
  // ⚙️ 用户自定义配置区 (开关配置) - true 为开启，false 为关闭
  // =========================================================================

  const USER_CONFIG = {
    // 【1. 脚本总控】
    enableScript: true,          // 🟢 总开关：设为 false 则原样输出订阅内容

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
    enableResidential: false,    // 🏠 家宽分流：自动提取住宅/ISP节点作为高级备用

    // 【4. 路由逻辑与设备优化】
    proxyFirst: true,            // 🧭 路由偏好：true(代理优先), false(直连优先)
    osType: "windows",           // 💻 设备类型: "windows", "mac", "linux", "all"
    enableQUICReject: false,     // ⚡ 屏蔽 QUIC: 强制降级至 TCP，避免 UDP 丢包
    enableIPv6: false,           // 🌐 全局 IPv6 总开关：控制 TUN、DNS 及路由（本地无物理 IPv6 请务必设为 false！）
    removeInfoNodes: false,      // 🗑️ 纯净节点: 彻底过滤流量/到期时间等营销节点
    hideGarbageGroup: false,     // 🗑️ 隐藏垃圾桶：无论是否有未知识别节点，强制不在面板显示

    // 【5. 核心性能与策略组高级参数】
    useMRS: true,                // 🚀 极速模式: true(MRS格式), false(YAML格式)
    regionGroupType: "url-test", // ⚙️ 地区组行为: "url-test", "select", "fallback"
    enableRegionHashLB: false,   // ⚖️ 地区散列: 在达到阈值的地区组增加哈希负载均衡策略组
    minorNodeThreshold: 3,       // 📊 小众地区建组阈值：节点数 >= 3 独立建组，否则折叠
    testInterval: 300,           // 🕒 测速间隔: 单位秒
    testTolerance: 50,           // ⚖️ 切换阈值: 延迟差低于此值不切换 IP
    testURL: "http://cp.cloudflare.com/generate_204",  // 🔗 延迟测速地址
    ruleProviderCDN: "https://fastly.jsdelivr.net/gh", // 🔗 规则集 CDN

    // 【6. 底层核心配置覆写】
    overwriteTun: true,          // 🖧 覆写 TUN 配置
    overwriteDns: true,          // 📡 覆写 DNS 配置 (强制 Fake-IP)
    overwriteSniffer: true,      // 🔎 覆写 Sniffer 配置 (深度包检测)
    enableCoreOptimize: true,    // ⚙️ 覆写核心体验: 开启记忆功能、统一延迟、并发与指纹伪装

    // 【7. UI 面板与策略组图标设置】
    groupIconMode: "emoji",       // 🎨 策略组显示模式: "emoji"(仅保留Emoji), "icon"(在线图标并去除Emoji), "both"(同时保留Emoji和在线图标)
    iconRepoOrz: "https://fastly.jsdelivr.net/gh/Orz-3/mini@master/Color/",
    iconRepoKoolson: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/"
  };

  if (!USER_CONFIG.enableScript) return config;

  // =========================================================================
  // --- 1. 物理节点去重逻辑 (基于 Server + Port + Type) ---
  // =========================================================================
  
  let proxies = [];
  const proxySet = new Set();

  (config.proxies || []).forEach(proxy => {
    // 放行内置节点或没有 server 字段的通知节点
    if (['DIRECT', 'REJECT', 'COMPATIBLE'].includes(proxy.name) || !proxy.server) {
      proxies.push(proxy);
      return;
    }
    // 组合唯一键值 (服务器地址:端口:协议)
    const key = `${proxy.server}:${proxy.port}:${proxy.type}`;
    
    if (!proxySet.has(key)) {
      proxySet.add(key);
      proxies.push(proxy);
    }
  });

  // =========================================================================
  // --- 2. 常量与字典预定义 ---
  // =========================================================================
  
  // 📍 前置入口城市前缀（用于匹配 "深港"、"沪日" 等包含中转机的节点命名）
  const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信|香港|台湾|日本|韩国|新加坡|美国)";
  const TAG_MAP   = { "深圳":"深", "广州":"广", "上海":"沪", "北京":"京", "杭州":"杭", "四川":"川", "江苏":"苏", "宁波":"甬", "东莞":"莞", "香港":"港", "台湾":"台", "日本":"日", "韩国":"韩", "新加坡":"新", "美国":"美" };
  
  // 🤖 AI 服务偏好的落地地区（按质量及解锁概率排序）
  const AI_PREFERRED_REGIONS = ["us", "jp", "tw", "sg", "kr", "eu"];

  // 💻 操作系统类型判定
  const OS = (USER_CONFIG.osType || "windows").toLowerCase();
  const IS_WIN = OS === "windows" || OS === "all";
  const IS_MAC = OS === "mac"     || OS === "all";
  const IS_LIN = OS === "linux"   || OS === "all";

  // 🌍 地区识别字典 (按使用频率和地理大区进行了分组)
  const REGION_DEFS = [
    // --- 大中华区 ---
    { id: "cn", name: "中国",   icon: "🇨🇳", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(CN|PRC)(?![a-zA-Z])|China|(?:美|日|韩|港|台|新|英|澳)[^\s]*?(?:-|->|至|=>)?\s*(?:深圳|广州|上海|北京|杭州|成都|武汉|南京|国内|落地)(?!入口|中转|BGP|线路|港|台|日|韩|新|美|英|德|法|澳)/i },
    { id: "hk", name: "香港",   icon: "🇭🇰", reg: new RegExp(`${IN_PREFIX}港|香港|香江|(?<![a-zA-Z])(?:HK|HKT|HKBN|HGC|WTT|PCCW)(?![a-zA-Z])|Hong Kong`, "i") },
    { id: "mo", name: "澳门",   icon: "🇲🇴", reg: /澳门|澳門|Macau|Macao|(?<![a-zA-Z])CTM(?![a-zA-Z])/i },
    { id: "tw", name: "台湾",   icon: "🇹🇼", reg: new RegExp(`${IN_PREFIX}台|台湾|台灣|台北|新北|(?<![a-zA-Z])(?:TW|APTG)(?![a-zA-Z])|Taiwan|Hinet|Kbro|Seednet`, "i") },
    
    // --- 亚洲核心区 ---
    { id: "jp", name: "日本",   icon: "🇯🇵", reg: new RegExp(`${IN_PREFIX}日|日本|东京|大阪|埼玉|(?<![a-zA-Z])(?:JP|OCN)(?![a-zA-Z])|Japan|Nuro|Plala`, "i") },
    { id: "kr", name: "韩国",   icon: "🇰🇷", reg: new RegExp(`${IN_PREFIX}韩|韩国|首尔|(?<![a-zA-Z])KR(?![a-zA-Z])|Korea`, "i") },
    { id: "sg", name: "新加坡", icon: "🇸🇬", reg: new RegExp(`${IN_PREFIX}新|新加坡|狮城|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore|Singtel|StarHub|MyRepublic|ViewQwest`, "i") },
    
    // --- 北美区 ---
    { id: "us", name: "美国",   icon: "🇺🇸", reg: new RegExp(`${IN_PREFIX}美|美国|西美|洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|亚特兰大|凤凰城|(?<![a-zA-Z])(?:US|LAX)(?![a-zA-Z])|Los Angeles|America`, "i") },
    
    // --- 欧洲大区 (归入 eu 组) ---
    { group: "eu", name: "英国",   icon: "🇬🇧", reg: /英国|伦敦|(?<![a-zA-Z])UK(?![a-zA-Z])|United Kingdom|Britain/i },
    { group: "eu", name: "德国",   icon: "🇩🇪", reg: /德国|法兰克福|(?<![a-zA-Z])DE(?![a-zA-Z])|Germany/i },
    { group: "eu", name: "法国",   icon: "🇫🇷", reg: /法国|巴黎|(?<![a-zA-Z])FR(?![a-zA-Z])|France/i },
    { group: "eu", name: "俄罗斯", icon: "🇷🇺", reg: /俄罗斯|莫斯科|伯力|圣彼得堡|(?<![a-zA-Z])RU(?![a-zA-Z])|Russia/i },
    { group: "eu", name: "乌克兰", icon: "🇺🇦", reg: /乌克兰|基辅|(?<![a-zA-Z])UA(?![a-zA-Z])|Ukraine/i },
    { group: "eu", name: "土耳其", icon: "🇹🇷", reg: /土耳其|伊斯坦布尔|(?<![a-zA-Z])TR(?![a-zA-Z])|Turkey/i },
    { group: "eu", name: "西班牙", icon: "🇪🇸", reg: /西班牙|马德里|(?<![a-zA-Z])ES(?![a-zA-Z])|Spain/i },
    
    // --- 东南亚大区 (归入 sea 组) ---
    { group: "sea", name: "马来西亚", icon: "🇲🇾", reg: /马来|马来西亚|吉隆坡|(?<![a-zA-Z])MY(?![a-zA-Z])|Malaysia/i },
    { group: "sea", name: "泰国",     icon: "🇹🇭", reg: /泰国|曼谷|(?<![a-zA-Z])TH(?![a-zA-Z])|Thailand/i },
    { group: "sea", name: "印尼",     icon: "🇮🇩", reg: /印尼|印度尼西亚|雅加达|(?<![a-zA-Z])ID(?![a-zA-Z])|Indonesia/i },
    { group: "sea", name: "菲律宾",   icon: "🇵🇭", reg: /菲律宾|马尼拉|(?<![a-zA-Z])PH(?![a-zA-Z])|Philippines/i },
    { group: "sea", name: "越南",     icon: "🇻🇳", reg: /越南|胡志明|(?<![a-zA-Z])VN(?![a-zA-Z])|Vietnam/i },
    
    // --- 美洲大区 (归入 am 组) ---
    { group: "am", name: "加拿大", icon: "🇨🇦", reg: /加拿大|多伦多|温哥华|蒙特利尔|(?<![a-zA-Z])CA(?![a-zA-Z])|Canada/i },
    { group: "am", name: "阿根廷", icon: "🇦🇷", reg: /阿根廷|布宜诺斯艾利斯|(?<![a-zA-Z])AR(?![a-zA-Z])|Argentina/i },
    { group: "am", name: "巴西",   icon: "🇧🇷", reg: /巴西|圣保罗|(?<![a-zA-Z])BR(?![a-zA-Z])|Brazil/i },
    { group: "am", name: "墨西哥", icon: "🇲🇽", reg: /墨西哥|(?<![a-zA-Z])MX(?![a-zA-Z])|Mexico/i },
    { group: "am", name: "智利",   icon: "🇨🇱", reg: /智利|(?<![a-zA-Z])CL(?![a-zA-Z])|Chile/i },
    
    // --- 其他零散地区 ---
    { name: "印度",     icon: "🇮🇳", reg: /印度|孟买|新德里|(?<![a-zA-Z])IN(?![a-zA-Z])|India/i },
    { name: "尼日利亚", icon: "🇳🇬", reg: /尼日利亚|(?<![a-zA-Z])NG(?![a-zA-Z])|Nigeria/i },
    { name: "澳大利亚", icon: "🇦🇺", reg: /澳大利亚|澳洲|悉尼|墨尔本|(?<![a-zA-Z])AU(?![a-zA-Z])|Australia|Sydney/i },
    { name: "阿联酋",   icon: "🇦🇪", reg: /阿联酋|迪拜|(?<![a-zA-Z])(?:AE|UAE)(?![a-zA-Z])/i },
  ];

  // 🏷️ 节点特性识别字典 (根据关键字打上图标并归入对应的特征池 pool)
  const ICON_RULES = [
    { reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i, icon: "🤖", pool: "chatgpt" },
    { reg: /\bGemini\b/i,                 icon: "♊", pool: "gemini" },
    { reg: /\bClaude\b/i,                 icon: "🦀", pool: "claude" },
    { reg: /(?:家宽|住宅|宽带|原生|Residential|ISP|Home|HKT|HKBN|HGC|WTT|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|So[-_]?net|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)/i, icon: "🏠", pool: "residential" },
    { reg: /(?:游戏)|\b(?:Game|FullCone)\b/i,                      icon: "🎮", pool: "game" },
    { reg: /(?:流媒体|解锁)|\b(?:Netflix|NF|Disney\+|YouTube)\b/i, icon: "📺" },
    { reg: /(?:下载)|\bBT\b/i,                                     icon: "⏬" },
    { reg: /(?:免费|白嫖|公益)/i,                                   icon: "🆓" },
    { reg: /\bWAP\b/i,                                             icon: "📱" },
    { reg: /\b(?:HY2|Hysteria|TUIC)\b/i,                           icon: "⚡" },
    { reg: /-A$|\bAnyTLS\b/i,                                      icon: "🛡️" }
  ];

  // 🧹 常用正则大礼包
  // 清洗冗余说明文字和推广网址
  const REGEX_CLEANUP = /(?:禁止|禁|严禁|请勿|勿|不要|不许|不能|不可|拒绝|屏蔽|防)(?:BT|PT|P2P|下载|跑流|测速|大流量|迅雷|邮件)|(?:仅限|仅供)(?:网页|日常|冲浪|聊天)|\b(?:No|Block|Ban)[\s\-_]*(?:BT|PT|P2P|Torrent|Download)\b|(?:关注|加入|获取).*(?:频道|群组?|TG|电报|地址|网址)|(?:官网|最新|网址|发布页|防失联|群组|TG群?|交流群|联系客服|教程|说明|提示|VIP定制|VIP|定制)|(?:https?:\/\/|www\.)[a-zA-Z0-9][-a-zA-Z0-9]{0,62}\.(?:com|net|org|cc|me|vip|pro|top|xyz|club)/ig;
  // 识别机场下发的系统通知/剩余流量等非代理节点
  const REGEX_INFO_NODE  = /剩余流量|套餐到期|到期时间|有效时间|过期|更新公告|重置|维护|不可用|扣费|节点说明|防失联网址/;
  // 识别前置入口城市 (如 深圳->香港)
  const REGEX_ENTRY_CITY = /(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|香港|台湾|日本|韩国|新加坡|美国)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|香港|台湾|日本|韩国|新加坡|美国)/;
  // 识别节点倍率 (如 x0.5, 1.5x, 倍率: 2.0)
  const REGEX_MULTI      = /(?<![a-zA-Z])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍率)?|(\d+(?:\.\d+)?)\s*(?:[xX×]|倍率)(?!\s*\d))/i;
  // 识别线路类型 (如 IEPL, BGP, CN2)
  const REGEX_LINE       = /(IEPL|IPLC|BGP|CN2|GIA|专线|直连|中转|隧道|CMI|CUG|PCCW|HSBC|优化|9929|4837|移动|联通|电信|三网)/gi;
  // 识别未知国家的 emoji 国旗
  const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;
  const REGEX_ALL_FLAGS  = /\p{Regional_Indicator}{2}/gu;

  // =========================================================================
  // --- 3. 节点双重遍历：清洗、计数与分发入桶 ---
  // =========================================================================
  
  // 🪣 预设分发桶 (用于把清洗后的节点按特征分类存放)
  const BUCKETS = { garbage: [], download: [], info: [], allStandard: [], other: [], eu: [], sea: [], am: [] };
  // 🧠 动态提取所有混合大区的 ID（如 "eu", "sea", "am"）并加入兜底的 "other"
  const MIXED_REGION_IDS = [...new Set(REGION_DEFS.map(r => r.group).filter(Boolean)), "other"];
  // 根据大区字典动态创建桶
  REGION_DEFS.forEach(r => BUCKETS[r.id || r.name] = []);
  // 根据特性字典动态创建桶
  ICON_RULES.filter(r => r.pool).forEach(r => BUCKETS[r.pool] = []);

  // 🔄 第一轮遍历：清洗节点名称、提取特性、智能判定地区
  const processedData = proxies.map(proxy => {
  const rawName = proxy.name;
    
    // 忽略基础默认节点
    if (['DIRECT', 'REJECT', 'COMPATIBLE'].includes(rawName)) return { skip: true };

    // 判断是否为通知/流量说明节点
    if (REGEX_INFO_NODE.test(rawName)) {
      if (USER_CONFIG.removeInfoNodes) return { skip: true };
      
      // 强行把通知节点魔改为 REJECT，防止误选后断网或泄露
      proxy.server = "127.0.0.1";
      proxy.port = 80;
      
      return { isInfo: true, proxy };
    }

    // 清理节点名称自带的 emoji 表情包
    let name = rawName.replace(/\p{Extended_Pictographic}/gu, m => {
      const cp = m.codePointAt(0);
      return (cp >= 0x1F1E6 && cp <= 0x1F1FF) ? m : "";
    });

    //去除中文字符之间的无意义空格
    name = name.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2");

    // 🧹 清除各类非 Emoji 的花里胡哨装饰符号（涵盖：箭头、方块、特殊图形、带圈数字、杂项符号等）
    name = name.replace(/[\u2190-\u21FF\u2460-\u24FF\u2500-\u27BF\u2B00-\u2BFF]/g, " ");

    // 检查是否包含禁止下载等关键字
    const isForbidDownload = /(?:禁止|禁|严禁|请勿|勿|不要|不许|不能|不可|拒绝|屏蔽|防)(?:BT|PT|P2P|下载|跑流|测速|大流量|迅雷|邮件)|(?:仅限|仅供)(?:网页|日常|冲浪|聊天)|\b(?:No|Block|Ban)[\s\-_]*(?:BT|PT|P2P|Torrent|Download)\b/i.test(rawName);
    
    // 移除常见的冗余广告字符
    name = name.replace(REGEX_CLEANUP, "");

    let suffixArr = [], icons = [], featurePools = [];
    let entryStr = "", multiStr = "", lineArr = [], multiNum = 1.0;

    // 提取前置节点 (如 深港 的 深)
    const entryMatch = name.match(REGEX_ENTRY_CITY);
    if (entryMatch) entryStr = TAG_MAP[entryMatch[1]] || entryMatch[1];

    // 提取并记录节点倍率
    let isLowMulti = false;
    name = name.replace(REGEX_MULTI, (m, m1, m2, m3) => {
      const num = parseFloat(m1 || m2 || m3);
      if (!isNaN(num)) { 
        multiNum = num; 
        multiStr = `x${num}`; 
        if (num < 1) isLowMulti = true; // 倍率小于1的标记为低倍率
      }
      return "";
    });

    if (entryStr) suffixArr.push(entryStr);
    if (multiStr) suffixArr.push(multiStr);

    // 🧠 核心：智能地区匹配算法
    let regionInfo = null;
    const matchedRegions = REGION_DEFS.map(r => {
      const m = name.match(r.reg);
      return m ? { def: r, len: m[0].length, index: m.index } : null;
    }).filter(Boolean);

    if (matchedRegions.length > 0) {
      regionInfo = matchedRegions.reduce((prev, curr) => {
        if (curr.len !== prev.len) return curr.len > prev.len ? curr : prev;
        return curr.index > prev.index ? curr : prev; 
      }).def;
    } else {
      // 找不到预设地区时，尝试读取未知国旗
      const flagMatch = name.match(REGEX_UNKNOWN_FLAG);
      if (flagMatch) regionInfo = { id: "other", icon: flagMatch[1], name: flagMatch[2].trim() };
    }

    // 🚂 提取专线特征 (放在地区匹配之后)
    name = name.replace(REGEX_LINE, match => {
      lineArr.push(match.length > 2 ? match.toUpperCase() : match);
      return "";
    });
    if (lineArr.length) suffixArr.push(...new Set(lineArr));

    // 提取特征标签 (如 AI, 流媒体等)
    ICON_RULES.forEach(rule => {
      if (rule.reg.test(name)) {
        icons.push(rule.icon);
        if (rule.pool) featurePools.push(rule.pool);
        name = name.replace(new RegExp(rule.reg.source, "ig"), ""); // 提取后删除原词
      }
    });

    // 自动降级：低倍率且未明确禁止下载的，强行打上下载标签
    if (isLowMulti && !isForbidDownload && !icons.includes("⏬")) {
      icons.push("⏬");
    }

    // 擦除地名相关文字，准备重命名
    if (regionInfo && regionInfo.id !== "other") {
      name = name.replace(REGEX_ALL_FLAGS, "").replace(new RegExp(regionInfo.reg.source, "ig"), "");
    } else if (regionInfo && regionInfo.id === "other") {
      name = name.replace(REGEX_ALL_FLAGS, "").replace(regionInfo.name, "");
    }

    // 极致瘦身，清空乱码和孤立数字
    name = name.replace(/[\[\]{}()<>（）【】]/g, "").replace(/\b\d{1,3}\b/g, "").replace(/[-_\|\s]+/g, " ").trim() || "其他";
    const groupKey = regionInfo ? regionInfo.name : name;

    return { proxy, regionInfo, groupKey, rawName, icons, featurePools, suffixArr, multiNum };
  }).filter(d => d && !d.skip);

  // 🧹 在分组和编号前，对清洗后的数据进行排序 (按地区 -> 倍率升序 -> 名称)
  processedData.sort((a, b) => {
    if (a.groupKey !== b.groupKey) return (a.groupKey || "other").localeCompare(b.groupKey || "other");
    if (a.multiNum !== b.multiNum) return a.multiNum - b.multiNum; // 倍率低的排前面
    return a.rawName.localeCompare(b.rawName);
  });

  // 🔢 计算同地区节点数量，用于添加编号 [01] [02]
  const counts = {};
  processedData.forEach(d => { 
    if (!d.isInfo) counts[d.groupKey] = (counts[d.groupKey] || 0) + 1; 
  });

  const groupTrack = {};
  
  // 🔄 第二轮遍历：执行重命名，并把节点扔进对应的桶里
  processedData.forEach(item => {
    if (item.isInfo) { BUCKETS.info.push(item.proxy.name); return; }

    const { proxy, regionInfo, groupKey, rawName, icons, featurePools, suffixArr } = item;
    groupTrack[groupKey] = (groupTrack[groupKey] || 0) + 1;

    // 组装全新的节点名格式：🇭🇰 香港 [01] 🤖 | BGP x1.5
    const numStr = counts[groupKey] > 1 ? ` [${groupTrack[groupKey].toString().padStart(2, "0")}]` : "";
    let finalName = regionInfo ? `${regionInfo.icon} ${regionInfo.name}${numStr}` : `🗑️ ${rawName}${numStr}`;
    
    if (icons.length) finalName += ` ${[...new Set(icons)].join("")}`;
    if (regionInfo && suffixArr.length) finalName += ` | ${suffixArr.join(" ")}`;
    
    // 覆盖原节点名
    proxy.name = finalName;

    // 🪣 分发逻辑 (互斥隔离设计：垃圾进垃圾桶，家宽进家宽桶，普通进普通桶)
    if (icons.includes("⏬")) {
      BUCKETS.download.push(finalName);
    } else if (USER_CONFIG.enableResidential && icons.includes("🏠")) {
      featurePools.forEach(p => BUCKETS[p].push(finalName));
    } else {
      BUCKETS.allStandard.push(finalName);
      featurePools.forEach(p => BUCKETS[p].push(finalName));
      if (!regionInfo) {
        BUCKETS.garbage.push(finalName);
      } else {
        BUCKETS[regionInfo.id || regionInfo.name].push(finalName);
      }
    }
  });

  // 更新总的 proxies 列表
  config.proxies = proxies
    .filter(p => ["DIRECT", "REJECT", "COMPATIBLE"].includes(p.name))
    .concat(processedData.map(d => d.proxy));

  // =========================================================================
  // --- 4. 动态可用策略组构建 ---
  // =========================================================================

  const REGION_NAMES = {
    cn: "🇨🇳 大陆节点", hk: "🇭🇰 香港节点", tw: "🇹🇼 台湾节点", jp: "🇯🇵 日本节点",
    kr: "🇰🇷 韩国节点", sg: "🇸🇬 新加坡节点", us: "🇺🇸 美国节点"
  };

  const CORE_BUCKET_KEYS = Object.keys(BUCKETS).filter(k => !REGION_NAMES[k] && !["other", "eu", "sea", "am"].includes(k));

  // 🧹 处理小众节点：如果不够阈值，折叠到大区（如 欧洲、美洲）或“其他”组里
  REGION_DEFS.forEach(r => {
    const key = r.id || r.name;
    if (REGION_NAMES[key]) return; // 排除已经预设的核心大区

    const nodes = BUCKETS[key];
    if (nodes && nodes.length > 0) {
      if (nodes.length >= USER_CONFIG.minorNodeThreshold) {
        REGION_NAMES[key] = `${r.icon} ${r.name}节点`; 
      } else {
        BUCKETS[r.group || "other"].push(...nodes);
        BUCKETS[key] = [];
      }
    }
  });

  // 处理三大折叠区：不够阈值的最终流放到 BUCKETS.other
  [
    { id: "eu",  icon: "🇪🇺",   name: "欧洲" }, 
    { id: "sea", icon: "🏝️", name: "东南亚" }, 
    { id: "am",  icon: "🌵",  name: "美洲" }
  ].forEach(continent => {
    if (BUCKETS[continent.id]?.length >= USER_CONFIG.minorNodeThreshold) {
      REGION_NAMES[continent.id] = `${continent.icon} ${continent.name}节点`;
    } else {
      BUCKETS.other.push(...(BUCKETS[continent.id] || []));
      BUCKETS[continent.id] = [];
    }
  });

  // 获取当前实际有节点的地区组名称
  const activeRegionGroups = Object.keys(REGION_NAMES)
    .filter(k => BUCKETS[k]?.length > 0)
    .map(k => REGION_NAMES[k]);
    
  const hasGlobalProxy  = activeRegionGroups.some(g => g !== "🇨🇳 大陆节点" && g !== "🗑️ 未知识别");
  const hasLoadBalancer = BUCKETS.download.length > 0;
  
  const resiPrefix = (USER_CONFIG.enableResidential && BUCKETS.residential.length) ? ["🏠 家宽专用"] : [];
  
  // 核心的公共代理选项预置
  const standardOptions = ["📍 手动选择", "🚀 自动选择", "♻️ 故障转移", ...resiPrefix, ...activeRegionGroups];
  const coreSelectProxies = ["🚀 自动选择", "♻️ 故障转移", ...resiPrefix, ...activeRegionGroups, "DIRECT", ...BUCKETS.info];

  // =========================================================================
  // --- 5. 组装 Proxy-Groups ---
  // =========================================================================

  const buildSelect = (name, proxies, hidden = false) => ({ name, type: "select", proxies: [...new Set(proxies)], hidden });
  
  const buildRegionGroup = (id, name, proxies, hidden = false) => {
    let { regionGroupType: type, testURL: url, testInterval: interval, testTolerance: tolerance } = USER_CONFIG;
    if (MIXED_REGION_IDS.includes(id)) type = "select"; // 混合大区强制手动防跳 IP
    const base = { name, type, proxies: [...new Set(proxies)], hidden };
    if (type !== "select") {
      Object.assign(base, { url, interval, lazy: true, ...(type === "url-test" && { tolerance }) });
    }
    return base;
  };

  const appGroups = [];
  const { testURL, testInterval, testTolerance } = USER_CONFIG;

  // 📋 各大 App 的分流策略配置注册表
  const APP_GROUPS_REGISTRY = [
    { key: "enableScholar", name: "🎓 学术网站", proxies: ["🇺🇸 美国节点", "🇪🇺 欧洲节点", "🇯🇵 日本节点", "🇸🇬 新加坡节点", "🇹🇼 台湾节点", "🇭🇰 香港节点", "📍 手动选择", "DIRECT"], hideWhen: !hasGlobalProxy },
    { key: "enableCrypto",  name: "🪙 加密货币", proxies: ["📍 手动选择", "🇹🇼 台湾节点", "🇯🇵 日本节点", "🇪🇺 欧洲节点", ...resiPrefix, "DIRECT"], hideWhen: !hasGlobalProxy },
    { key: "enablePayPal",  name: "💳 PayPal",  proxies: ["DIRECT", "📍 手动选择", ...activeRegionGroups, ...resiPrefix], hideWhen: !hasGlobalProxy },
    { key: "enableGame",    name: "🎮 游戏服务", proxies: ["DIRECT", ...standardOptions, ...BUCKETS.game], hideWhen: !hasGlobalProxy },
    { key: "enableTikTok",  name: "🎵 TikTok",  proxies: ["📍 手动选择", ...activeRegionGroups.filter(g => !["🇭🇰 香港节点", "🇨🇳 大陆节点", "🗑️ 未知识别"].includes(g)), "DIRECT"], hideWhen: !hasGlobalProxy },
    { key: "enableSocial",  name: "💬 社交平台", proxies: [...standardOptions, "DIRECT"], hideWhen: !hasGlobalProxy },
    { key: "enableYouTube", name: "▶️ YouTube", proxies: [...standardOptions, "DIRECT"], hideWhen: !hasGlobalProxy },
    { key: "enableNetflix", name: "🎬 Netflix", proxies: [...standardOptions, "DIRECT"], hideWhen: !hasGlobalProxy },
    { key: "enableDisney",  name: "🪄 Disney+", proxies: [...standardOptions, "DIRECT"], hideWhen: !hasGlobalProxy },
    { key: "enableGitHub",  name: "🐱 GitHub",  proxies: [...standardOptions, "DIRECT"], hideWhen: !hasGlobalProxy },
    { key: "enableTelegram",name: "✈️ Telegram",proxies: [...standardOptions, "DIRECT"], hideWhen: !hasGlobalProxy },
    { key: "enableSpotify", name: "🎧 Spotify", proxies: [...standardOptions, "DIRECT"], hideWhen: !hasGlobalProxy },
  ];

   // AI 节点独立判定处理
  if (USER_CONFIG.enableAI) {
    const aiCore = AI_PREFERRED_REGIONS.map(id => REGION_NAMES[id]); 
    ["chatgpt", "gemini", "claude"].forEach((key, i) => {
      const names = ["🤖 ChatGPT", "♊ Gemini", "🦀 Claude"];
      const show = aiCore.some(g => activeRegionGroups.includes(g)) || BUCKETS[key].length > 0;
      appGroups.push(buildSelect(names[i], [...resiPrefix, ...aiCore, ...BUCKETS[key], "📍 手动选择", "DIRECT"], !show));
    });
  }

  // 哔哩哔哩特殊处理
  if (USER_CONFIG.enableBilibili) {
    const biliCore = ["🇹🇼 台湾节点", "🇲🇴 澳门节点", "🇭🇰 香港节点"];
    const biliProxies = USER_CONFIG.enableDomesticGroup ? ["🇨🇳 中国分流", ...biliCore, "DIRECT"] : ["DIRECT", ...biliCore];
    appGroups.push(buildSelect("📺 哔哩哔哩", biliProxies, !hasGlobalProxy));
  }

  // 系统服务处理
  if (USER_CONFIG.enableSystemServices) {
    ["🪟 Microsoft", "🔍 Google", "🍎 Apple"].forEach(name => {
      const pList = name === "🔍 Google" ? [...standardOptions, "DIRECT"] : ["DIRECT", ...standardOptions];
      appGroups.push(buildSelect(name, pList, !hasGlobalProxy));
    });
  }

  // 根据注册表循环构建 APP 策略组
  APP_GROUPS_REGISTRY.forEach(({ key, name, proxies, hideWhen }) => {
    if (USER_CONFIG[key]) appGroups.push(buildSelect(name, proxies, hideWhen));
  });

  if (USER_CONFIG.enableAdBlock) {
    appGroups.push(buildSelect("🚫 广告拦截", ["REJECT-DROP", "REJECT", "DIRECT"]));
  }

  // 组装核心基础策略组
  const finalGroups = [
    buildSelect("📍 手动选择", coreSelectProxies),
    { name: "🚀 自动选择", type: "url-test", url: testURL, interval: testInterval, tolerance: testTolerance, proxies: BUCKETS.allStandard },
    { name: "♻️ 故障转移", type: "fallback", url: testURL, interval: testInterval, proxies: activeRegionGroups }
  ];

  // 挂载家宽、下载、中国组等专属组
  if (USER_CONFIG.enableResidential) {
    finalGroups.push({ name: "🏠 家宽专用", type: "fallback", url: testURL, interval: testInterval, proxies: BUCKETS.residential, hidden: BUCKETS.residential.length === 0 });
  }
  
  // 下载组强制装载，如果为空设定 hidden=true 让 DAG 去连带干掉规则
  finalGroups.push(buildSelect("⏬ 下载策略", ["DIRECT", "🔄 负载均衡-轮询", "🚀 自动选择", ...BUCKETS.download], !hasLoadBalancer));
  finalGroups.push({ name: "🔄 负载均衡-轮询", type: "load-balance", strategy: "round-robin", url: testURL, interval: 300, lazy: true, proxies: BUCKETS.download, hidden: true });

  if (USER_CONFIG.enableDomesticGroup) {
    const cnCore = ["🇨🇳 大陆节点", "🇭🇰 香港节点", "🇲🇴 澳门节点", "🇹🇼 台湾节点"];
    const cnProxies = USER_CONFIG.proxyFirst 
      ? [...cnCore, "DIRECT", "📍 手动选择"]
      : ["DIRECT", ...cnCore, "📍 手动选择"];
    finalGroups.push(buildSelect("🇨🇳 中国分流", cnProxies));
  }

  finalGroups.push(...appGroups);
  
  if (USER_CONFIG.enableIPv6) {
    finalGroups.push(buildSelect("🌐 IPv6控制台", ["REJECT", "📍 手动选择", "DIRECT"]));
  }

  // 构建漏网之鱼
  let fallbackProxies = ["📍 手动选择", "🚀 自动选择", "⏬ 下载策略"];
  fallbackProxies = USER_CONFIG.proxyFirst ? [...fallbackProxies, "DIRECT"] : ["DIRECT", ...fallbackProxies];
  finalGroups.push(buildSelect("🐟 漏网之鱼", fallbackProxies));

  // 地区哈希负载均衡 (动态适配所有单地区，全自动排除混合大区)
  if (USER_CONFIG.enableRegionHashLB) {
    Object.keys(REGION_NAMES).forEach(id => {
      if (!MIXED_REGION_IDS.includes(id) && BUCKETS[id] && BUCKETS[id].length > 1) {
        const hashGroupName = `⚖️ 负载均衡-哈希 (${id.toUpperCase()})`;
        finalGroups.push({ 
          name: hashGroupName, type: "load-balance", strategy: "consistent-hashing", 
          url: testURL, interval: testInterval, lazy: true, proxies: [...BUCKETS[id]], hidden: true 
        });
        BUCKETS[id].unshift(hashGroupName);
      }
    });
  }

  // 挂载各大区国家策略组
  Object.entries(REGION_NAMES).forEach(([id, name]) => {
    if (BUCKETS[id] && BUCKETS[id].length > 0) {
      finalGroups.push(buildRegionGroup(id, name, BUCKETS[id]));
    }
  });
  finalGroups.push(
    buildSelect("🌐 其他节点", BUCKETS.other, BUCKETS.other.length === 0), 
    buildSelect("🗑️ 未知识别", BUCKETS.garbage, USER_CONFIG.hideGarbageGroup || BUCKETS.garbage.length === 0)
  );
  
  config["proxy-groups"] = finalGroups;

  // =========================================================================
  // --- 6. 规则集 + 分流规则 ---
  // =========================================================================

  const REPO = `${USER_CONFIG.ruleProviderCDN}/MetaCubeX/meta-rules-dat@meta`;
  const ruleFormat = USER_CONFIG.useMRS ? "mrs" : "yaml";

  const PROVIDER_BASE = {
    "lan-domain": "geosite/private", "lan-ip": "geoip/private", "non-cn": "geosite/geolocation-!cn",
    "cn-domain": "geosite/cn", "cn-ip": "geoip/cn", "bt-trackers-pt": "geosite/category-pt",
    "bt-trackers-public": "geosite/category-public-tracker", "download-android": "geosite/category-android-app-download",
    "download-games": "geosite/category-game-platforms-download", "download-games-cn": "geosite/category-game-platforms-download@cn"
  };

  const routingRules = [
    "RULE-SET,lan-domain,DIRECT", 
    "RULE-SET,lan-ip,DIRECT,no-resolve"
  ];
  
  if (USER_CONFIG.enableIPv6) {
    routingRules.push("IP-CIDR6,::1/128,DIRECT,no-resolve", "IP-CIDR6,fc00::/7,DIRECT,no-resolve", "IP-CIDR6,fe80::/10,DIRECT,no-resolve");
  }

  if (USER_CONFIG.enableQUICReject) {
    routingRules.push("AND,((NETWORK,UDP),(DST-PORT,443)),REJECT-DROP");
  }

  const FEATURE_MAP = [
    { key: "enableAdBlock", providers: { ads: "geosite/category-ads-all" }, rules: ["RULE-SET,ads,🚫 广告拦截"] },
    { key: "enableAI", providers: { openai: "geosite/openai", gemini: "geosite/google-gemini", claude: "geosite/anthropic" }, rules: ["RULE-SET,openai,🤖 ChatGPT", "RULE-SET,gemini,♊ Gemini", "RULE-SET,claude,🦀 Claude"] },
    { key: "enableScholar", providers: { scholar: "geosite/category-scholar-!cn" }, rules: ["DOMAIN-KEYWORD,sci-hub,🎓 学术网站", "RULE-SET,scholar,🎓 学术网站"] },
    { key: "enableGame", providers: { steam: "geosite/steam", "steam-cn": "geosite/steam@cn", epic: "geosite/epicgames" }, rules: ["DOMAIN-SUFFIX,steamusercontent.com,🎮 游戏服务", "DOMAIN-SUFFIX,steamserver.net,DIRECT", "RULE-SET,steam-cn,DIRECT", "RULE-SET,steam,🎮 游戏服务", "DOMAIN-SUFFIX,epicgames.com,DIRECT", "RULE-SET,epic,🎮 游戏服务"] },
    { key: "enableBilibili", providers: { bilibili: "geosite/bilibili" }, rules: ["RULE-SET,bilibili,📺 哔哩哔哩"] },
    { key: "enableYouTube", providers: { youtube: "geosite/youtube" }, rules: ["RULE-SET,youtube,▶️ YouTube"] },
    { key: "enableNetflix", providers: { netflix: "geosite/netflix" }, rules: ["RULE-SET,netflix,🎬 Netflix"] },
    { key: "enableDisney", providers: { disney: "geosite/disney" }, rules: ["RULE-SET,disney,🪄 Disney+"] },
    { key: "enableGitHub", providers: { github: "geosite/github" }, rules: ["RULE-SET,github,🐱 GitHub"] },
    { key: "enableCrypto", providers: { crypto: "geosite/category-cryptocurrency" }, rules: ["RULE-SET,crypto,🪙 加密货币"] },
    { key: "enablePayPal", providers: { paypal: "geosite/paypal" }, rules: ["RULE-SET,paypal,💳 PayPal"] },
    { key: "enableSpotify", providers: { spotify: "geosite/spotify" }, rules: ["RULE-SET,spotify,🎧 Spotify"] },
    { key: "enableTikTok", providers: { tiktok: "geosite/tiktok" }, rules: ["RULE-SET,tiktok,🎵 TikTok"] },
    { key: "enableSocial", providers: { twitter: "geosite/twitter", facebook: "geosite/facebook", instagram: "geosite/instagram", discord: "geosite/discord" }, rules: ["RULE-SET,twitter,💬 社交平台", "RULE-SET,facebook,💬 社交平台", "RULE-SET,instagram,💬 社交平台", "RULE-SET,discord,💬 社交平台"] },
    { key: "enableSystemServices", providers: { google: "geosite/google", apple: "geosite/apple", microsoft: "geosite/microsoft" }, rules: ["RULE-SET,google,🔍 Google", "RULE-SET,apple,🍎 Apple", "RULE-SET,microsoft,🪟 Microsoft"] },
  ];

  FEATURE_MAP.forEach(({ key, providers, rules }) => {
    if (USER_CONFIG[key]) { 
      Object.assign(PROVIDER_BASE, providers); 
      routingRules.push(...rules); 
    }
  });

  if (USER_CONFIG.enableTelegram) {
    if (IS_WIN) routingRules.push("PROCESS-NAME,Telegram.exe,✈️ Telegram");
    if (IS_MAC || IS_LIN) routingRules.push("PROCESS-NAME,Telegram,✈️ Telegram");
    routingRules.push("RULE-SET,telegram,✈️ Telegram", "RULE-SET,telegram-ip,✈️ Telegram,no-resolve");
    Object.assign(PROVIDER_BASE, { telegram: "geosite/telegram", "telegram-ip": "geoip/telegram" });
  }

  // P2P 及下载软件分流防漏
  if (IS_WIN) {
    routingRules.push(...["qBittorrent", "Thunder", "BitComet", "uTorrent", "aria2c"].map(p => `PROCESS-NAME,${p}.exe,DIRECT`));
    routingRules.push(...["IDMan", "fdm"].map(p => `PROCESS-NAME,${p}.exe,⏬ 下载策略`));
  }
  if (IS_MAC) routingRules.push(...["Thunder", "BitComet", "uTorrent"].map(p => `PROCESS-NAME,${p},DIRECT`));
  if (IS_MAC || IS_LIN) routingRules.push(...["qbittorrent", "aria2c", "transmission-daemon"].map(p => `PROCESS-NAME,${p},DIRECT`));

  routingRules.push(
    "RULE-SET,bt-trackers-pt,DIRECT", 
    "RULE-SET,bt-trackers-public,DIRECT", 
    "DOMAIN-KEYWORD,tracker,DIRECT", 
    "DOMAIN-KEYWORD,announce,DIRECT", 
    "RULE-SET,download-games-cn,DIRECT", 
    "RULE-SET,download-games,⏬ 下载策略", 
    "RULE-SET,download-android,⏬ 下载策略"
  );

  const cnTarget = USER_CONFIG.enableDomesticGroup ? "🇨🇳 中国分流" : "DIRECT";
  const nonCnTarget = USER_CONFIG.proxyFirst ? "🚀 自动选择" : "📍 手动选择";
  
  if (USER_CONFIG.proxyFirst) {
    routingRules.push(`RULE-SET,non-cn,${nonCnTarget}`, `RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`);
  } else {
    routingRules.push(`RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`, `RULE-SET,non-cn,${nonCnTarget}`);
  }

  if (USER_CONFIG.enableIPv6) routingRules.push("IP-CIDR6,::/0,🌐 IPv6控制台,no-resolve");
  routingRules.push("MATCH,🐟 漏网之鱼");

  config["rules"] = [...new Set(routingRules)];
  
  config["rule-providers"] = Object.fromEntries(
    Object.entries(PROVIDER_BASE).map(([name, route]) => [
      name, { 
        type: "http", behavior: route.includes("geoip") ? "ipcidr" : "domain", 
        url: `${REPO}/geo/${route}.${ruleFormat}`, path: `./ruleset/${name}.${ruleFormat}`, 
        interval: 86400, format: ruleFormat, proxy: "DIRECT" 
      }
    ])
  );

  // =========================================================================
  // --- 7. 🚀 核心重构：DAG 级联空组清理机制 ---
  // =========================================================================

  const validBasics = new Set(["DIRECT", "REJECT", "REJECT-DROP", "COMPATIBLE", "PASS", ...(config.proxies || []).map(p => p.name)]);
  let changed = true;
  const removedGroups = new Set();

  while (changed) {
    changed = false;
    const aliveGroups = new Set(config["proxy-groups"].map(g => g.name));

    config["proxy-groups"] = config["proxy-groups"].filter(group => {
      // a. 从列表中剔除物理不存在或已被斩首的节点/组
      if (group.proxies) {
        group.proxies = group.proxies.filter(p => validBasics.has(p) || aliveGroups.has(p));
      }

      // b. 判定：被洗劫一空，或用户显式隐藏(非负载均衡组件)
      const isEmpty = !group.proxies || group.proxies.length === 0;
      const isExplicitlyHidden = group.hidden && !group.name.includes("负载均衡");
      const isExempt = ["📍 手动选择", "🐟 漏网之鱼"].includes(group.name); // 骨架组免死金牌

      // 执行斩首
      if ((isEmpty && !isExempt) || isExplicitlyHidden) {
        removedGroups.add(group.name); 
        aliveGroups.delete(group.name);
        changed = true; // 触发下一轮震荡
        return false;   
      }
      
      // 若骨架组全军覆没，强行复苏 DIRECT 防止内核崩溃
      if (isEmpty && isExempt) group.proxies = ["DIRECT"];

      return true;
    });
  }

  // 同步清理殉葬的分流规则与孤儿 Rule Providers
  if (removedGroups.size > 0) {
    if (config.rules) {
      config.rules = config.rules.filter(rule => {
        const parts = rule.split(',');
        const target = parts[parts.length - 1] === "no-resolve" ? parts[parts.length - 2] : parts[parts.length - 1];
        return !removedGroups.has(target); 
      });
    }
    
    if (config["rule-providers"] && config.rules) {
      const usedProviders = new Set();
      config.rules.forEach(rule => { if (rule.startsWith("RULE-SET,")) usedProviders.add(rule.split(",")[1]); });
      Object.keys(config["rule-providers"]).forEach(key => {
        if (!usedProviders.has(key)) delete config["rule-providers"][key];
      });
    }
  }

  // =========================================================================
  // --- 8. 🎨 策略组图标与 Emoji 清洗 ---
  // =========================================================================

  const REPO_ORZ     = USER_CONFIG.iconRepoOrz;
  const REPO_Qure    = USER_CONFIG.iconRepoKoolson;
  
  const ICON_MAPPING = {
    // === ⚙️ 核心与基础策略组 ===
    "📍 手动选择":      { icon: REPO_ORZ + "Static.png",     newName: "手动选择" },
    "🚀 自动选择":      { icon: REPO_ORZ + "Urltest.png",    newName: "自动选择" },
    "♻️ 故障转移":      { icon: REPO_ORZ + "Available.png",  newName: "故障转移" },
    "⏬ 下载策略":      { icon: REPO_ORZ + "Roundrobin.png", newName: "下载策略" },
    "🏠 家宽专用":      { icon: REPO_ORZ + "Home.png",       newName: "家宽专用" },
    // === 🌐 常见媒体与服务 ===
    "🇨🇳 中国分流":      { icon: REPO_Qure + "China_Map.png", newName: "中国分流" },
    "🎓 学术网站":      { icon: REPO_Qure + "Scholar.png",   newName: "学术网站" },
    "🪙 加密货币":      { icon: REPO_Qure + "Cryptocurrency.png", newName: "加密货币" },
    "💳 PayPal":       { icon: REPO_Qure + "PayPal.png",    newName: "PayPal" },
    "🎮 游戏服务":      { icon: REPO_Qure + "Game.png",      newName: "游戏服务" },
    "🎵 TikTok":       { icon: REPO_Qure + "TikTok.png",    newName: "TikTok" },
    "💬 社交平台":      { icon: REPO_Qure + "Discord.png",   newName: "社交平台" },
    "▶️ YouTube":      { icon: REPO_Qure + "YouTube.png",   newName: "YouTube" },
    "🎬 Netflix":      { icon: REPO_Qure + "Netflix.png",   newName: "Netflix" },
    "🪄 Disney+":      { icon: REPO_Qure + "Disney.png",    newName: "Disney+" },
    "🐱 GitHub":       { icon: REPO_Qure + "GitHub.png",    newName: "GitHub" },
    "✈️ Telegram":     { icon: REPO_Qure + "Telegram.png",  newName: "Telegram" },
    "🎧 Spotify":      { icon: REPO_Qure + "Spotify.png",   newName: "Spotify" },
    "🤖 ChatGPT":      { icon: REPO_ORZ  + "OpenAI.png",    newName: "ChatGPT" },
    "♊ Gemini":       { icon: REPO_Qure + "AI.png",        newName: "Gemini" },
    "🦀 Claude":       { icon: REPO_Qure + "Bot.png",       newName: "Claude" },
    "📺 哔哩哔哩":      { icon: REPO_ORZ + "Bili.png",       newName: "哔哩哔哩" },
    "🪟 Microsoft":    { icon: REPO_ORZ + "Microsoft.png",  newName: "Microsoft" },
    "🔍 Google":       { icon: REPO_ORZ + "Google.png",     newName: "Google" },
    "🍎 Apple":        { icon: REPO_ORZ + "Apple.png",      newName: "Apple" },
    // === 🛡️ 兜底与特殊规则 ===
    "🚫 广告拦截":      { icon: REPO_Qure + "Reject.png",    newName: "广告拦截" },
    "🌐 IPv6控制台":    { icon: REPO_Qure + "Direct.png",    newName: "IPv6控制台" },
    "🐟 漏网之鱼":      { icon: REPO_Qure + "Final.png",     newName: "漏网之鱼" },
    "🌐 其他节点":      { icon: REPO_Qure + "Global.png",    newName: "其他节点" },
    "🗑️ 未知识别":      { icon: REPO_Qure + "Cydia.png",     newName: "未知识别" }
  };

  if (USER_CONFIG.groupIconMode !== "emoji") {
    const renameMap = {};
    const useIconOnly = USER_CONFIG.groupIconMode === "icon";

    config["proxy-groups"].forEach(group => {
      const oldName = group.name;
      const mapItem = ICON_MAPPING[oldName];
      if (mapItem) {
        group.icon = mapItem.icon;
        if (useIconOnly) {
          renameMap[oldName] = mapItem.newName;
          group.name = mapItem.newName;
        }
      }
    });

    if (useIconOnly && Object.keys(renameMap).length > 0) {
      if (config.rules) {
        config.rules = config.rules.map(rule => {
          let newRule = rule;
          for (const [oldName, newName] of Object.entries(renameMap)) {
            if (newRule.endsWith("," + oldName)) {
              newRule = newRule.slice(0, -(oldName.length)) + newName;
            } else {
              newRule = newRule.replace("," + oldName + ",", "," + newName + ",");
            }
          }
          return newRule;
        });
      }

      config["proxy-groups"].forEach(group => {
        if (group.proxies) {
          group.proxies = group.proxies.map(p => renameMap[p] || p);
        }
      });

      if (config["rule-providers"]) {
        Object.keys(config["rule-providers"]).forEach(key => {
          const provider = config["rule-providers"][key];
          if (provider.proxy && renameMap[provider.proxy]) {
            provider.proxy = renameMap[provider.proxy];
          }
        });
      }
    }
  }

  // =========================================================================
  // --- 9. TUN 模式与严格路由防漏 ---
  // =========================================================================

  if (USER_CONFIG.overwriteTun) {
    config["ipv6"] = USER_CONFIG.enableIPv6;
    config["tun"] = { 
      ...(config.tun || {}), 
      stack: "system", device: "Mihomo", "auto-route": true, "strict-route": true, 
      "auto-detect-interface": true, "route-exclude-address": ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"] 
    };
  }

  // =========================================================================
  // --- 10. Fake-IP 与纯净 DNS 体系 ---
  // =========================================================================

  if (USER_CONFIG.overwriteDns) {
    config["dns"] = {
      enable: true, listen: "0.0.0.0:1053", ipv6: USER_CONFIG.enableIPv6, 
      "enhanced-mode": "fake-ip", "fake-ip-range": "198.18.0.1/16", "fake-ip-filter-mode": "blacklist", 
      "respect-rules": true, "use-hosts": true, "use-system-hosts": false,
      "fake-ip-filter": ["*.lan", "*.local", "*.arpa", "time.*.com", "ntp.*.com", "localhost.ptlogin2.qq.com", "*.msftncsi.com", "www.msftconnecttest.com", "ipv6.msftncsi.com", "*.ipv6-literal.net", "google.cn", "*.music.163.com", "*.music.126.net"],
      "default-nameserver": ["223.5.5.5", "119.29.29.29"], 
      "direct-nameserver": ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"], "direct-nameserver-follow-policy": true,
      "proxy-server-nameserver": ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"], 
      "nameserver": ["https://8.8.8.8/dns-query", "https://1.1.1.1/dns-query"],
      "nameserver-policy": { "rule-set:cn-domain": ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"] }
    };
  }

  // =========================================================================
  // --- 11. Sniffer 深度包检测 ---
  // =========================================================================

  if (USER_CONFIG.overwriteSniffer) {
    config["sniffer"] = { 
      enable: true, "force-dns-mapping": true, "parse-pure-ip": true, "override-destination": true, 
      sniff: { TLS: { ports: [443, 8443] }, HTTP: { ports: [80, "8080-8880"], "override-destination": true } } 
    };
  }

  // =========================================================================
  // --- 12. ⚙️ 内核核心优化与状态持久化 ---
  // =========================================================================

  if (USER_CONFIG.enableCoreOptimize) {
    // 1. Profile 记忆模块 (属于 profile 对象)
    config["profile"] = {
      "store-selected": true,                // 记忆用户在 UI 面板选中的节点，重启/重载不丢失
      "store-fake-ip": true                  // 持久化 Fake-IP 缓存，重启不丢失本地 DNS 映射
    };

    // 2. 核心性能与体验优化 (属于根级别 Root 配置)
    config["unified-delay"] = true;                  // 统一延迟：将握手延迟作为整体参考，测速更真实
    config["tcp-concurrent"] = true;                 // TCP 并发连接：大幅提升网页并发加载速度
    config["keep-alive-interval"] = 15;              // TCP 探测间隔，及时剔除死链接
    config["find-process-mode"] = "strict";          // 严格模式匹配进程，防止 Telegram/BT 分流漏网
    config["global-client-fingerprint"] = "chrome";  // 全局客户端 TLS 指纹伪装，降低被阻断概率
  }
  // EOF: May your routing be fast and your connection secure. 🚀
  return config;
}