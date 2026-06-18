// =========================================================================
//  📦 Mihomo-Toolkit | 通用动态策略组脚本 | ALL-IN-ONE | MIT 许可证
// ------------------------------------------------------------------------
// 版本: v2.6.0 (Build 2026.06.18)
// 作者: XiaoM-OVO (Refactored)
// 描述: 专为 Mihomo 内核客户端设计的简易动态路由策略组脚本。
// 功能: 动态清洗 / 智能分流 / 自动容错 / 多场景适配 / 动态图标组装
// =========================================================================
// 💡 【节点清洗图标说明】
// 🤖 : OpenAI / ChatGPT      ♊ : Google Gemini       🦀 : Anthropic Claude
// 📺 : 流媒体访问 (NF/P+)     🎮 : 游戏 / FullCone     ⏬ : 下载 / BT 专用
// 🛡️ : AnyTLS / 安全协议      📱 : WAP 移动优化         🏠 ：住宅IP / 家宽
// 🆓 : 免费 / 公益节点         🗑️ : 清洗失败节点
// 💡 【底层协议图标说明】
// ✈️ : SS/SSR    🦊 : VMess     🛸 : VLESS      🐎 : Trojan
// ⚡ : HY/HY2    💨 : TUIC      🕸️ : WireGuard  🦈 : Snell
// =========================================================================
// 🛠️ 【自定义指南：如何添加自定义的新应用分流？】
// 如果你想新增一个自定义规则（比如 HBO Max），只需在以下 3 个地方“打卡”即可：
//
// 1️⃣ 【建组】搜索 `APP_GROUPS_REGISTRY`，加入策略组清单：
//    { key: "enableHBO", name: "📺 HBO", proxies: [...standardOptions, "DIRECT"] }
//
// 2️⃣ 【引流】搜索 `FEATURE_MAP`，下载规则集并指派路由：
//    { key: "enableHBO", providers: { hbo: "geosite/hbo" }, rules: ["RULE-SET,hbo,📺 HBO"] }
//
// 3️⃣ 【美化】(可选) 搜索 `ICON_MAPPING`，为其配置图标：
//    "📺 HBO": { icon: USER_CONFIG.iconRepoKoolson + "HBO.png", newName: "HBO" }
// =========================================================================
function main(config) {

  // =========================================================================
  // ⚙️ 用户自定义配置区 (开关配置) - true 为开启，false 为关闭
  // =========================================================================
  const USER_CONFIG = {

    // 【1. 基础全局配置】 (基础逻辑与设备环境)
    enableScript: true,          // 🟢 脚本总控：设为 false 则原样输出订阅内容
    osType: "windows",           // 💻 设备类型: "windows", "mac", "linux", "all"
    proxyFirst: true,            // 🧭 路由偏好：true(海外代理优先)，false(国内直连优先)
    defaultProxyMode: "auto",    // 🔀 默认代理策略: auto(自动) / manual(手动) / fallback(故障转移)  [⚠️特殊: direct / reject]
    enableIPv6: false,           // 🌐 全局 IPv6：控制 TUN、DNS 及路由（本地无物理 IPv6 请务必设为 false！）

    // 【2. 节点清洗与处理】 (名字重构与白嫖/低倍率节点过滤)
    enableDedupe: false,         // 🧽 节点去重：开启后自动剔除机场底层完全重复的“注水”节点
    removeInfoNodes: false,      // 🗑️ 纯净节点: 彻底过滤流量/到期时间等营销节点
    keepDestinationCity: true,   // 🏙️ 保留落地城市：开启后将在节点名后缀展示具体城市 (如 东京/大阪/洛杉矶)
    showProtocolIcon: false,     // 🏷️ 协议图标展示: true(在节点名展示🦊/🛸等底层协议图标), false(隐藏协议图标)
    strictRegionMatch: false,    // 🌍 未知地区匹配：true(仅匹配预设字典，其余全扔垃圾桶)，false(宽松模式，允许通过国旗Emoji动态捕获冷门国家放入"其他"组)
    adTextThreshold: 6,          // 🔠 纯文本广告判定阈值：无数字/线路特征且长度大于此值的节点视为广告
    lowMultiThreshold: 0.99,     // ⏬ 自动降级阈值：倍率 <= 此值的节点自动打上下载标签 (设为 0 关闭自动降级)
    isolateDownload: false,      // ⏬ 下载节点隔离：设为 true 从普通大区池中剔除，设为 false 则允许进入普通池

    // 【3. 策略组建组与 UI 面板】 (界面显示与折叠逻辑)
    minorNodeThreshold: 3,       // 📊 小众地区建组阈值：节点数 >= 此值则独立建组，否则折叠至大区组
    regionGroupType: "url-test", // ⚙️ 地区组行为: "url-test", "select", "fallback"
    enableRegionHashLB: false,   // ⚖️ 地区散列: 在达到阈值的地区组增加哈希负载均衡策略组
    hideGarbageGroup: false,     // 🗑️ 隐藏垃圾桶：无论是否有未知识别节点，强制不在面板显示
    groupIconMode: "emoji",      // 🎨 策略组图标: "emoji"(仅保留Emoji), "icon"(仅在线图标), "both"(同时保留)
    iconRepoOrz: "https://fastly.jsdelivr.net/gh/Orz-3/mini@master/Color/",
    iconRepoKoolson: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/",

    // 【4. 核心分流开关】 (日常高频使用的场景)
    enableAdBlock: true,         // 🚫 广告拦截：去除网页及 APP 广告
    enableAI: true,              // 🤖 AI 助手：OpenAI, Gemini, Claude 等
    enableTelegram: true,        // ✈️ 社交通讯：Telegram 独立分流
    enableYouTube: true,         // ▶️ 影音娱乐：YouTube 独立分流
    enableNetflix: true,         // 🎬 影音娱乐：Netflix 独立分流
    enableBilibili: true,        // 📺 影音娱乐：哔哩哔哩港澳台限制解除
    enableGame: true,            // 🎮 游戏平台：Steam, Epic 等
    enableSystemServices: true,  // 🪟 系统服务：Microsoft, Apple, Google 框架服务
    enableDomesticGroup: false,  // 🇨🇳 中国分流：开启后增加专门的"中国"策略组 (配合直连优先使用)

    // 【5. 扩展分流开关】 (特定群体或特殊偏好场景)
    enableAntiAD: false,         // ☢️ 激进广告拦截：启用 anti-AD 规则集 (强力，但容易误杀)
    enableGitHub: true,          // 🐱 开发者选项：GitHub, GitLab 等 
    enableScholar: true,         // 🎓 学术研究：Google Scholar 等
    enableTikTok: false,         // 🎵 TikTok：自动过滤香港节点
    enableSpotify: false,        // 🎧 Spotify：音乐流媒体
    enableDisney: false,         // 🪄 影音娱乐：Disney+ 独立分流
    enableSocial: false,         // 💬 海外社交：Twitter, Meta, Discord 等
    enableCrypto: false,         // 🪙 加密货币：Binance 等交易平台
    enablePayPal: false,         // 💳 金融支付：PayPal 独立分流
    enableResidential: false,    // 🏠 家宽分流：自动提取住宅/ISP节点作为高级备用

    // 【6. 网络测速与规则集配置】
    testURL: "https://cp.cloudflare.com/generate_204", // 🔗 延迟测速地址
    testInterval: 300,           // 🕒 测速间隔: 单位秒
    testTolerance: 50,           // ⚖️ 切换阈值: 延迟差低于此值不频繁切换 IP
    useMRS: true,                // 🚀 极速规则模式: true(MRS格式), false(YAML格式)
    ruleProviderCDN: "https://fastly.jsdelivr.net/gh", // 🔗 规则集 CDN 节点

    // 【7. 安全防漏与底层内核覆写】
    enableProcessDirect: true,   // 🛑 进程直连防漏：强制指定的软件(如P2P/BT等)走直连，防止流量滥用与误代理(关闭后内置BT规则会指向⏬ 下载策略)
    enableQUICReject: false,     // ⚡ 屏蔽 QUIC 协议: 强制降级至 TCP，避免 UDP 阻断丢包
    overwriteTun: true,          // 🖧 覆写 TUN 配置：注入严格路由与网段排除
    overwriteDns: true,          // 📡 覆写 DNS 配置：强制使用 Fake-IP 与纯净防污染 DNS
    overwriteSniffer: true,      // 🔎 覆写 Sniffer 配置：启用深度包检测防 SNI 阻断
    enableCoreOptimize: true     // ⚙️ 覆写核心体验: 开启记忆功能、统一延迟、并发与指纹伪装
  };

  if (!USER_CONFIG.enableScript) return config;

  // =========================================================================
  // 🪛 高级进阶修改区 (硬编码预设)
  // =========================================================================
  // 🤖 AI 服务偏好的落地地区（按质量及解锁概率排序，填入地区 ID）
  const AI_PREFERRED_REGIONS = ["us", "jp", "tw", "sg", "kr", "eu"];

  // 📺 哔哩哔哩 (B站) 港澳台限制解除偏好落地地区
  const BILI_PREFERRED_REGIONS = ["🇹🇼 台湾节点", "🇲🇴 澳门节点", "🇭🇰 香港节点"];

  // 🛑 指定进程强制直连名单 (防漏与自定义绕过)
  const PROCESS_DIRECT_WIN = ["qBittorrent", "Thunder", "BitComet", "uTorrent", "aria2c"]; // Win 强制直连进程
  const PROCESS_DIRECT_MAC = ["Thunder", "BitComet", "uTorrent", "qbittorrent", "aria2c", "transmission-daemon"]; // Mac 强制直连进程
  const PROCESS_DIRECT_LIN = ["qbittorrent", "aria2c", "transmission-daemon"]; // Linux 强制直连进程

  // ⏬ 指定进程强制走下载策略 (多线程 HTTP 下载器等)
  const PROCESS_PROXY_WIN  = ["IDMan", "fdm"]; // Win 强制走 [⏬ 下载策略]
  const PROCESS_PROXY_MAC  = ["fdm"];          // Mac 强制走 [⏬ 下载策略]

  // 📡 覆写使用的默认纯净 DNS (用于防污染及 Fake-IP 解析)
  const CUSTOM_DNS_DEFAULT = ["223.5.5.5", "119.29.29.29"]; // 基础解析 DNS
  const CUSTOM_DNS_DIRECT  = ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"]; // 国内直连 DNS (DoH)
  const CUSTOM_DNS_PROXY   = ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"]; // 代理节点 DNS (DoH)


  // 🧹 常用正则大礼包 
  const REGEX_INFO_NODE = /剩余流量|套餐到期|到期时间|有效时间|过期|更新公告|重置|维护|不可用|扣费|节点说明|防失联|官网|地址|Q群|电报|Tg群|距离下次|测试/i;
  const REGEX_FORBID_DL_STR = "(?:禁止|禁|严禁|请勿|勿|不要|不能|拒绝|屏蔽|防)(?:BT|PT|P2P|下载|测速|迅雷)|(?:仅限|仅供)(?:网页|日常|聊天)|\\b(?:No|Block|Ban)[\\s\\-_]*(?:BT|PT|Torrent|Download)\\b";
  // 清洗冗余说明文字和推广网址
  const REGEX_CLEANUP = new RegExp(`${REGEX_FORBID_DL_STR}|(?:https?:\\/\\/|www\\.)?[a-zA-Z0-9][-a-zA-Z0-9]{1,62}\\.(?:com|net|org|cc|me|vip|pro|top|xyz|club)`, "ig");
  const REGEX_FORBID_DL = new RegExp(REGEX_FORBID_DL_STR, "i"); // 单独用于判定禁止下载
  
  // 识别前置入口城市 (如 深圳->香港)
  const REGEX_ENTRY_CITY = /(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|香港|台湾|日本|韩国|新加坡|美国)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|香港|台湾|日本|韩国|新加坡|美国)/;
  // 识别节点倍率 (如 x0.5, 1.5x, 倍率: 2.0)
  const REGEX_MULTI      = /(?<![a-zA-Z])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍率)?|(\d+(?:\.\d+)?)\s*(?:[xX×]|倍率)(?!\s*\d))/i;
  // 识别线路类型 (如 IEPL, BGP, CN2)
  const REGEX_TECH_LINE = /(IEPL|IPLC|BGP|CN2|GIA|CMI|CMIN2|CUG|PCCW|9929|4837|AWS|GCP|Oracle|Azure|Hinet|Zenlayer|三网|电联|移联|电移|移动|联通|电信|CTCUCM|CTCUM|CTCU|CUCT|CMCU|CUCM|CTCM|CMCT)/gi;
  // 识别营销标识
  const REGEX_FLUFF_LINE = /(专线|高速|极速|优化|起飞|VIP|Premium|Pro|Plus|标准|基础|高级|节点)/gi;
  // 识别抽象黑话
  const LINE_MAP = { "CTCUCM": "三网", "CTCUM": "三网","CTCU": "电联", "CUCT": "电联","CMCU": "移联", "CUCM": "移联","CTCM": "电移", "CMCT": "电移"};
  // 识别未知国家的 emoji 国旗
  const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;
  const REGEX_ALL_FLAGS  = /\p{Regional_Indicator}{2}/gu;

  // =========================================================================
  // --- 1. 物理节点去重逻辑 (基于 Server + Port + Type) ---
  // =========================================================================
  let proxies = [];
  let builtInProxies = [];
  const proxySet = new Set();
  const BASIC_PROXIES = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS']);

  (config.proxies || []).forEach(proxy => {
    // 放行内置节点
    if (BASIC_PROXIES.has(proxy.name)) {
      builtInProxies.push(proxy);
      return;
    }
    // 放行没有 server 字段的通知节点
    if (!proxy.server || REGEX_INFO_NODE.test(proxy.name)) {
      proxies.push(proxy);
      return;
    }
    
    if (USER_CONFIG.enableDedupe) {
      // 组合唯一键值防误杀
      const sni = proxy.sni || "";
      const network = proxy.network || "";
      const host = proxy.host || proxy["ws-opts"]?.headers?.Host || proxy["ws-opts"]?.headers?.host || "";
      const path = proxy["ws-opts"]?.path || proxy["grpc-opts"]?.["grpc-service-name"] || "";
      const uuid = (proxy.uuid || proxy.password || "").toLowerCase();

      const key = `${proxy.server}:${proxy.port}:${proxy.type}:${network}:${sni}:${host}:${path}:${uuid}`;
      
      if (!proxySet.has(key)) {
        proxySet.add(key);
        proxies.push(proxy);
      }
    } else {
      proxies.push(proxy);
    }
  });

  // =========================================================================
  // --- 2. 常量与字典预定义 ---
  // =========================================================================
  // 📍 前置入口城市前缀
  const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信|香港|台湾|日本|韩国|新加坡|美国)";
  const TAG_MAP   = { "深圳":"深", "广州":"广", "上海":"沪", "北京":"京", "杭州":"杭", "四川":"川", "江苏":"苏", "宁波":"甬", "东莞":"莞", "香港":"港", "台湾":"台", "日本":"日", "韩国":"韩", "新加坡":"新", "美国":"美" };

  // 💻 操作系统类型判定
  const OS = (USER_CONFIG.osType || "windows").toLowerCase();
  const IS_WIN = OS === "windows" || OS === "all";
  const IS_MAC = OS === "mac"     || OS === "all";
  const IS_LIN = OS === "linux"   || OS === "all";

  // 🌍 地区识别字典
  const REGION_DEFS = [
    { id: "cn", name: "中国",   icon: "🇨🇳", city: "深圳|广州|上海|北京|杭州|成都|武汉|南京", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(CN|PRC)(?![a-zA-Z])|China|(?:美|日|韩|港|台|新|英|澳)[^\s]*?(?:-|->|至|=>)?\s*(?:国内|落地)(?!入口|中转|BGP|线路|港|台|日|韩|新|美|英|德|法|澳)/i },
    { id: "hk", name: "香港",   icon: "🇭🇰", reg: new RegExp(`${IN_PREFIX}港|香港|香江|(?<![a-zA-Z])(?:HK|HKT|HKBN|HGC|WTT|PCCW)(?![a-zA-Z])|Hong Kong`, "i") },
    { id: "mo", name: "澳门",   icon: "🇲🇴", reg: /澳门|澳門|Macau|Macao|(?<![a-zA-Z])CTM(?![a-zA-Z])/i },
    { id: "tw", name: "台湾",   icon: "🇹🇼", city: "台北|新北|台中|高雄|彰化", reg: new RegExp(`${IN_PREFIX}台|台湾|台灣|(?<![a-zA-Z])(?:TW|APTG)(?![a-zA-Z])|Taiwan|Hinet|Kbro|Seednet`, "i") },
  
    // --- 亚洲核心区 ---
    { id: "jp", name: "日本",   icon: "🇯🇵", city: "东京|大阪|埼玉|京都|川崎", reg: new RegExp(`${IN_PREFIX}日|日本|(?<![a-zA-Z])(?:JP|OCN)(?![a-zA-Z])|Japan|Nuro|Plala`, "i") },
    { id: "kr", name: "韩国",   icon: "🇰🇷", city: "首尔|春川", reg: new RegExp(`${IN_PREFIX}韩|韩国|(?<![a-zA-Z])KR(?![a-zA-Z])|Korea`, "i") },
    { id: "sg", name: "新加坡", icon: "🇸🇬", city: "狮城", reg: new RegExp(`${IN_PREFIX}新|新加坡|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore|Singtel|StarHub|MyRepublic|ViewQwest`, "i") },
    
    // --- 北美大区 ---
    { id: "us", name: "美国",   icon: "🇺🇸", city: "洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|亚特兰大|凤凰城|硅谷|纽约|迈阿密|华盛顿", reg: new RegExp(`${IN_PREFIX}美|美国|西美|(?<![a-zA-Z])(?:US|LAX)(?![a-zA-Z])|Los Angeles|America`, "i") },
    
    // --- 欧洲大区 ---
    { group: "eu", name: "英国",   icon: "🇬🇧", city: "伦敦", reg: /英国|(?<![a-zA-Z])UK(?![a-zA-Z])|United Kingdom|Britain/i },
    { group: "eu", name: "德国",   icon: "🇩🇪", city: "法兰克福", reg: /德国|(?<![a-zA-Z])DE(?![a-zA-Z])|Germany/i },
    { group: "eu", name: "法国",   icon: "🇫🇷", city: "巴黎", reg: /法国|(?<![a-zA-Z])FR(?![a-zA-Z])|France/i },
    { group: "eu", name: "俄罗斯", icon: "🇷🇺", city: "莫斯科|伯力|圣彼得堡|新西伯利亚", reg: /俄罗斯|(?<![a-zA-Z])RU(?![a-zA-Z])|Russia/i },
    { group: "eu", name: "乌克兰", icon: "🇺🇦", city: "基辅", reg: /乌克兰|(?<![a-zA-Z])UA(?![a-zA-Z])|Ukraine/i },
    { group: "eu", name: "西班牙", icon: "🇪🇸", city: "马德里", reg: /西班牙|(?<![a-zA-Z])ES(?![a-zA-Z])|Spain/i },
    { group: "eu", name: "荷兰",   icon: "🇳🇱", city: "阿姆斯特丹", reg: /荷兰|(?<![a-zA-Z])NL(?![a-zA-Z])|Netherlands/i },
    { group: "eu", name: "瑞士",   icon: "🇨🇭", city: "苏黎世|日内瓦", reg: /瑞士|(?<![a-zA-Z])CH(?![a-zA-Z])|Switzerland/i },
    { group: "eu", name: "意大利", icon: "🇮🇹", city: "米兰|罗马", reg: /意大利|(?<![a-zA-Z])IT(?![a-zA-Z])|Italy/i },
    { group: "eu", name: "瑞典",   icon: "🇸🇪", city: "斯德哥尔摩", reg: /瑞典|(?<![a-zA-Z])SE(?![a-zA-Z])|Sweden/i },
    { group: "eu", name: "爱尔兰", icon: "🇮🇪", city: "都柏林", reg: /爱尔兰|(?<![a-zA-Z])IE(?![a-zA-Z])|Ireland/i },
    { group: "eu", name: "波兰",   icon: "🇵🇱", city: "华沙", reg: /波兰|(?<![a-zA-Z])PL(?![a-zA-Z])|Poland/i },
    { group: "eu", name: "芬兰",   icon: "🇫🇮", city: "赫尔辛基", reg: /芬兰|(?<![a-zA-Z])FI(?![a-zA-Z])|Finland/i },

    // --- 南亚大区 ---
    { group: "sa", name: "印度",     icon: "🇮🇳", city: "孟买|新德里", reg: /印度|(?<![a-zA-Z])IN(?![a-zA-Z])|India/i },
        
    // --- 东南亚大区 ---
    { group: "sea", name: "马来西亚", icon: "🇲🇾", city: "吉隆坡", reg: /马来|马来西亚|(?<![a-zA-Z])MY(?![a-zA-Z])|Malaysia/i },
    { group: "sea", name: "泰国",     icon: "🇹🇭", city: "曼谷", reg: /泰国|(?<![a-zA-Z])TH(?![a-zA-Z])|Thailand/i },
    { group: "sea", name: "印尼",     icon: "🇮🇩", city: "雅加达", reg: /印尼|印度尼西亚|(?<![a-zA-Z])ID(?![a-zA-Z])|Indonesia/i },
    { group: "sea", name: "菲律宾",   icon: "🇵🇭", city: "马尼拉", reg: /菲律宾|(?<![a-zA-Z])PH(?![a-zA-Z])|Philippines/i },
    { group: "sea", name: "越南",     icon: "🇻🇳", city: "胡志明|河内", reg: /越南|(?<![a-zA-Z])VN(?![a-zA-Z])|Vietnam/i },
    
    // --- 美洲大区 --
    { group: "am", name: "加拿大", icon: "🇨🇦", city: "多伦多|温哥华|蒙特利尔", reg: /加拿大|(?<![a-zA-Z])CA(?![a-zA-Z])|Canada/i },
    { group: "am", name: "阿根廷", icon: "🇦🇷", city: "布宜诺斯艾利斯", reg: /阿根廷|(?<![a-zA-Z])AR(?![a-zA-Z])|Argentina/i },
    { group: "am", name: "巴西",   icon: "🇧🇷", city: "圣保罗", reg: /巴西|(?<![a-zA-Z])BR(?![a-zA-Z])|Brazil/i },
    { group: "am", name: "墨西哥", icon: "🇲🇽", reg: /墨西哥|(?<![a-zA-Z])MX(?![a-zA-Z])|Mexico/i },
    { group: "am", name: "智利",   icon: "🇨🇱", reg: /智利|(?<![a-zA-Z])CL(?![a-zA-Z])|Chile/i },

    // --- 中东大区 ---
    { group: "me", name: "阿联酋",   icon: "🇦🇪", city: "迪拜", reg: /阿联酋|迪拜|(?<![a-zA-Z])(?:AE|UAE)(?![a-zA-Z])/i },
    { group: "me", name: "土耳其",   icon: "🇹🇷", city: "伊斯坦布尔", reg: /土耳其|(?<![a-zA-Z])TR(?![a-zA-Z])|Turkey/i },
    { group: "me", name: "沙特",     icon: "🇸🇦", city: "利雅得|吉达", reg: /沙特|阿拉伯|(?<![a-zA-Z])SA(?![a-zA-Z])|Saudi/i },
    { group: "me", name: "以色列",   icon: "🇮🇱", city: "特拉维夫", reg: /以色列|(?<![a-zA-Z])IL(?![a-zA-Z])|Israel/i },

    // --- 非洲大区 ---
    { group: "af", name: "南非",     icon: "🇿🇦", city: "约翰内斯堡", reg: /南非|(?<![a-zA-Z])ZA(?![a-zA-Z])|South Africa/i },
    { group: "af", name: "尼日利亚", icon: "🇳🇬", reg: /尼日利亚|(?<![a-zA-Z])NG(?![a-zA-Z])|Nigeria/i },
    { group: "af", name: "埃及",     icon: "🇪🇬", city: "开罗", reg: /埃及|(?<![a-zA-Z])EG(?![a-zA-Z])|Egypt/i },
    
    // --- 其他零散地区 ---
    { name: "澳大利亚", icon: "🇦🇺", city: "悉尼|墨尔本", reg: /澳大利亚|澳洲|(?<![a-zA-Z])AU(?![a-zA-Z])|Australia|Sydney/i },
  ];

  // 🩲UI 图标映射字典
  const UI_ICONS = {
    protocols: {
      "ss": "🛩️", "ssr": "🚀", "vmess": "🦊", "vless": "🛸",
      "trojan": "🐴", "hysteria": "⚡", "hysteria2": "⚡",
      "tuic": "💨", "wireguard": "🕸️", "snell": "📡", "http": "🌐", "https": "🔒"
    },
    features: {
      "chatgpt": "🤖", "gemini": "♊", "claude": "🦀", "residential": "🏠", 
      "game": "🎮", "streaming": "📺", "download": "⏬", "free": "🆓", 
      "wap": "📱", "anytls": "🛡️"
    }
  };

  // 🏷️ 节点特征识别字典
  const FEATURE_RULES = [
    { reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i, tag: "chatgpt", pool: "chatgpt" },
    { reg: /\bGemini\b/i,                 tag: "gemini",  pool: "gemini" },
    { reg: /\bClaude\b/i,                 tag: "claude",  pool: "claude" },
    { reg: /(?:家宽|住宅|宽带|原生|Residential|ISP|Home|HKT|HKBN|HGC|WTT|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|So[-_]?net|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)/i, tag: "residential", pool: "residential" },
    { reg: /(?:游戏)|\b(?:Game|FullCone)\b/i,                      tag: "game", pool: "game" },
    { reg: /(?:流媒体|解锁)|\b(?:Netflix|NF|Disney\+|YouTube)\b/i, tag: "streaming" },
    { reg: /(?:下载)|\bBT\b/i,                                     tag: "download" },
    { reg: /(?:免费|白嫖|公益)/i,                                   tag: "free" },
    { reg: /\bWAP\b/i,                                             tag: "wap" },
    { reg: /-A$|\bAnyTLS\b/i,                                      tag: "anytls" }
  ];

  // =========================================================================
  // --- 3. 节点双重遍历：清洗、计数与分发入桶 ---
  // =========================================================================
  // 🪣 预设分发桶 (用于把清洗后的节点按特征分类存放)
  const BUCKETS = { garbage: [], download: [], info: [], allStandard: [], other: [], eu: [], sea: [], am: [], sa: [], me: [], af: [] };
  // 🧠 动态提取所有混合大区的 ID（如 "eu", "sea", "am"）并加入兜底的 "other"
  const MIXED_REGION_IDS = [...new Set(REGION_DEFS.map(r => r.group).filter(Boolean)), "other"];
  
  // 根据大区字典和特性字典动态创建桶
  REGION_DEFS.forEach(r => BUCKETS[r.id || r.name] = []);
  FEATURE_RULES.filter(r => r.pool).forEach(r => BUCKETS[r.pool] = []);
  
  // 🏷️ 预编译清洗正则 (极其关键：供后续的纯函数匹配和擦除使用)
  REGION_DEFS.forEach(r => {
    const combinedSource = r.city ? `${r.reg.source}|${r.city}` : r.reg.source;
    r._cleanReg = new RegExp(combinedSource, "ig"); // 用于最后擦除名字
    r._matchReg = new RegExp(combinedSource, "i");  // 用于判定节点归属
    r._cityReg  = r.city ? new RegExp(r.city, "i") : null; 
  });
  FEATURE_RULES.forEach(r => r._cleanReg = new RegExp(r.reg.source, "ig")); 

  // 辅助纯函数 1: 基础字符清洗 (保持字符串干净)
  function sanitizeNodeName(rawName) {
    let name = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, ""); // 去除零宽字符
    name = name.replace(/\p{Extended_Pictographic}/gu, m => {
      const cp = m.codePointAt(0);
      return (cp >= 0x1F1E6 && cp <= 0x1F1FF) ? m : ""; // 仅保留国旗 Emoji
    });
    name = name.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, ""); // 去除中文间空格
    name = name.replace(/[\u2190-\u21FF\u2460-\u24FF\u2500-\u27BF\u2B00-\u2BFF]/g, " "); // 去除特殊装饰符
    return name.replace(REGEX_CLEANUP, "").trim();
  }

  // 辅助纯函数 2: 提取节点属性 (倍率、线路、入口)，返回结果对象与擦除后的 name
  function extractNodeAttributes(name) {
    let attrs = { multiNum: 1.0, multiStr: "", entryStr: "", lineArr: [], isLowMulti: false };

    // 1. 提取入口城市
    const entryMatch = name.match(REGEX_ENTRY_CITY);
    if (entryMatch) {
      attrs.entryStr = TAG_MAP[entryMatch[1]] || entryMatch[1];
    }

    // 2. 提取并擦除倍率
    let cleanName = name.replace(REGEX_MULTI, (m, m1, m2, m3) => {
      const num = parseFloat(m1 || m2 || m3);
      if (!isNaN(num)) {
        attrs.multiNum = num;
        attrs.multiStr = `x${num}`;
        if (USER_CONFIG.lowMultiThreshold > 0 && num <= USER_CONFIG.lowMultiThreshold) attrs.isLowMulti = true;
      }
      return "";
    });

    // 3. 提取三大运营商合并 (三网)
    if (cleanName.includes("移动") && cleanName.includes("电信") && cleanName.includes("联通")) {
      cleanName = cleanName.replace(/移动|电信|联通/g, "");
      attrs.lineArr.push("三网");
    }

    // 4. 提取线路类型并保留到后缀数组
    cleanName = cleanName.replace(REGEX_TECH_LINE, match => {
      let key = match.toUpperCase();
      attrs.lineArr.push(LINE_MAP[key] || (match.length > 2 ? key : match));
      return "";
    });

    // 5. 提取营销标识
    let fluffStr = "";
    cleanName = cleanName.replace(REGEX_FLUFF_LINE, match => {
      fluffStr += match.toUpperCase();
      return "";
    });

    // 6. 计算线路排序权重和最终后缀文本
    const fullLineStr = attrs.lineArr.join("/") + fluffStr;
    attrs.bestLineWeight = /(IEPL|IPLC|专线|VIP|PRO)/.test(fullLineStr) ? 1 :
                           /(GIA|CN2|9929|CMIN2)/.test(fullLineStr) ? 2 :
                           /(高速|极速|优化|PREMIUM)/.test(fullLineStr) ? 3 :
                           /(BGP|CMI)/.test(fullLineStr) ? 4 :
                           /(中转|隧道)/.test(fullLineStr) ? 5 : 6;

    // 最终展示的后缀，只有干净的技术词
    attrs.cleanLines = [...new Set(attrs.lineArr)].join("/");

    return { attrs, cleanName }; // 必须 return！
  }

  // 辅助纯函数 3: 智能地区匹配
  function matchNodeRegion(name) {
    const matchedRegions = REGION_DEFS.map(r => {
      const m = name.match(r._matchReg);
      return m ? { def: r, len: m[0].length, index: m.index } : null;
    }).filter(Boolean);

    if (matchedRegions.length > 0) {
      // 优先匹配长度最长的，长度相同匹配最靠后的(比如深港，以港为准)
    const bestMatch = matchedRegions.reduce((prev, curr) => {
      if (curr.len !== prev.len) return curr.len > prev.len ? curr : prev;
      return curr.index > prev.index ? curr : prev; 
    }, matchedRegions[0]);
    return bestMatch?.def || null;
    }
    
    if (!USER_CONFIG.strictRegionMatch) {
      const flagMatch = name.match(REGEX_UNKNOWN_FLAG);
      if (flagMatch) return { id: "other", icon: flagMatch[1], name: flagMatch[2].trim() };
    }
    return null;
  }

  // 🔄 核心：第一轮遍历（逻辑现在变得极其清晰）
  const processedData = proxies.map(proxy => {
    const rawName = proxy.name;

    // --- 步骤 1: 垃圾/广告/内置节点前置拦截 ---
    const isFakeServer = /^(127\.|0\.|1\.1\.1\.1|8\.8\.8\.8|10\.|192\.168\.)/.test(proxy.server || "") || proxy.port === 0;
    const isDummyAuth = /^(0{8}-0{4}-0{4}-0{4}-0{12}|123456|password|dummy)$/i.test(proxy.uuid || proxy.password || "");
    const isAdTypo = /防.{0,3}失|失.{0,3}联|地.{0,3}[址止]|官.{0,3}[网罔]|发.{0,3}[布步]|交.{0,3}流|群.{0,3}组|客.{0,3}服|定.{0,3}制/i.test(rawName);
    
    let tempName = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, "");
    const isOrphanAd = !(/\d/.test(tempName) || REGEX_TECH_LINE.test(tempName) || REGEX_FLUFF_LINE.test(tempName)) && 
                      tempName.replace(/\p{Extended_Pictographic}/gu, "").trim().length > USER_CONFIG.adTextThreshold;

    if (isFakeServer || isDummyAuth || isAdTypo || isOrphanAd || REGEX_INFO_NODE.test(tempName)) {
      if (USER_CONFIG.removeInfoNodes) return { skip: true };
      proxy.server = "127.0.0.1"; proxy.port = 80;
      return { isInfo: true, proxy, rawName };
    }

    // --- 步骤 2: 名字基础清洗 ---
    let name = sanitizeNodeName(rawName);
    const isForbidDownload = REGEX_FORBID_DL.test(rawName);

    // --- 步骤 3: 提取倍率、入口、线路等属性 ---
    const { attrs, cleanName } = extractNodeAttributes(name);
    name = cleanName;

    // --- 步骤 4: 地区匹配与落地城市提取 ---
    const regionInfo = matchNodeRegion(name);
    let destCityStr = "";
    if (USER_CONFIG.keepDestinationCity && regionInfo && regionInfo.city) {
      const cityMatch = rawName.match(regionInfo._cityReg); 
      if (cityMatch) destCityStr = cityMatch[0];
    }

    let tags = new Set(), featurePools = [];
    if (regionInfo) {
      FEATURE_RULES.forEach(rule => {
        if (rule.reg.test(name)) {
          tags.add(rule.tag);
          if (rule.pool) featurePools.push(rule.pool);
          name = name.replace(rule._cleanReg, ""); // 匹配后擦除字符
        }
      });

      // 自动降级逻辑 (只判断 tag)
      if (attrs.isLowMulti && !isForbidDownload && !tags.has("download")) {
        tags.add("download");
      }

      // 擦除地名文字，极致瘦身
      if (regionInfo.id !== "other") {
        name = name.replace(REGEX_ALL_FLAGS, "").replace(regionInfo._cleanReg, "");
      } else {
        name = name.replace(REGEX_ALL_FLAGS, "").replace(regionInfo.name, "");
      }
    }

    name = name.replace(/[\[\]{}()<>（）【】]/g, "").replace(/\b\d{1,3}\b/g, "").replace(/[-_\|\s]+/g, " ").trim() || "其他";
    
    // --- 步骤 6: 组装传递给第二轮的数据结构 ---
    const suffixArr = [attrs.entryStr, destCityStr, attrs.cleanLines, attrs.multiStr].filter(Boolean);
    const pType = (proxy.type || "").toLowerCase();
    
    return { 
      proxy, rawName, regionInfo, tags: Array.from(tags), featurePools, suffixArr, pType, // 这里的 icons 换成了 tags
      groupKey: regionInfo ? regionInfo.name : name,
      multiNum: attrs.multiNum, 
      bestLineWeight: attrs.bestLineWeight, 
      cleanLines: attrs.cleanLines, 
      entryStr: attrs.entryStr
    };
  }).filter(d => d && !d.skip);

  // 生成地区排序权重字典
  const REGION_ORDER = {};
  REGION_DEFS.forEach((r, index) => { REGION_ORDER[r.name] = index; });

  // 🧹 多维排序逻辑
  processedData.sort((a, b) => {
    const orderA = REGION_ORDER[a.groupKey] ?? 999;
    const orderB = REGION_ORDER[b.groupKey] ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    if (a.bestLineWeight !== b.bestLineWeight) return a.bestLineWeight - b.bestLineWeight;
    const entryA = a.entryStr || "ZZZ", entryB = b.entryStr || "ZZZ";
    if (entryA !== entryB) return entryA.localeCompare(entryB, 'zh-CN');
    const lineA = a.cleanLines || "ZZZ", lineB = b.cleanLines || "ZZZ";
    if (lineA !== lineB) return lineA.localeCompare(lineB, 'zh-CN');
    if (a.multiNum !== b.multiNum) return a.multiNum - b.multiNum; 
    return (a.rawName || '').localeCompare(b.rawName || '', 'zh-CN');
  });

  const counts = {}, groupTrack = {};
  processedData.forEach(d => { if (!d.isInfo) counts[d.groupKey] = (counts[d.groupKey] || 0) + 1; });

  // 🔄 第二轮遍历：执行重命名，并把节点扔进对应的桶里
  processedData.forEach(item => {
    if (item.isInfo) { BUCKETS.info.push(item.proxy.name); return; }

    const { proxy, regionInfo, groupKey, rawName, tags, featurePools, suffixArr, pType } = item;
    groupTrack[groupKey] = (groupTrack[groupKey] || 0) + 1;

    // 🧱 1. 身份块：[国旗] [名字] [编号]
    const numStr = counts[groupKey] > 1 ? ` [${groupTrack[groupKey].toString().padStart(2, "0")}]` : "";
    let finalName = regionInfo ? `${regionInfo.icon} ${regionInfo.name}${numStr}` : `🗑️ ${rawName}${numStr}`;

    if (regionInfo) {
      // 🧱 2. 能力块：基于解耦映射表的 UI 渲染
      let combinedIcons = "";
      
      // 协议图标
      if (USER_CONFIG.showProtocolIcon && UI_ICONS.protocols[pType]) {
        combinedIcons += UI_ICONS.protocols[pType];
      }
      
      // 遍历收集到的特征标签进行图标渲染
      tags.forEach(tag => {
        if (UI_ICONS.features[tag]) {
          combinedIcons += UI_ICONS.features[tag];
        }
      });

      if (combinedIcons) {
        finalName += `${combinedIcons}`;
      }

      // 🧱 3. 链路质量块
      if (suffixArr.length) {
        finalName += ` | ${suffixArr.join(" ")}`; 
      }
    }
    
    // 赋值最终格式化的名字
    proxy.name = finalName;

    if (!regionInfo) {
      BUCKETS.garbage.push(finalName);
    } else {
      // 核心分发逻辑也改为判断 tags
      if (tags.includes("download")) BUCKETS.download.push(finalName);
      if (USER_CONFIG.isolateDownload && tags.includes("download")) return; 
      
      if (USER_CONFIG.enableResidential && tags.includes("residential")) {
        featurePools.forEach(p => BUCKETS[p].push(finalName));
      } else {
        BUCKETS.allStandard.push(finalName);
        featurePools.forEach(p => BUCKETS[p].push(finalName));
        BUCKETS[regionInfo.id || regionInfo.name].push(finalName);
      }
    }
  });

  // 拼接内置节点与处理后的节点
  config.proxies = builtInProxies.concat(processedData.map(d => d.proxy));

  // =========================================================================
  // --- 4. 动态可用策略组构建 ---
  // =========================================================================
  const REGION_NAMES = {
    cn: "🇨🇳 大陆节点", hk: "🇭🇰 香港节点", tw: "🇹🇼 台湾节点", jp: "🇯🇵 日本节点",
    kr: "🇰🇷 韩国节点", sg: "🇸🇬 新加坡节点", us: "🇺🇸 美国节点"
  };

  // 🧹 处理小众节点：如果不够阈值，折叠到大区
  REGION_DEFS.forEach(r => {
    const key = r.id || r.name;
    if (REGION_NAMES[key]) return;
    const nodes = BUCKETS[key];
    if (nodes && nodes.length > 0) {
      if (nodes.length >= USER_CONFIG.minorNodeThreshold) REGION_NAMES[key] = `${r.icon} ${r.name}节点`; 
      else { BUCKETS[r.group || "other"].push(...nodes); BUCKETS[key] = []; }
    }
  });
  
  // 处理大折叠区：不够阈值的最终流放到 BUCKETS.other
  [
    { id: "eu",  icon: "🇪🇺", name: "欧洲" },   // 👑 高频大区：英/德/法/俄 等
    { id: "sea", icon: "🏝️", name: "东南亚" }, // 👑 高频大区：马/泰/印尼/越/菲 等
    { id: "am",  icon: "🌵", name: "美洲" },   // 🌎 次高频：加/巴/阿/智 等
    { id: "sa",  icon: "🍛", name: "南亚" },   // 🍛 较冷门：印度/巴基斯坦 等
    { id: "me",  icon: "🐪", name: "中东" },   // 🐪 冷门区：阿联酋/沙特/以色列 等
    { id: "af",  icon: "🦁", name: "非洲" }    // 🦁 极冷区：南非/尼日利亚/埃及 等
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
  const resiPrefix = (USER_CONFIG.enableResidential && BUCKETS.residential.length) ? ["🏠 家宽专用"] : [];
  
  // 核心的公共代理选项预置
  const MODE_MAP = { "auto": "🚀 自动选择", "manual": "📍 手动选择", "fallback": "♻️ 故障转移", "direct": "DIRECT", "reject": "REJECT" };
  const proxyTarget = MODE_MAP[USER_CONFIG.defaultProxyMode] || "🚀 自动选择";
  const baseOptions = ["📍 手动选择", "🚀 自动选择", "♻️ 故障转移", ...resiPrefix, ...activeRegionGroups];
  const standardOptions = [...new Set([proxyTarget, ...baseOptions])]; 
  const coreSelectProxies = ["🚀 自动选择", "♻️ 故障转移", ...resiPrefix, ...activeRegionGroups, "DIRECT", ...BUCKETS.info];

  // =========================================================================
  // --- 5. 组装 Proxy-Groups ---
  // =========================================================================
  const buildSelect = (name, proxies, hidden = false) => ({ name, type: "select", proxies: [...new Set(proxies)], hidden });
  const buildRegionGroup = (id, name, proxies, hidden = false) => {
    let { regionGroupType: type, testURL: url, testInterval: interval, testTolerance: tolerance } = USER_CONFIG;
    if (MIXED_REGION_IDS.includes(id)) type = "select"; 
    const base = { name, type, proxies: [...new Set(proxies)], hidden };
    if (type !== "select") Object.assign(base, { url, interval, lazy: true, ...(type === "url-test" && { tolerance }) });
    return base;
  };

  const appGroups = [];
  const { testURL, testInterval, testTolerance } = USER_CONFIG;

  // 📋 各大 App 的分流策略配置注册表
  const APP_GROUPS_REGISTRY = [
    { key: "enableScholar", name: "🎓 学术网站", proxies: ["🇺🇸 美国节点", "🇪🇺 欧洲节点", "🇯🇵 日本节点", "🇸🇬 新加坡节点", "🇹🇼 台湾节点", "🇭🇰 香港节点", proxyTarget, "DIRECT"] },
    { key: "enableCrypto",  name: "🪙 加密货币", proxies: ["🇹🇼 台湾节点", "🇯🇵 日本节点", "🇪🇺 欧洲节点", ...resiPrefix, proxyTarget, "DIRECT"] },
    { key: "enablePayPal",  name: "💳 PayPal",  proxies: ["DIRECT", proxyTarget, ...activeRegionGroups, ...resiPrefix] },
    { key: "enableGame",    name: "🎮 游戏服务", proxies: ["DIRECT", ...standardOptions, ...BUCKETS.game] },
    { key: "enableTikTok",  name: "🎵 TikTok",  proxies: [...activeRegionGroups.filter(g => !["🇭🇰 香港节点", "🇨🇳 大陆节点", "🗑️ 未知识别"].includes(g)), proxyTarget, "DIRECT"] },
    { key: "enableSocial",  name: "💬 社交平台", proxies: [...standardOptions, "DIRECT"] },
    { key: "enableYouTube", name: "▶️ YouTube", proxies: [...standardOptions, "DIRECT"] },
    { key: "enableNetflix", name: "🎬 Netflix", proxies: [...standardOptions, "DIRECT"] },
    { key: "enableDisney",  name: "🪄 Disney+", proxies: [...standardOptions, "DIRECT"] },
    { key: "enableGitHub",  name: "🐱 GitHub",  proxies: [...standardOptions, "DIRECT"] },
    { key: "enableTelegram",name: "✈️ Telegram",proxies: [...standardOptions, "DIRECT"] },
    { key: "enableSpotify", name: "🎧 Spotify", proxies: [...standardOptions, "DIRECT"] },
  ];

  // AI 节点独立判定处理
  if (USER_CONFIG.enableAI) {
    const aiCore = AI_PREFERRED_REGIONS.map(id => REGION_NAMES[id]); 
    ["chatgpt", "gemini", "claude"].forEach((key, i) => {
      const names = ["🤖 ChatGPT", "♊ Gemini", "🦀 Claude"];
      const show = aiCore.some(g => activeRegionGroups.includes(g)) || BUCKETS[key].length > 0;
      appGroups.push(buildSelect(names[i], [...resiPrefix, ...aiCore, ...BUCKETS[key], proxyTarget, "DIRECT"], !show));
    });
  }

  // 哔哩哔哩特殊处理
  if (USER_CONFIG.enableBilibili) {
    const biliProxies = USER_CONFIG.enableDomesticGroup ? ["🇨🇳 中国分流", ...BILI_PREFERRED_REGIONS, "DIRECT"] : ["DIRECT", ...BILI_PREFERRED_REGIONS];
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
  APP_GROUPS_REGISTRY.forEach(({ key, name, proxies }) => {
    if (USER_CONFIG[key]) appGroups.push(buildSelect(name, proxies, !hasGlobalProxy));
  });

  if (USER_CONFIG.enableAdBlock || USER_CONFIG.enableAntiAD) {
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
  
  // 下载组强制装载
  finalGroups.push(buildSelect("⏬ 下载策略", ["DIRECT", "🔄 负载均衡-轮询", "🚀 自动选择", ...BUCKETS.download]));
  finalGroups.push({ name: "🔄 负载均衡-轮询", type: "load-balance", strategy: "round-robin", url: testURL, interval: 300, lazy: true, proxies: BUCKETS.download, hidden: true });

  if (USER_CONFIG.enableDomesticGroup) {
    const cnCore = ["🇨🇳 大陆节点", "🇭🇰 香港节点", "🇲🇴 澳门节点", "🇹🇼 台湾节点"];
    const cnProxies = USER_CONFIG.proxyFirst ? [...cnCore, "DIRECT", proxyTarget] : ["DIRECT", ...cnCore, proxyTarget];
    finalGroups.push(buildSelect("🇨🇳 中国分流", cnProxies));
  }
  
  finalGroups.push(...appGroups);
  
  if (USER_CONFIG.enableIPv6) finalGroups.push(buildSelect("🌐 IPv6控制台", ["REJECT", "📍 手动选择", "DIRECT"]));

  // 构建漏网之鱼
  let fallbackProxies = [proxyTarget, "🚀 自动选择", "📍 手动选择", "♻️ 故障转移", "⏬ 下载策略"];
  if (proxyTarget !== "DIRECT") {
    USER_CONFIG.proxyFirst ? fallbackProxies.push("DIRECT") : fallbackProxies.unshift("DIRECT");
  }
  // 利用 Set 去重！
  finalGroups.push(buildSelect("🐟 漏网之鱼", [...new Set(fallbackProxies)]));

  // 地区哈希负载均衡
  if (USER_CONFIG.enableRegionHashLB) {
    Object.keys(REGION_NAMES).forEach(id => {
      if (!MIXED_REGION_IDS.includes(id) && BUCKETS[id] && BUCKETS[id].length > 1) {
        const hashGroupName = `⚖️ 负载均衡-哈希 (${id.toUpperCase()})`;
        finalGroups.push({ name: hashGroupName, type: "load-balance", strategy: "consistent-hashing", url: testURL, interval: testInterval, lazy: true, proxies: [...BUCKETS[id]], hidden: true });
        BUCKETS[id].unshift(hashGroupName);
      }
    });
  }

  // 挂载各大区国家策略组
  Object.entries(REGION_NAMES).forEach(([id, name]) => {
    if (BUCKETS[id] && BUCKETS[id].length > 0) finalGroups.push(buildRegionGroup(id, name, BUCKETS[id]));
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

  const routingRules = ["RULE-SET,lan-domain,DIRECT", "RULE-SET,lan-ip,DIRECT,no-resolve"];
  if (USER_CONFIG.enableIPv6) routingRules.push("IP-CIDR6,::1/128,DIRECT,no-resolve", "IP-CIDR6,fc00::/7,DIRECT,no-resolve", "IP-CIDR6,fe80::/10,DIRECT,no-resolve");
  if (USER_CONFIG.enableQUICReject) routingRules.push("AND,((NETWORK,UDP),(DST-PORT,443)),REJECT-DROP");

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
    if (USER_CONFIG[key]) { Object.assign(PROVIDER_BASE, providers); routingRules.push(...rules); }
  });

  if (USER_CONFIG.enableAntiAD) routingRules.push("RULE-SET,anti-ad,🚫 广告拦截");

  if (USER_CONFIG.enableTelegram) {
    if (IS_WIN) routingRules.push("PROCESS-NAME,Telegram.exe,✈️ Telegram");
    if (IS_MAC || IS_LIN) routingRules.push("PROCESS-NAME,Telegram,✈️ Telegram");
    routingRules.push("RULE-SET,telegram,✈️ Telegram", "RULE-SET,telegram-ip,✈️ Telegram,no-resolve");
    Object.assign(PROVIDER_BASE, { telegram: "geosite/telegram", "telegram-ip": "geoip/telegram" });
  }

  // 🛑 BT / PT 专属防漏拦截
  if (USER_CONFIG.enableProcessDirect) {
    if (IS_WIN) routingRules.push(...PROCESS_DIRECT_WIN.map(p => `PROCESS-NAME,${p}.exe,DIRECT`));
    if (IS_MAC) routingRules.push(...PROCESS_DIRECT_MAC.map(p => `PROCESS-NAME,${p},DIRECT`));
    if (IS_LIN) routingRules.push(...PROCESS_DIRECT_LIN.map(p => `PROCESS-NAME,${p},DIRECT`));
    routingRules.push("RULE-SET,bt-trackers-pt,DIRECT", "RULE-SET,bt-trackers-public,DIRECT", "DOMAIN-KEYWORD,tracker,DIRECT", "DOMAIN-KEYWORD,announce,DIRECT");
  } else {
    routingRules.push("RULE-SET,bt-trackers-pt,⏬ 下载策略", "RULE-SET,bt-trackers-public,⏬ 下载策略");
  }

  // ⏬ 普通下载软件（HTTP/游戏/应用）依然安全进入下载池
  if (IS_WIN) routingRules.push(...PROCESS_PROXY_WIN.map(p => `PROCESS-NAME,${p}.exe,⏬ 下载策略`));
  if (IS_MAC) routingRules.push(...PROCESS_PROXY_MAC.map(p => `PROCESS-NAME,${p},⏬ 下载策略`));
  routingRules.push("RULE-SET,download-games-cn,DIRECT", "RULE-SET,download-games,⏬ 下载策略", "RULE-SET,download-android,⏬ 下载策略");

  const cnTarget = USER_CONFIG.enableDomesticGroup ? "🇨🇳 中国分流" : "DIRECT";
  const nonCnTarget = proxyTarget;
  
  if (USER_CONFIG.proxyFirst) routingRules.push(`RULE-SET,non-cn,${nonCnTarget}`, `RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`);
  else routingRules.push(`RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`, `RULE-SET,non-cn,${nonCnTarget}`);

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

  if (USER_CONFIG.enableAntiAD) {
    config["rule-providers"]["anti-ad"] = { type: "http", behavior: "domain", url: "https://anti-ad.net/clash.yaml", path: "./ruleset/anti-ad.yaml", interval: 86400, format: "yaml", proxy: "DIRECT" };
  }

  // =========================================================================
  // --- 7. 🚀 DAG 级联空组清理机制 ---
  // =========================================================================
  const validBasics = new Set(["DIRECT", "REJECT", "REJECT-DROP", "COMPATIBLE", "PASS"]);
  (config.proxies || []).forEach(p => validBasics.add(p.name));
  
  let changed = true;
  const removedGroups = new Set();

  while (changed) {
    changed = false;
    const aliveGroups = new Set(config["proxy-groups"].map(g => g.name));

    config["proxy-groups"] = config["proxy-groups"].filter(group => {
      // a. 从列表中剔除物理不存在或已被斩首的节点/组
      if (group.proxies) group.proxies = group.proxies.filter(p => validBasics.has(p) || aliveGroups.has(p));

      // b. 判定：被洗劫一空，或用户显式隐藏(非负载均衡组件)
      const isEmpty = !group.proxies || group.proxies.length === 0;
      const isExplicitlyHidden = group.hidden && !group.name.includes("负载均衡");
      const isExempt = ["📍 手动选择", "🐟 漏网之鱼"].includes(group.name);

      // 执行斩首
      if ((isEmpty && !isExempt) || isExplicitlyHidden) {
        removedGroups.add(group.name); 
        aliveGroups.delete(group.name);
        changed = true;
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
  const ICON_MAPPING = {
    // === ⚙️ 核心与基础策略组 ===
    "📍 手动选择":      { icon: USER_CONFIG.iconRepoOrz + "Static.png",       newName: "手动选择" },
    "🚀 自动选择":      { icon: USER_CONFIG.iconRepoOrz + "Urltest.png",      newName: "自动选择" },
    "♻️ 故障转移":      { icon: USER_CONFIG.iconRepoOrz + "Available.png",    newName: "故障转移" },
    "⏬ 下载策略":      { icon: USER_CONFIG.iconRepoOrz + "Roundrobin.png",   newName: "下载策略" },
    "🏠 家宽专用":      { icon: USER_CONFIG.iconRepoOrz + "Home.png",         newName: "家宽专用" },
    // === 🌐 常见媒体与服务 ===
    "🇨🇳 中国分流":      { icon: USER_CONFIG.iconRepoKoolson + "China_Map.png", newName: "中国分流" },
    "🎓 学术网站":      { icon: USER_CONFIG.iconRepoKoolson + "Scholar.png",   newName: "学术网站" },
    "🪙 加密货币":      { icon: USER_CONFIG.iconRepoKoolson + "Cryptocurrency.png", newName: "加密货币" },
    "💳 PayPal":       { icon: USER_CONFIG.iconRepoKoolson + "PayPal.png",    newName: "PayPal" },
    "🎮 游戏服务":      { icon: USER_CONFIG.iconRepoKoolson + "Game.png",      newName: "游戏服务" },
    "🎵 TikTok":       { icon: USER_CONFIG.iconRepoKoolson + "TikTok.png",    newName: "TikTok" },
    "💬 社交平台":      { icon: USER_CONFIG.iconRepoKoolson + "Discord.png",   newName: "社交平台" },
    "▶️ YouTube":      { icon: USER_CONFIG.iconRepoKoolson + "YouTube.png",   newName: "YouTube" },
    "🎬 Netflix":      { icon: USER_CONFIG.iconRepoKoolson + "Netflix.png",   newName: "Netflix" },
    "🪄 Disney+":      { icon: USER_CONFIG.iconRepoKoolson + "Disney.png",    newName: "Disney+" },
    "🐱 GitHub":       { icon: USER_CONFIG.iconRepoKoolson + "GitHub.png",    newName: "GitHub" },
    "✈️ Telegram":     { icon: USER_CONFIG.iconRepoKoolson + "Telegram.png",  newName: "Telegram" },
    "🎧 Spotify":      { icon: USER_CONFIG.iconRepoKoolson + "Spotify.png",   newName: "Spotify" },
    "🤖 ChatGPT":      { icon: USER_CONFIG.iconRepoOrz  + "OpenAI.png",       newName: "ChatGPT" },
    "♊ Gemini":       { icon: USER_CONFIG.iconRepoKoolson + "AI.png",        newName: "Gemini" },
    "🦀 Claude":       { icon: USER_CONFIG.iconRepoKoolson + "Bot.png",       newName: "Claude" },
    "📺 哔哩哔哩":      { icon: USER_CONFIG.iconRepoOrz + "Bili.png",          newName: "哔哩哔哩" },
    "🪟 Microsoft":    { icon: USER_CONFIG.iconRepoOrz + "Microsoft.png",     newName: "Microsoft" },
    "🔍 Google":       { icon: USER_CONFIG.iconRepoOrz + "Google.png",        newName: "Google" },
    "🍎 Apple":        { icon: USER_CONFIG.iconRepoOrz + "Apple.png",         newName: "Apple" },
    // === 🛡️ 兜底与特殊规则 ===
    "🚫 广告拦截":      { icon: USER_CONFIG.iconRepoKoolson + "Reject.png",    newName: "广告拦截" },
    "🌐 IPv6控制台":    { icon: USER_CONFIG.iconRepoKoolson + "Direct.png",    newName: "IPv6控制台" },
    "🐟 漏网之鱼":      { icon: USER_CONFIG.iconRepoKoolson + "Final.png",     newName: "漏网之鱼" },
    "🌐 其他节点":      { icon: USER_CONFIG.iconRepoKoolson + "Global.png",    newName: "其他节点" },
    "🗑️ 未知识别":      { icon: USER_CONFIG.iconRepoKoolson + "Cydia.png",     newName: "未知识别" }
  };

  if (USER_CONFIG.groupIconMode !== "emoji") {
    const useIconOnly = USER_CONFIG.groupIconMode === "icon";
    const renameMap = {};

    // 1. 给策略组装配在线图标，并记录改名映射
    config["proxy-groups"].forEach(g => {
      if (ICON_MAPPING[g.name]) {
        g.icon = ICON_MAPPING[g.name].icon;
        if (useIconOnly) {
          renameMap[g.name] = ICON_MAPPING[g.name].newName;
          g.name = ICON_MAPPING[g.name].newName;
        }
      }
    });

    // 2. 如果是纯净图标模式，一键批量替换所有关联名称
    if (useIconOnly && Object.keys(renameMap).length) {
      // 1️⃣ 分流规则中的策略组 (切开 -> 替换 -> 拼回)
      if (config.rules) config.rules = config.rules.map(r => r.split(',').map(p => renameMap[p] || p).join(','));
      // 2️⃣ 策略组 proxies 列表里的套娃名称
      config["proxy-groups"].forEach(g => { if (g.proxies) g.proxies = g.proxies.map(p => renameMap[p] || p); });
      // 3️⃣ rule-providers 里的专属代理名称
      Object.values(config["rule-providers"] || {}).forEach(p => { if (p.proxy) p.proxy = renameMap[p.proxy] || p.proxy; });
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
      "respect-rules": true, "use-hosts": true,
      "fake-ip-filter": ["*.lan", "*.local", "*.arpa", "time.*.com", "ntp.*.com", "localhost.ptlogin2.qq.com", "*.msftncsi.com", "www.msftconnecttest.com", "ipv6.msftncsi.com", "*.ipv6-literal.net", "google.cn", "*.music.163.com", "*.music.126.net"],
      "default-nameserver": CUSTOM_DNS_DEFAULT, 
      "direct-nameserver": CUSTOM_DNS_DIRECT, "direct-nameserver-follow-policy": true,
      "proxy-server-nameserver": CUSTOM_DNS_DIRECT, 
      "nameserver": CUSTOM_DNS_PROXY,
      "nameserver-policy": { "rule-set:cn-domain": CUSTOM_DNS_DIRECT }
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
    (config.proxies || []).forEach(p => {
      const isTargetType = ["vless", "vmess", "trojan"].includes(p.type);
      const isTlsEnabled = p.tls === true || (["ws", "grpc"].includes(p.network) && p.tls !== false);
      
      if (isTargetType && isTlsEnabled) {
        p["client-fingerprint"] = "chrome";
      }
    });
  }
  // EOF: May your routing be fast and your connection secure. 🚀
  return config;
}