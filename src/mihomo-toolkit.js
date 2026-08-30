// =========================================================================
//  📦 Mihomo-Toolkit | 通用动态策略组脚本 | ALL-IN-ONE | MIT 许可证
// ------------------------------------------------------------------------
// 🏷️ 版本: v3.5.0 (Build 2026.08.30)
// 👤 作者: XiaoM-OVO
// 📝 描述: 专为 Mihomo 内核客户端设计的简易动态路由策略组脚本。
// 🛠️ 功能: 动态清洗 / 智能分流 / 自动容错 / 多场景适配 / 动态图标组装
// 🌐 仓库: https://github.com/XiaoM-OVO/Mihomo-Toolkit
// =========================================================================
// 💡 【节点清洗图标说明】
// 🤖 : OpenAI / ChatGPT      ♊ : Google Gemini       🦀 : Anthropic Claude
// 📺 : 流媒体访问 (NF/P+)     🎮 : 游戏 / FullCone     ⏬ : 下载 / BT 专用
// 📱 : WAP 移动优化            🏠 ：住宅IP / 家宽
// 🆓 : 免费 / 公益节点         🗑️ : 清洗失败节点
// ------------------------------------------------------------------------
// 💡 【底层协议图标说明】
// 🛩️ : SS/SSR    🦊 : VMess    🛸 : VLESS     🐎 : Trojan    🛡️ : AnyTLS
// ⚡ : HY/HY2     💨 : TUIC     🕸️ : WireGuard 📡 : Snell
// ------------------------------------------------------------------------
// 💡 【传输层标签说明】(由 renameTemplate 中的 {transport} 控制)
// TCP 默认隐藏 | WS / H2 / GRPC / QUIC / HTTP 展示在节点名末尾 · 之后
// ------------------------------------------------------------------------
// 💡 【节点重命名与模板变量说明】
// 你可以直接使用下方用 {} 包裹的字符串模板，或者传递一个 JS 函数: `(vars, proxy) => "新名字"`
// 如果使用函数，可以通过 vars.xxx 获取以下所有变量，通过 proxy 获取原始的节点数据对象。
// {airport}: 节点标签 (如果在第一项开启了 enableAirportTag)
// {icon}:    国家/地区的国旗 Emoji (如 🇭🇰, 🇺🇸)
// {region}:  国家/地区的中文字符串 (如 香港, 美国)
// {index}:   节点编号 (如 01, 02)
// {features}:节点特征 Emoji (如 📺 流媒体, 🎮 游戏, ⏬ 下载)
// {protocol}:节点底层协议 Emoji (如 🛩️ SS, 🦊 VMess)
// {city}:    具体的落地城市名称 (如: "东京", "大阪")
// {in}:      入口地区 (如: "深", "沪")
// {line}:    线路特征 (如: "BGP/家宽")
// {multi}:   倍率数值 (如: "x2.0")
// {transport}:非TCP传输层标签 (如 WS, H2, GRPC)
// {ip_stack}:网络栈 (如: "IPv6", "双栈")
// =========================================================================
const DEFAULT_CONFIG = {

// =========================================================================
// ⚙️ 用户自定义配置区 (开关配置) - true 为开启，false 为关闭
// =========================================================================
  // 【1. 基础全局配置】
  enableScript: true,          // 🟢 脚本总控：设为 false 则原样输出订阅内容
  logLevel: "info",            // 📋 日志级别: silent | error | warn | info | debug
  osType: "windows",           // 💻 设备类型: "windows", "mac", "linux", "all"
  proxyFirst: true,            // 🧭 路由偏好：true(海外代理优先)，false(国内直连优先)
  defaultProxyMode: "auto",    // 🔀 默认代理策略: auto(自动) / manual(手动) / fallback(故障转移)  [⚠️特殊: direct / reject]
  enableIPv6: false,           // 🌐 全局 IPv6：控制 TUN、DNS 及路由（本地无物理 IPv6 请务必设为 false！）
  enableAirportTag: false,     // 🏷️ 标签提取：订阅合并时自动/手动捕捉标签内容
  airportTag: "",              // 🏷️ 手动指定标签（需要节点名字自带标签，逗号分隔），为空则自动正则检测
  airportTagReg: /^\[([^\]]{1,8})\]/i, // 🧩 自定义标签提取正则 (默认提取首部方括号内容)
  showFeatureIcon: true,       // 🎨 特征图标：true(模板{features}填Emoji如📺), false(填文字如"流媒体")。enableNodeRename=false 时此开关被忽略

  // 【2. 节点清洗与处理】
  enableDedupe: false,         // 🧽 节点去重：开启后自动剔除底层完全重复的“注水”节点
  removeInfoNodes: false,      // 🗑️ 纯净节点: 隐藏流量/到期时间等信息节点

  renameTemplate: "[{airport}] {icon} {region} {index} {features} | {in} {city} {line} {multi} {ip_stack} · {transport}", // 🔤 节点重命名模板
  renameSeparators: ["|", "-", "·", "/", "~", ":", ",", ";", "_", "=", "+", "*", ">", "<", "➩", "=>", "->"], // 🧹 允许作为分隔符被自动清理的悬空符号列表
  whitelistKeywords: [],       // ⚪ 白名单关键词: 包含即放行并保留原名，不参与清洗，例: ["x-ray", "自建"]
  specialNodeRules: [],        // 💡 自定义重命名: 示例: { reg: /url.test|测速/i, targetName: "🚀 节点测速" })
  customNodeGroups: {},        // 🎯 自定义节点分组: 指定节点进入哪些应用组, 键=关键词(子串匹配), 值=目标组名数组(如: { "自建HK": ["🤖 ChatGPT", "🐱 GitHub"]})
  indexPrefixMap: {},          // 🔢 序号前缀映射: 键=订阅标签, 值=前缀(如 { "AirportA": "A", "AirportB": "B" })
  enableNodeRename: true,      // 🔄 二次重命名：设为 false 则直接继承原节点名（如果上游已经清洗过名字，建议关闭此项防乱码）
  strictRegionMatch: false,    // 🌏 未知地区匹配：true(严格模式，仅匹配预设字典，其余全扔垃圾桶)，false(宽松模式，允许通过国旗Emoji动态捕获冷门国家放入"其他"组)
  adTextThreshold: 6,          // 🔠 纯文本广告判定阈值：无数字/线路特征且长度大于此值的节点视为广告
  lowMultiThreshold: 0.99,     // ⏬ 低倍率分流阈值：倍率 <= 此值的节点自动归入下载策略 (设为 0 关闭)
  isolateDownload: false,      // ⏬ 低倍率节点隔离：设为 true 从普通大区池中剔除，设为 false 则允许进入普通池
  highMultiThreshold: 2.5,     // 🚩 高倍率沉底/隔离阈值：倍率超过此值排序自动下沉；配合 isolateHighMulti 时从普通池剔除独立成组
  isolateHighMulti: false,     // 🚀 高倍率节点隔离：设为 true 将超过 highMultiThreshold 的节点从普通池剔除，聚合为「🚀 高倍率优选」组（false 时仅排序下沉，留在普通池）

  // 【3. 策略组建组与 UI 面板】
  minorNodeThreshold: 3,       // 📊 小众地区建组阈值：节点数 >= 此值则独立建组，否则折叠至大区组
  regionGroupType: "url-test", // ⚙️ 地区组行为: "url-test", "select", "fallback"
  enableRegionHashLB: false,   // ⚖️ 地区散列: 在达到阈值的地区组增加哈希负载均衡策略组
  hideGarbageGroup: false,     // 🗑️ 隐藏垃圾桶：无论是否有未知识别节点，强制不在面板显示
  groupIconMode: "emoji",      // 🎨 策略组图标: "emoji"(仅保留Emoji), "icon"(仅在线图标), "both"(同时保留)
  iconRepoOrz: "https://fastly.jsdelivr.net/gh/Orz-3/mini@master/Color/",
  iconRepoKoolson: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/",
  iconRepoLige47: "https://raw.githubusercontent.com/lige47/lige_icon/main/icon/",

  // 【4. 核心分流开关】
  enableAdBlock: true,         // 🚫 广告拦截：去除网页及 APP 广告
  enableAI: true,              // 🤖 AI 助手：OpenAI, Gemini, Claude，Copilot 等
  enableTelegram: true,        // ✈️ 社交通讯：Telegram 独立分流
  enableStreaming: true,       // 📺 流媒体服务：具体平台在 STREAMING_SERVICES 中增删（详见下方注册表）
  enableGame: true,            // 🎮 游戏平台：具体平台在 gameServices 中增删（详见下方注册表）
  enableSystemServices: true,  // 🪟 系统服务：Microsoft, Apple, Google 框架服务
  enableDomesticGroup: false,  // 🇨🇳 中国分流：开启后增加专门的"中国"策略组 (配合直连优先使用，触发海外回国模式)

  // 【5. 扩展分流开关】
  enableAntiAD: false,         // ☢️ 激进广告拦截：启用 anti-AD 规则集 (强力，但容易误杀)
  enableGitHub: true,          // 🐱 开发者选项：GitHub, GitLab 等
  enableScholar: true,         // 🎓 学术研究：Google Scholar 等
  enableSocial: false,         // 💬 海外社交：具体平台在 SOCIAL_SERVICES 中增删（详见下方注册表）
  enableCrypto: false,         // 🪙 加密货币：Binance 等交易平台
  enablePayPal: false,         // 💳 金融支付：PayPal 独立分流
  enableResidential: false,    // 🏠 家宽分流：自动提取住宅/ISP节点作为高级备用
  enableWebRTC: false,         // 🗣 WebRTC 专项分流：会议/浏览器/STUN-TURN 协商（仅分流控制，不防泄漏；默认目标随路由方向自动：回国→直连，正常→代理）
  residentialNodeGroups: {},   // 🏠 家宽节点注入：键=地区(如 "hk"/"us" 或 "all")，值=目标应用组数组(如 { "all": ["🤖 ChatGPT", "♊ Gemini"] })

  // 【6. 网络测速与规则集配置】
  testInterval: 300,           // 🕒 测速间隔: 单位秒
  testTolerance: 50,           // ⚖️ 切换阈值: 延迟差低于此值不频繁切换 IP
  useMRS: true,                // 🚀 极速规则模式: true(MRS格式), false(YAML格式)
  testURL: "https://cp.cloudflare.com/generate_204", // 🔗 延迟测速地址
  ruleProviderCDN: "https://fastly.jsdelivr.net/gh", // 🔗 规则集 CDN 节点 (备用选择: https://testingcf.jsdelivr.net/gh 或 https://gcore.jsdelivr.net/gh)

  // 【7. DNS 服务器配置】
  dnsListen: "127.0.0.1:1053",                     // 📡 DNS 监听（可只写 host，端口从订阅取；软路由改 0.0.0.0:53）
  dnsDefault: ["223.5.5.5", "119.29.29.29"],       // 📡 基础解析 DNS
  dnsDirect:  ["https://223.5.5.5/dns-query", "https://120.53.53.53/dns-query", "223.5.5.5", "119.29.29.29"], // 📡 直连 DNS（DoH 优先 + UDP 兜底）
  dnsProxy:   ["https://8.8.8.8/dns-query", "https://1.1.1.1/dns-query"],        // 📡 代理 DNS (DoH)
  dnsServer:  ["https://223.5.5.5/dns-query", "https://119.29.29.29/dns-query"], // 📡 节点域名解析DNS

  // 【8. 安全防漏与底层内核覆写】
  enableProcessDirect: true,   // 🛑 进程直连防漏：强制指定的软件(如P2P/BT等)走直连，防止流量滥用与误代理(关闭后内置BT规则会指向⏬ 下载策略)
  enableTrafficAudit: true,    // 🛡️ 流量审计：非标流量强制直连防断流
  enableQUICReject: false,     // ⚡ QUIC 智能分流：开启后跟随路由模式自动适配，关闭则完全直连（不干预 QUIC）
  overwriteTun: true,          // 🖧 覆写 TUN 配置：注入严格路由与网段排除
  overwriteDns: true,          // 📡 覆写 DNS 总开关（拉闸即完全不干预；开启后由下方 dnsMergeMode 分级控制）
  dnsMergeMode: "secure",      // 📡 DNS 覆写模式：secure=防泄漏优先（脚本权威写 DNS 服务器，仅订阅有 listen 时保留）；merge=订阅友好（DNS 服务器订阅优先）；passthrough=完全不碰
  overwriteSniffer: true,      // 🔎 覆写 Sniffer 配置：启用深度包检测防 SNI 阻断
  enableCoreOptimize: true     // ⚡ 覆写核心内核优化: 开启提升性能、统一延迟、指纹伪装
};

function main(config, extConfig) {
  const USER_CONFIG = Object.assign({}, DEFAULT_CONFIG, extConfig || {});
  if (!USER_CONFIG.enableScript) return config;

  // =========================================================================
  // 🪛 高级进阶修改区 (硬编码预设)
  // =========================================================================
  // 🤖 AI 服务加载列表（受 enableAI 总开关控制，删 key 即关闭）
  //    可用: chatgpt, gemini, claude, copilot (+ CUSTOM_SERVICES.ai)
  const AI_SERVICES = USER_CONFIG.aiServices || ["chatgpt", "gemini", "claude", "copilot"];
  const AI_PREFERRED_REGIONS = USER_CONFIG.aiPreferredRegions || ["us", "jp", "tw", "sg", "kr", "eu"];

  // 💬 海外社交 App 列表
  const SOCIAL_SERVICES = USER_CONFIG.socialServices || ["twitter", "facebook", "instagram", "discord"];
  const INDEPENDENT_SOCIAL = USER_CONFIG.independentSocial || ["twitter"];

  // 📺 流媒体服务加载列表
  const STREAMING_SERVICES = USER_CONFIG.streamingServices || ["youtube", "netflix", "bilibili", "disney", "spotify", "tiktok", "bahamut", "pixiv", "twitch"];
  const BILI_PREFERRED_REGIONS = USER_CONFIG.biliPreferredRegions || ["🇹🇼 台湾节点", "🇲🇴 澳门节点", "🇭🇰 香港节点"];

  // 🪟 系统服务加载列表
  const SYSTEM_SERVICES = USER_CONFIG.systemServices || ["microsoft", "apple", "google"];

  // 🎮 游戏服务加载列表
  //    可用: steam, epic, riot, blizzard, nintendo, playstation, xbox, ubisoft, origin, ea
  const GAME_SERVICES = USER_CONFIG.gameServices || ["steam", "epic", "riot", "blizzard", "nintendo", "playstation", "xbox", "ubisoft", "origin", "ea"];

  // 🛑 指定进程强制直连名单
  const PROCESS_DIRECT_WIN = USER_CONFIG.processDirectWin || ["qBittorrent", "Thunder", "BitComet", "uTorrent", "aria2c"];
  const PROCESS_DIRECT_MAC = USER_CONFIG.processDirectMac || ["Thunder", "BitComet", "uTorrent", "qbittorrent", "aria2c", "transmission-daemon"];
  const PROCESS_DIRECT_LIN = USER_CONFIG.processDirectLin || ["qbittorrent", "aria2c", "transmission-daemon"];

  // ⏬ 指定进程强制走下载策略
  const PROCESS_PROXY_WIN  = USER_CONFIG.processProxyWin || ["IDMan", "fdm"];
  const PROCESS_PROXY_MAC  = USER_CONFIG.processProxyMac || ["fdm"];
  const PROCESS_PROXY_LIN  = USER_CONFIG.processProxyLin || [];

  // 🧩 自定义服务注册表
  const CUSTOM_SERVICES = USER_CONFIG.customServices || {
    // 🤖 AI：需 name, uiIcon, reg, provider, ruleSet, iconUrl, cleanName
    ai: {},
    // 📺 流媒体：需 name, cleanName, iconUrl, provider（reg/pool 可选，有则参与节点清洗）
    streaming: {},
    // 💬 社交：需 name, cleanName, iconUrl, provider
    social: {},
    // 🎮 游戏：需 provider, rules（分流规则数组）
    game: {},
    // 🪟 系统服务：需 name, cleanName, iconUrl, provider, rules
    system: {},
    // 🛠️ 开发者/学术：需 name, cleanName, iconUrl, provider
    dev: {}
  };

  // 📋 自定义分流规则（原始规则文本，会注入到 MATCH 之前）
  //    格式示例: "DOMAIN-SUFFIX,example.com,🚀 自动选择" 或 "IP-CIDR,1.2.3.4/32,DIRECT,no-resolve"
  const CUSTOM_RULES = [];

  // 📥 自定义规则集资源（远程下载的 rule-provider，需配合 CUSTOM_RULES 引用）
  //    必填: url (下载地址), behavior ("domain"|"ipcidr"|"classical"), format ("yaml"|"mrs")
  //    可选: interval (默认86400秒), path (默认 ./ruleset/<name>.<format>), proxy (默认 DIRECT)
  //    示例: { "my-ads": { url: "https://example.com/ads.yaml", behavior: "domain", format: "yaml" } }
  const CUSTOM_RULE_PROVIDERS = {};

  // 🧹 常用正则大礼包
  const REGEX_INFO_NODE = /剩余流量|套餐到期|到期时间|有效时间|过期|更新公告|重置|维护|不可用|扣费|节点说明|防失联|官网|地址|Q群|电报|Tg群|距离下次/i;
  const REGEX_FORBID_DL_STR = "(?:禁止|禁|严禁|请勿|勿|不要|不能|拒绝|屏蔽|防)(?:BT|PT|P2P|下载|测速|迅雷)|(?:仅限|仅供)(?:网页|日常|聊天)|\\b(?:No|Block|Ban)[\\s\\-_]*(?:BT|PT|Torrent|Download)\\b";
  // 清洗冗余说明文字和推广网址
  const REGEX_CLEANUP = new RegExp(`${REGEX_FORBID_DL_STR}|(?:https?:\\/\\/|www\\.)?[a-zA-Z0-9][-a-zA-Z0-9]{1,62}\\.(?:com|net|org|cc|me|vip|pro|top|xyz|club)`, "ig");
  const REGEX_FORBID_DL = new RegExp(REGEX_FORBID_DL_STR, "i");
  // 入口城市关键词
  const ENTRY_CITIES = ['深','深圳','广','广州','上海','沪','京','北京','杭','杭州','四川','川','渝','重庆','辽','莞','东莞','苏','江苏','无锡','鲁','徐','湘','宁','南京','汉','武汉','穗','港','香港','台','台湾','日本','日','新加坡','英国','英','韩国','韩','美国','美','Ingress'];
  // 出口地区关键词
  const EXIT_REGIONS = ['港','台','美','日','韩','新','英','德','法','俄','印','澳','狮城','多伦多','芝加哥','中','台湾','日本','新加坡','上海','沪','广','深','Exit','Destination'];
  // 转义特殊字符
  const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dedupe = (arr) => [...new Set(arr)];
  const entryPattern = ENTRY_CITIES.map(escapeRegex).join('|');
  const exitPattern = EXIT_REGIONS.map(escapeRegex).join('|');
  // 构建入口城市匹配正则
  const REGEX_ENTRY_CITY = new RegExp(`(${entryPattern})(?:\\s*(?:-|->|—|=|>)\\s*(?=${exitPattern})|(?=${exitPattern}))`,'i');
  // 识别节点倍率 (如 x0.5, 1.5x, 倍率: 2.0)
  const REGEX_MULTI      = /(?<![a-zA-Z])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍率)?|(\d+(?:\.\d+)?)\s*(?:[xX×]|倍率)(?!\s*\d))/i;
  // 识别线路类型 (如 IEPL, BGP, CN2)
  const REGEX_TECH_LINE = /(IEPL|IPLC|BGP|CN2|GIA|CMI|CMIN2|CUG|PCCW|9929|4837|AWS|GCP|Oracle|Azure|Hinet|Zenlayer|三网|电联|移联|电移|移动|联通|电信|CTCUCM|CTCUM|CTCU|CUCT|CMCU|CUCM|CTCM|CMCT|专线|测试|实验|备用|测速)/gi;
  // 识别营销标识
  const REGEX_FLUFF_LINE = /(高速|极速|优化|起飞|VIP|Premium|Pro|Plus|标准|基础|高级|节点)/gi;
  // 识别抽象黑话
  const LINE_MAP = { "CTCUCM": "三网", "CTCUM": "三网","CTCU": "电联", "CUCT": "电联","CMCU": "移联", "CUCM": "移联","CTCM": "电移", "CMCT": "电移"};
  const CN_MAP   = { "移动": "移", "联通": "联", "电信": "电" };
  // 识别未知国家的 emoji 国旗
  const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;
  const REGEX_ALL_FLAGS  = /\p{Regional_Indicator}{2}/gu;

  // =========================================================================
  // --- ⚙️ 预处理阶段一：日志模块 ---
  // =========================================================================
  const SCRIPT_VERSION = "v3.5.0";
  const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
  const currentLevel = LOG_LEVELS[USER_CONFIG.logLevel] ?? 3;

  // redactLevel=full（分享日志档）时对打印内容屏蔽 IP / 域名 / IPv6，与 pure 阶段行为一致；
  // partial/off 不做环境信息屏蔽（凭据本就由 builder 侧单独脱敏）
  const logRedact = (USER_CONFIG.redactLevel === 'full')
    ? (v) => (typeof v === 'string'
        ? v.replace(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g, '***.***.***.***')
             .replace(/\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g, '***.***')
             .replace(/\b([A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g, '***:***')
        : v)
    : (v) => v;
  const logger = {
    debug: (...args) => { if (currentLevel >= 4) console.log("[Toolkit] DBG  " + args.map(logRedact).join(' ')); },
    info:  (...args) => { if (currentLevel >= 3) console.log("[Toolkit] INFO " + args.map(logRedact).join(' ')); },
    warn:  (...args) => { if (currentLevel >= 2) console.warn("[Toolkit] WARN " + args.map(logRedact).join(' ')); },
    error: (...args) => { if (currentLevel >= 1) console.error("[Toolkit] ERR  " + args.map(logRedact).join(' ')); }
  };

  logger.info(`Mihomo-Toolkit ${SCRIPT_VERSION} 已加载`);
  logger.debug(`去重[${USER_CONFIG.enableDedupe?'开':'关'}] | 纯净[${USER_CONFIG.removeInfoNodes?'开':'关'}] | 地区[${USER_CONFIG.strictRegionMatch?'严':'松'}] | 下载[≤${USER_CONFIG.lowMultiThreshold}]`);


  // =========================================================================
  // --- ⚙️ 预处理阶段二：常量与字典预定义 ---
  // =========================================================================
  // 📍 前置入口城市前缀
/* ↓↓↓↓↓ INJECT_BEGIN ↓↓↓↓↓ */
  const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信|香港|台湾|日本|韩国|新加坡|美国|英国|德国|法国|澳洲|英|德|法|澳|美|日|韩|新|港|台)";
/* ↑↑↑↑↑ INJECT_END ↑↑↑↑↑ */
  const TAG_MAP = {
    "深": "深", "深圳": "深", "SZX": "深", "广": "广", "广州": "广", "CAN": "广",
    "上海": "沪", "沪": "沪", "PVG": "沪", "SHA": "沪", "京": "京", "北京": "京",
    "PEK": "京", "PKX": "京", "杭": "杭", "杭州": "杭", "HGH": "杭",
    "四川": "川", "川": "川", "渝": "渝", "重庆": "渝", "东莞": "莞", "莞": "莞",
    "南京": "宁", "宁": "宁", "成都": "蓉", "武汉": "汉", "汉": "汉", "鲁": "鲁", "苏": "苏", "江苏": "苏",
    "港": "港", "香港": "港", "台": "台", "台湾": "台", "日": "日", "日本": "日", "新加坡": "新",
    "韩": "韩", "韩国": "韩", "英": "英", "英国": "英", "美": "美", "美国": "美",
  };

  // 💻 操作系统类型判定
  const OS = (USER_CONFIG.osType || "windows").toLowerCase();
  const IS_WIN = OS === "windows" || OS === "all";
  const IS_MAC = OS === "mac"     || OS === "all";
  const IS_LIN = OS === "linux"   || OS === "all";

  // 🌏 地区识别字典
/* ↓↓↓↓↓ INJECT_BEGIN ↓↓↓↓↓ */
  const REGION_DEFS = [
      //--- 大中华区 ---
      { id: "cn", name: "中国", icon: "🇨🇳", city: "深圳|广州|上海|北京|杭州|成都|武汉|南京", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(CN|PRC)(?![a-zA-Z])|China|(?:美|日|韩|新|港|台|英|德|法|澳)(?:-|->|至|=>|\s)*(?:京|沪|广|深|国内|大陆|中国|落地)/i },
      { id: "hk", name: "香港", icon: "🇭🇰", reg: new RegExp(`${IN_PREFIX}港|香港|香江|(?<![a-zA-Z])(?:HK|HKT|HKBN|HGC|WTT|PCCW)(?![a-zA-Z])|Hong Kong`, "i") },
      { id: "mo", name: "澳门", icon: "🇲🇴", reg: /澳门|澳門|Macau|Macao|(?<![a-zA-Z])CTM(?![a-zA-Z])/i },
      { id: "tw", name: "台湾", icon: "🇹🇼", city: "台北|新北|台中|高雄|彰化", reg: new RegExp(`${IN_PREFIX}台|台湾|台灣|(?<![a-zA-Z])(?:TW|APTG)(?![a-zA-Z])|Taiwan|Hinet|Kbro|Seednet`, "i") },

      // --- 亚洲核心区 ---
      { id: "jp", name: "日本", icon: "🇯🇵", city: "东京|大阪|埼玉|京都|川崎", reg: new RegExp(`${IN_PREFIX}日|日本|(?<![a-zA-Z])(?:JP|OCN)(?![a-zA-Z])|Japan|Nuro|Plala`, "i") },
      { id: "kr", name: "韩国", icon: "🇰🇷", city: "首尔|春川", reg: new RegExp(`${IN_PREFIX}韩|韩国|(?<![a-zA-Z])KR(?![a-zA-Z])|Korea`, "i") },
      { id: "sg", name: "新加坡", icon: "🇸🇬", city: "狮城", reg: new RegExp(`${IN_PREFIX}新|新加坡|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore|Singtel|StarHub|MyRepublic|ViewQwest`, "i") },

      // --- 北美大区 ---
      { id: "us", name: "美国", icon: "🇺🇸", city: "洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|亚特兰大|凤凰城|硅谷|纽约|迈阿密|华盛顿", reg: new RegExp(`${IN_PREFIX}美|美国|西美|(?<![a-zA-Z])(?:US|LAX)(?![a-zA-Z])|Los Angeles|America`, "i") },

      // --- 欧洲大区 ---
      { group: "eu", name: "英国", icon: "🇬🇧", city: "伦敦|費勒姆", reg: /英国|(?<![a-zA-Z])UK(?![a-zA-Z])|United Kingdom|Britain/i },
      { group: "eu", name: "德国", icon: "🇩🇪", city: "法兰克福", reg: /德国|(?<![a-zA-Z])DE(?![a-zA-Z])|Germany/i },
      { group: "eu", name: "法国", icon: "🇫🇷", city: "巴黎", reg: /法国|(?<![a-zA-Z])FR(?![a-zA-Z])|France/i },
      { group: "eu", name: "俄罗斯", icon: "🇷🇺", city: "莫斯科|伯力|圣彼得堡|新西伯利亚", reg: /俄罗斯|(?<![a-zA-Z])RU(?![a-zA-Z])|Russia/i },
      { group: "eu", name: "乌克兰", icon: "🇺🇦", city: "基辅", reg: /乌克兰|(?<![a-zA-Z])UA(?![a-zA-Z])|Ukraine/i },
      { group: "eu", name: "西班牙", icon: "🇪🇸", city: "马德里", reg: /西班牙|(?<![a-zA-Z])ES(?![a-zA-Z])|Spain/i },
      { group: "eu", name: "荷兰", icon: "🇳🇱", city: "阿姆斯特丹", reg: /荷兰|(?<![a-zA-Z])NL(?![a-zA-Z])|Netherlands/i },
      { group: "eu", name: "瑞士", icon: "🇨🇭", city: "苏黎世|日内瓦", reg: /瑞士|(?<![a-zA-Z])CH(?![a-zA-Z])|Switzerland/i },
      { group: "eu", name: "意大利", icon: "🇮🇹", city: "米兰|罗马", reg: /意大利|(?<![a-zA-Z])IT(?![a-zA-Z])|Italy/i },
      { group: "eu", name: "瑞典", icon: "🇸🇪", city: "斯德哥尔摩", reg: /瑞典|(?<![a-zA-Z])SE(?![a-zA-Z])|Sweden/i },
      { group: "eu", name: "爱尔兰", icon: "🇮🇪", city: "都柏林", reg: /爱尔兰|(?<![a-zA-Z])IE(?![a-zA-Z])|Ireland/i },
      { group: "eu", name: "波兰", icon: "🇵🇱", city: "华沙", reg: /波兰|(?<![a-zA-Z])PL(?![a-zA-Z])|Poland/i },
      { group: "eu", name: "芬兰", icon: "🇫🇮", city: "赫尔辛基", reg: /芬兰|(?<![a-zA-Z])FI(?![a-zA-Z])|Finland/i },
      { group: "eu", name: "冰岛", icon: "🇮🇸", city: "雷克雅未克", reg: /冰岛|(?<![a-zA-Z])IS(?![a-zA-Z])|Iceland/i },

      // --- 南亚大区 ---
      { group: "sa", name: "印度", icon: "🇮🇳", city: "孟买|新德里", reg: /印度|(?<![a-zA-Z])IN(?![a-zA-Z])|India/i },

      // --- 东南亚大区 ---
      { group: "sea", name: "马来西亚", icon: "🇲🇾", city: "吉隆坡", reg: /马来|马来西亚|(?<![a-zA-Z])MY(?![a-zA-Z])|Malaysia/i },
      { group: "sea", name: "泰国", icon: "🇹🇭", city: "曼谷", reg: /泰国|(?<![a-zA-Z])TH(?![a-zA-Z])|Thailand/i },
      { group: "sea", name: "印尼", icon: "🇮🇩", city: "雅加达", reg: /印尼|印度尼西亚|(?<![a-zA-Z])ID(?![a-zA-Z])|Indonesia/i },
      { group: "sea", name: "菲律宾", icon: "🇵🇭", city: "马尼拉", reg: /菲律宾|(?<![a-zA-Z])PH(?![a-zA-Z])|Philippines/i },
      { group: "sea", name: "越南", icon: "🇻🇳", city: "胡志明|河内", reg: /越南|(?<![a-zA-Z])VN(?![a-zA-Z])|Vietnam/i },

      // --- 美洲大区 --
      { group: "am", name: "加拿大", icon: "🇨🇦", city: "多伦多|温哥华|蒙特利尔", reg: /加拿大|(?<![a-zA-Z])CA(?![a-zA-Z])|Canada/i },
      { group: "am", name: "阿根廷", icon: "🇦🇷", city: "布宜诺斯艾利斯", reg: /阿根廷|(?<![a-zA-Z])AR(?![a-zA-Z])|Argentina/i },
      { group: "am", name: "巴西", icon: "🇧🇷", city: "圣保罗", reg: /巴西|(?<![a-zA-Z])BR(?![a-zA-Z])|Brazil/i },
      { group: "am", name: "墨西哥", icon: "🇲🇽", reg: /墨西哥|(?<![a-zA-Z])MX(?![a-zA-Z])|Mexico/i },
      { group: "am", name: "智利", icon: "🇨🇱", reg: /智利|(?<![a-zA-Z])CL(?![a-zA-Z])|Chile/i },

      // --- 中东大区 ---
      { group: "me", name: "阿联酋", icon: "🇦🇪", city: "迪拜", reg: /阿联酋|迪拜|(?<![a-zA-Z])(?:AE|UAE)(?![a-zA-Z])/i },
      { group: "me", name: "土耳其", icon: "🇹🇷", city: "伊斯坦布尔", reg: /土耳其|(?<![a-zA-Z])TR(?![a-zA-Z])|Turkey/i },
      { group: "me", name: "沙特", icon: "🇸🇦", city: "利雅得|吉达", reg: /沙特|阿拉伯|(?<![a-zA-Z])SA(?![a-zA-Z])|Saudi/i },
      { group: "me", name: "以色列", icon: "🇮🇱", city: "特拉维夫", reg: /以色列|(?<![a-zA-Z])IL(?![a-zA-Z])|Israel/i },

      // --- 非洲大区 ---
      { group: "af", name: "南非", icon: "🇿🇦", city: "约翰内斯堡", reg: /南非|(?<![a-zA-Z])ZA(?![a-zA-Z])|South Africa/i },
      { group: "af", name: "尼日利亚", icon: "🇳🇬", reg: /尼日利亚|(?<![a-zA-Z])NG(?![a-zA-Z])|Nigeria/i },
      { group: "af", name: "埃及", icon: "🇪🇬", city: "开罗", reg: /埃及|(?<![a-zA-Z])EG(?![a-zA-Z])|Egypt/i },

      // --- 其他零散地区 ---
      { name: "澳大利亚", icon: "🇦🇺", city: "悉尼|墨尔本", reg: /澳大利亚|澳洲|(?<![a-zA-Z])AU(?![a-zA-Z])|Australia|Sydney/i },
    ];
/* ↑↑↑↑↑ INJECT_END ↑↑↑↑↑ */

  // 🩲UI 图标映射字典
  const UI_ICONS = {
    protocols: {
      "ss": "🛩️", "ssr": "🚀", "vmess": "🦊", "vless": "🛸",
      "trojan": "🐴", "hysteria": "⚡", "hysteria2": "⚡",
      "tuic": "💨", "wireguard": "🕸️", "snell": "📡", "http": "🌐", "https": "🔒",
      "anytls": "🛡️"
    },
    features: {
      "residential": "🏠", "game": "🎮", "streaming": "📺", "download": "⏬",
      "free": "🆓", "wap": "📱", "CDN": "☁️", "aws": "🛰️", "AWS": "🛰️",
      "cellular": "📱",
    }
  };

  // 🏷️ 节点特征识别字典
  // tag → 文字映射（showFeatureIcon=false 时模板 {features} 用文字代替 Emoji）
  const FEATURE_TEXT_MAP = {
    "residential": "家宽", "game": "游戏", "streaming": "流媒体",
    "chatgpt": "GPT", "gemini": "Gemini", "claude": "Claude", "copilot": "Copilot", "ai": "AI",
    "download": "下载", "free": "免费", "no_download": "禁止下载",
    "wap": "WAP", "CDN": "CDN", "AWS": "AWS",
    "cellular": "蜂窝", "ipv6": "IPv6", "dualstack": "双栈"
  };
  const FEATURE_RULES = [
    { reg: /(?:家宽|住宅|宽带|原生|🏠|Residential|ISP|Home|HKT|HKBN|HGC|WTT|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|So[-_]?net|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)/i, tag: "residential", pool: "residential", groupName: "🏠 家宽优选" },
    { reg: /(?:游戏|🎮)|\b(?:Game|FullCone)\b/i,              tag: "game", pool: "game", groupName: "🎮 游戏服务" },
    { reg: /(?:下载|⏬)|\bBT\b/i,                             tag: "download" },
    { reg: /(?:免费|白嫖|公益|🆓)/i,                           tag: "free" },
    { reg: /(?:📱)|\bWAP\b/i,                                 tag: "wap" },
    { reg: /(?:CDN中转|中转CDN|CDN加速|☁️)/i,        tag: "CDN" },
    { reg: /(?:\bAmazon\b|\bAWS\b|🛰️)/i,             tag: "AWS" },
    { reg: /(?:流媒体|解锁|📺)/i,                             tag: "streaming" },
    { reg: /\b(?:IPv6|v6)\b/i,                                tag: "ipv6" },
    { reg: /(?:双栈|DualStack)/i,                             tag: "dualstack" },
    { reg: /(?:蜂窝|Cellular|移动网络)/i,                     tag: "cellular" },
  ];

  // 🤖 动态 AI 服务注册表
  const AI_REGISTRY = {
    "chatgpt": { tag: "chatgpt", name: "🤖 ChatGPT", uiIcon: "🤖", reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i, provider: "geosite/openai", ruleSet: "openai", iconUrl: USER_CONFIG.iconRepoOrz + "OpenAI.png", cleanName: "ChatGPT" },
    "gemini":  { tag: "gemini",  name: "♊ Gemini",  uiIcon: "♊", reg: /\bGemini\b/i,                 provider: "geosite/google-gemini", ruleSet: "gemini", iconUrl: USER_CONFIG.iconRepoKoolson + "AI.png", cleanName: "Gemini" },
    "claude":  { tag: "claude",  name: "🦀 Claude",  uiIcon: "🦀", reg: /\bClaude\b/i,                 provider: "geosite/anthropic", ruleSet: "claude", iconUrl: USER_CONFIG.iconRepoLige47 + "04ProxySoft/claude(1).png", cleanName: "Claude" },
    "copilot": { tag: "copilot", name: "🐙 Copilot", uiIcon: "🐙", reg: /\b(?:Copilot|Bing)\b/i,       provider: "geosite/bing", ruleSet: "bing", iconUrl: USER_CONFIG.iconRepoKoolson + "Copilot.png", cleanName: "Copilot" }
  };

  // 📺 动态流媒体服务注册表 (全息字典)
  const STREAMING_REGISTRY = {
    "youtube":  { name: "▶️ YouTube", cleanName: "YouTube", iconUrl: USER_CONFIG.iconRepoKoolson + "YouTube.png", provider: "geosite/youtube", reg: /\b(?:YouTube|YT|油管)\b/i, pool: "youtube" },
    "netflix":  { name: "🎬 Netflix", cleanName: "Netflix", iconUrl: USER_CONFIG.iconRepoKoolson + "Netflix.png", provider: "geosite/netflix", reg: /\b(?:Netflix|NF|奈飞|网飞|耐飞)\b/i, pool: "netflix" },
    "disney":   { name: "🪄 Disney+", cleanName: "Disney+", iconUrl: USER_CONFIG.iconRepoKoolson + "Disney.png",  provider: "geosite/disney",  reg: /\b(?:Disney\+|Disney|迪士尼|D\+)\b/i, pool: "disney" },
    "tiktok":   { name: "🎵 TikTok",  cleanName: "TikTok",  iconUrl: USER_CONFIG.iconRepoKoolson + "TikTok.png",  provider: "geosite/tiktok",  reg: /\b(?:TikTok|抖音海外|TT)\b/i, pool: "tiktok" },
    "spotify":  { name: "🎧 Spotify", cleanName: "Spotify", iconUrl: USER_CONFIG.iconRepoKoolson + "Spotify.png", provider: "geosite/spotify", reg: /\b(?:Spotify|声田|声破天)\b/i, pool: "spotify" },
    "bahamut":  { name: "📺 Bahamut", cleanName: "Bahamut", iconUrl: USER_CONFIG.iconRepoKoolson + "Bahamut.png", provider: "geosite/bahamut" }, // 靠地区解锁，无需节点正则
    "pixiv":    { name: "🅿️ Pixiv",   cleanName: "Pixiv",   iconUrl: USER_CONFIG.iconRepoLige47 + "04ProxySoft/pixiv.png",    provider: "geosite/pixiv" },
    "twitch":   { name: "🎮 Twitch",  cleanName: "Twitch",  iconUrl: USER_CONFIG.iconRepoKoolson + "Twitch.png",  provider: "geosite/twitch" },
    "bilibili": { name: "📺 BiliBili",cleanName: "BiliBili",iconUrl: USER_CONFIG.iconRepoOrz + "Bili.png",        provider: "geosite/bilibili" }
  };

  // 海外社交平台服务注册表 (全息字典)
  const SOCIAL_REGISTRY = {
    "twitter":   { name: "🐦 Twitter",   cleanName: "Twitter",   iconUrl: USER_CONFIG.iconRepoKoolson + "Twitter.png",   provider: "geosite/twitter" },
    "facebook":  { name: "👥 Facebook",  cleanName: "Facebook",  iconUrl: USER_CONFIG.iconRepoKoolson + "Facebook.png",  provider: "geosite/facebook" },
    "instagram": { name: "📸 Instagram", cleanName: "Instagram", iconUrl: USER_CONFIG.iconRepoKoolson + "Instagram.png", provider: "geosite/instagram" },
    "discord":   { name: "🎮 Discord",   cleanName: "Discord",   iconUrl: USER_CONFIG.iconRepoKoolson + "Discord.png",   provider: "geosite/discord" },
    "meta":      { name: "♾️ Meta",      cleanName: "Meta",      iconUrl: USER_CONFIG.iconRepoKoolson + "Meta.png",      provider: "geosite/facebook" }
  };

  // 🎮 动态游戏服务注册表
  const GAME_REGISTRY = {
    "steam":       { provider: "geosite/steam",       rules: ["DOMAIN-SUFFIX,steamcontent.com,🎮 游戏下载", "RULE-SET,steam-cn,🎮 游戏下载", "RULE-SET,steam,🎮 游戏服务"] },
    "steam-cn":    { provider: "geosite/steam@cn",    rules: [] }, // 仅作为 provider 依赖
    "epic":        { provider: "geosite/epicgames",   rules: ["DOMAIN-SUFFIX,download.epicgames.com,🎮 游戏下载", "RULE-SET,epic,🎮 游戏服务", "DOMAIN-SUFFIX,epicgames.com,🎮 游戏服务"] },
    "riot":        { provider: "geosite/riot",        rules: ["RULE-SET,riot,🎮 游戏服务"] },
    "blizzard":    { provider: "geosite/blizzard",    rules: ["RULE-SET,blizzard,🎮 游戏服务"] },
    "nintendo":    { provider: "geosite/nintendo",    rules: ["RULE-SET,nintendo,🎮 游戏服务"] },
    "playstation": { provider: "geosite/playstation", rules: ["RULE-SET,playstation,🎮 游戏服务"] },
    "xbox":        { provider: "geosite/xbox",        rules: ["RULE-SET,xbox,🎮 游戏服务"] },
    "ubisoft":     { provider: "geosite/ubisoft",     rules: ["RULE-SET,ubisoft,🎮 游戏服务"] },
    "origin":      { provider: "geosite/origin",      rules: ["RULE-SET,origin,🎮 游戏服务"] },
    "ea":          { provider: "geosite/ea",          rules: ["RULE-SET,ea,🎮 游戏服务"] }
  };

  // 🛠️ 动态开发者与学术注册表
  const DEV_REGISTRY = {
    "github":    { name: "🐱 GitHub",   cleanName: "GitHub",  iconUrl: USER_CONFIG.iconRepoKoolson + "GitHub.png",  provider: "geosite/github" },
    "scholar":   { name: "🎓 学术网站", cleanName: "Scholar", iconUrl: USER_CONFIG.iconRepoKoolson + "Scholar.png", provider: "geosite/category-scholar-!cn" }
  };

  // 🪟 动态系统服务注册表
  const SYSTEM_REGISTRY = {
    "google":    { name: "🔍 Google",    cleanName: "Google",    iconUrl: USER_CONFIG.iconRepoOrz + "Google.png",    provider: "geosite/google",    rules: ["RULE-SET,google,🔍 Google"] },
    "apple":     { name: "🍎 Apple",     cleanName: "Apple",     iconUrl: USER_CONFIG.iconRepoOrz + "Apple.png",     provider: "geosite/apple",     rules: ["RULE-SET,apple,🍎 Apple"] },
    "microsoft": { name: "🪟 Microsoft", cleanName: "Microsoft", iconUrl: USER_CONFIG.iconRepoOrz + "Microsoft.png", provider: "geosite/microsoft", rules: ["RULE-SET,microsoft,🪟 Microsoft"] }
  };

  // 🧩 合并自定义服务到内置注册表（在特性注入之前）
  if (CUSTOM_SERVICES.ai)        Object.assign(AI_REGISTRY, CUSTOM_SERVICES.ai);
  if (CUSTOM_SERVICES.streaming) Object.assign(STREAMING_REGISTRY, CUSTOM_SERVICES.streaming);
  if (CUSTOM_SERVICES.social)    Object.assign(SOCIAL_REGISTRY, CUSTOM_SERVICES.social);
  if (CUSTOM_SERVICES.game)      Object.assign(GAME_REGISTRY, CUSTOM_SERVICES.game);
  if (CUSTOM_SERVICES.system)    Object.assign(SYSTEM_REGISTRY, CUSTOM_SERVICES.system);
  if (CUSTOM_SERVICES.dev)       Object.assign(DEV_REGISTRY, CUSTOM_SERVICES.dev);

  // 根据顶层数组，动态将激活的 AI 注入到清洗字典和特征池中
  if (USER_CONFIG.enableAI && AI_SERVICES) {
    AI_SERVICES.slice().reverse().forEach(key => {
      const ai = AI_REGISTRY[key];
      if (ai) {
        UI_ICONS.features[ai.tag] = ai.uiIcon; // 注入节点名字上的清洗图标
        FEATURE_RULES.unshift({
          reg: ai.reg, tag: ai.tag, pool: ai.tag, groupName: ai.name
        }); // 注入正则判定与节点分流桶
      }
    });
  }

  // 动态合并流媒体节点的清洗正则
  if (USER_CONFIG.enableStreaming && STREAMING_SERVICES) {
    STREAMING_SERVICES.forEach(key => {
      const st = STREAMING_REGISTRY[key];
      if (st && st.reg && st.pool) {
        FEATURE_RULES.push({ reg: st.reg, tag: "streaming", pool: st.pool, groupName: st.name });
      }
    });
  }
  // 从 FEATURE_RULES 动态构建池名称到策略组名称的映射
  const POOL_GROUP_MAP = Object.fromEntries(
    FEATURE_RULES.filter(r => r.pool && r.groupName).map(r => [r.pool, r.groupName])
  );

  // =========================================================================
  // --- ⚙️ 预处理阶段三：正则预编译与动态映射构建 ---
  // =========================================================================
  // 🏷️ 预编译清洗正则
/* ↓↓↓↓↓ INJECT_BEGIN ↓↓↓↓↓ */
  REGION_DEFS.forEach(r => {
    const combinedSource = r.city ? `${r.reg.source}|${r.city}` : r.reg.source;
    r._cleanReg = new RegExp(combinedSource, "ig"); // 用于最后擦除名字
    r._matchReg = new RegExp(combinedSource, "i");  // 用于判定节点归属
    r._cityReg = r.city ? new RegExp(r.city, "i") : null;
  });
/* ↑↑↑↑↑ INJECT_END ↑↑↑↑↑ */
  // 国旗反查表：预建 icon → entry 映射，避免 matchNodeRegion 内线性扫描
  const FLAG_LOOKUP = new Map(REGION_DEFS.map(r => [r.icon, r]));
  FEATURE_RULES.forEach(r => r._cleanReg = new RegExp(r.reg.source, "ig"));



  // =========================================================================
  // --- ▶️ 执行阶段一：物理节点去重与前置拦截 ---
  // =========================================================================
  let proxies = [];
  let builtInProxies = [];
  const proxySet = new Set();
  let dedupeCount = 0;
  let discardedCount = 0;   // 🆕 被物理删除的广告/假节点
  let infoCount = 0;        // 提取 信息说明节点（仅未丢弃模式下）
  let ipv6DroppedCount = 0; // 提取 IPv6 过滤节点数
  const BASIC_PROXIES = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS']);

  (config.proxies || []).forEach(proxy => {
    if (BASIC_PROXIES.has(proxy.name)) { builtInProxies.push(proxy); return; }
    if (!USER_CONFIG.enableIPv6 && proxy.server && proxy.server.includes(':')) {
      ipv6DroppedCount++;
      logger.debug(`🚫 [丢弃] 「${proxy.name}」 (纯 IPv6 节点)`);
      return;
    }
    if (!proxy.server || REGEX_INFO_NODE.test(proxy.name)) { proxies.push(proxy); return; }

    if (USER_CONFIG.enableDedupe) {
      // 组合唯一键值防误杀
      const sni = proxy.sni || "";
      const network = proxy.network || "";
      const host = proxy.host || proxy["ws-opts"]?.headers?.Host || proxy["ws-opts"]?.headers?.host || "";
      const path = proxy["ws-opts"]?.path || proxy["grpc-opts"]?.["grpc-service-name"] || "";
      const authKey = proxy.uuid ? proxy.uuid.toLowerCase() : (proxy.password || "");
      const key = `${proxy.server}:${proxy.port}:${proxy.type}:${network}:${sni}:${host}:${path}:${authKey}`;
      if (!proxySet.has(key)) {
        proxySet.add(key);
        proxies.push(proxy);
      } else {
        // 🆕 去重命中，记录日志
        dedupeCount++;
        logger.debug(`🧽 [去重] 「${proxy.name}」 (${proxy.server})`);
      }
    } else {
      proxies.push(proxy);
    }
  });

  // =========================================================================
  // --- ▶️ 执行阶段二：节点深度清洗、特征提取与分发入桶 ---
  // =========================================================================
  // 🧠 动态提取所有混合大区的 ID（如 "eu", "sea", "am"）并加入兜底的 "other"
  const MIXED_REGION_IDS = [...new Set(REGION_DEFS.map(r => r.group).filter(Boolean)), "other"];
  // 🪣 预设分发桶 (用于把清洗后的节点按特征分类存放)
  const BUCKETS = { garbage: [], download: [], highMulti: [], info: [], allStandard: [], special: [], resiRegionMap: {} };
  // 自动接管所有地区、特征池、混合大区的桶
  [...new Set([
    ...REGION_DEFS.map(r => r.id || r.name),
    ...FEATURE_RULES.filter(r => r.pool).map(r => r.pool),
    ...MIXED_REGION_IDS
  ])].forEach(key => { BUCKETS[key] = BUCKETS[key] || []; });

  // 🚀 高倍率隔离组名（提前定义，供分发与建组阶段复用）
  const HIGH_MULTI_GROUP = "🚀 高倍率优选";


  // 辅助纯函数 1: 基础字符清洗
  function sanitizeNodeName(rawName) {
    let name = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, "");
    name = name.replace(/\p{Extended_Pictographic}/gu, m => {
      const cp = m.codePointAt(0);
      // 保留地区国旗 + 🏠(家宽标识, U+1F3E0)，其余 emoji 当噪声删除
      if (cp >= 0x1F1E6 && cp <= 0x1F1FF) return m;
      if (cp === 0x1F3E0) return m;
      return "";
    });
    name = name.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "");
    name = name.replace(/[\u2190-\u21FF\u2460-\u24FF\u2500-\u27BF\u2B00-\u2BFF]/g, " ");
    return name.replace(REGEX_CLEANUP, "").trim();
  }

  // 辅助纯函数 2: 提取节点属性 (倍率、线路、入口)
  function extractNodeAttributes(name) {
    let attrs = { multiNum: 1.0, multiStr: "", entryStr: "", lineArr: [], isLowMulti: false };

    // 1. 提取并擦除入口城市 (采用剥离模式，避免干扰后续识别)
    name = name.replace(REGEX_ENTRY_CITY, (match, p1) => {
        let m = p1.replace(/[-|>至=\s]/g, "");
        attrs.entryStr = TAG_MAP[m.toUpperCase()] || TAG_MAP[m] || m;
        return "";
    });

    // 2. 提取并擦除倍率
    let cleanName = name.replace(REGEX_MULTI, (m, m1, m2, m3) => {
      const num = parseFloat(m1 || m2 || m3);
      if (!isNaN(num)) {
        attrs.multiNum = num;
        if (num !== 1) attrs.multiStr = `x${num}`;
        if (USER_CONFIG.lowMultiThreshold > 0 && num <= USER_CONFIG.lowMultiThreshold) attrs.isLowMulti = true;
      }
      return "";
    });

    // 3. 提取线路类型并存入 lineArr（运营商存全称，压缩延迟到 compressLineArr 按需处理）
    cleanName = cleanName.replace(REGEX_TECH_LINE, match => {
      let key = match.toUpperCase();
      let short = LINE_MAP[key];
      if (!short) {
          const cnKey = Object.keys(CN_MAP).find(k => match.includes(k));
          if (cnKey) short = cnKey; // 先存全称：电信/移动/联通
      }
      if (short) attrs.lineArr.push(short);
      else if (match.length >= 2) attrs.lineArr.push(key);
      return "";
    });

    // 4. 执行三网/两网智能合并压制
    attrs.lineArr = compressLineArr(attrs.lineArr);

    // 5. 提取营销标识
    let fluffStr = "";
    cleanName = cleanName.replace(REGEX_FLUFF_LINE, match => { fluffStr += match.toUpperCase(); return ""; });

    // 6. 计算线路排序权重
    attrs.cleanLines = dedupe(attrs.lineArr).join("/");
    const fullLineStr = attrs.cleanLines + fluffStr;
    attrs.bestLineWeight = /(IEPL|IPLC)/.test(fullLineStr) ? 1 :
                          /(GIA|CN2|9929|CMIN2)/.test(fullLineStr) ? 2 :
                          /(专线|VIP|PRO|高速|极速|优化|PREMIUM)/.test(fullLineStr) ? 3 :
                          /(BGP|CMI)/.test(fullLineStr) ? 4 :
                          /(中转|隧道)/.test(fullLineStr) ? 5 : 6;

    return { attrs, cleanName };
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
      if (flagMatch) {
        const flagIcon = flagMatch[1];
        // 国旗反查预设字典：已知国旗直接归对应国家，避免厂商/城市词（如 AWS-Oregon）被误当国名
        const known = FLAG_LOOKUP.get(flagIcon);
        if (known) return known;
        const dynamicName = flagMatch[2].trim();
        return {
          id: dynamicName,
          icon: flagIcon,
          name: dynamicName,
          _isDynamic: true,
          _cleanReg: new RegExp(escapeRegex(dynamicName), "ig"),
          _matchReg: new RegExp(escapeRegex(dynamicName), "i"),
          _cityReg: null
        };
      }
    }
    return null;
  }

  // 辅助纯函数 4: 三网合并压缩函数（运营商全称按需压缩）
  function compressLineArr(arr) {
    const FULL_SET = new Set(["电信", "移动", "联通"]);
    const SHORT_MAP = { "电信": "电", "移动": "移", "联通": "联" };
    const atomSet = new Set(Object.values(SHORT_MAP));
    const comboMap = {
      "电联": new Set(["电","联"]), "移联": new Set(["移","联"]),
      "电移": new Set(["电","移"]), "三网": new Set(["移","联","电"])
    };

    const deduped = dedupe(arr);
    let carrierItems = [], nonCarrierItems = [];
    for (let item of deduped) {
      if (FULL_SET.has(item) || atomSet.has(item)) {
        // 统一成缩写用于合并判定
        carrierItems.push(SHORT_MAP[item] || item);
      } else {
        nonCarrierItems.push(item);
      }
    }

    const carrierCount = new Set(carrierItems).size;
    let merged = [];
    if (carrierCount >= 3) {
      merged = ["三网"];
    } else if (carrierCount === 2) {
      const matchCombo = Object.entries(comboMap).find(([k, members]) =>
        k !== "三网" && members.size === 2 && [...members].every(a => carrierItems.includes(a))
      );
      merged = matchCombo ? [matchCombo[0]] : dedupe(carrierItems);
    } else if (carrierCount === 1) {
      // 单运营商一律保留全称
      const single = dedupe(carrierItems)[0];
      const fullName = Object.keys(SHORT_MAP).find(k => SHORT_MAP[k] === single);
      merged = [fullName];
    }

    return [...merged, ...nonCarrierItems];
  }

  // 🔍 编译用户自定义标签正则（适配 /pattern/flags、纯字符串、RegExp 三种输入）
  const compileTagReg = (raw, fallback) => {
    if (typeof raw === 'string') {
      const m = raw.match(/^\/(.*?)\/([a-z]*)$/);
      return m ? new RegExp(m[1], m[2]) : new RegExp(raw, 'i');
    }
    if (raw instanceof RegExp) return raw;
    return fallback;
  };

  // 🔍 标签提取逻辑
  function getAirportTag(rawName, proxy) {
      if (!USER_CONFIG.enableAirportTag) return "";

      // 1. 优先读 builder 注入的 _subTag 字段（full 模式，符号无关）
      if (proxy && proxy._subTag) return proxy._subTag;

      // 2. 关键词强制抓取（split 场景：用户配置 airportTag 关键词列表）
      if (USER_CONFIG.airportTag) {
          const tags = USER_CONFIG.airportTag.split(",").map(t => t.trim()).filter(Boolean);
          for (const t of tags) {
              if (rawName.includes(t)) return t;
          }
      }

      // 3. 正则兜底（split/单跑场景：上游或机场自带的 [] 等包裹符号）
      const reg = compileTagReg(USER_CONFIG.airportTagReg, /^\[([^\]]{1,8})\]/i);
      const m = rawName.match(reg);
      return m ? (m[1] || m[0]) : "";
  }

  // 预编译动态分隔符清理正则，避免在循环中重复编译导致 Goja 引擎超时崩溃
  const customSeps = Array.isArray(USER_CONFIG.renameSeparators) ? USER_CONFIG.renameSeparators : ["|", "-", "·", "/", "~", ":", ",", ";", "_", "=", "+", "*", ">", "<", "➩", "=>", "->"];

  const charSeps = [];
  const wordSeps = [];
  customSeps.forEach(s => {
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (s.length === 1) charSeps.push(esc);
    else wordSeps.push(esc);
  });

  const charClass = charSeps.length > 0 ? `[${charSeps.join('')}]` : '';
  const wordStr = wordSeps.join('|');
  const combined = wordSeps.length > 0 ? (charClass ? `(?:${charClass}|${wordStr})` : `(?:${wordStr})`) : charClass;

  const regAdjacentSeps = combined ? new RegExp(`${combined}(?=\\s*${combined})`, 'g') : null;
  const regEdgeSeps = combined ? new RegExp(`^(?:\\s|${combined})+|(?:\\s|${combined})+$`, 'g') : null;

  const whitelistKeywordsLower = (USER_CONFIG.whitelistKeywords || []).map(k => k.toLowerCase());

  // 🔄 核心：第一轮遍历
  const processedData = proxies.map(proxy => {
    const rawName = proxy._rawName || proxy.name;

    // --- 步骤 1: 垃圾/广告/内置节点前置拦截 ---
    const isFakeServer = /^(127\.|0\.|1\.1\.1\.1|8\.8\.8\.8|10\.|192\.168\.)/.test(proxy.server || "") || proxy.port === 0;
    const isDummyAuth = /^(0{8}-0{4}-0{4}-0{4}-0{12}|123456|password|dummy)$/i.test(proxy.uuid || proxy.password || "");
    const isAdTypo = /防.{0,3}失|失.{0,3}联|地.{0,3}[址止]|官.{0,3}[网罔]|发.{0,3}[布步]|交.{0,3}流|群.{0,3}组|客.{0,3}服|定.{0,3}制/i.test(rawName)
              || (
                /(?:特惠|促销|优惠|不限速|大促|套餐)/.test(rawName) &&
                /(?:元|块|折|¥|售\s*\d+(?:\.\d+)?|价\s*\d+(?:\.\d+)?|\d+G)/i.test(rawName)
              );

    // 🏷️ 广告判定前剥离标签文字
    let tempNameForAd = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, "");
    const reg = compileTagReg(USER_CONFIG.airportTagReg, /^\[([^\]]{1,12})\]\s*/i);
    tempNameForAd = tempNameForAd.replace(reg, "");

    let tempName = tempNameForAd.replace(REGEX_ALL_FLAGS, "").replace(/[\[\]{}()<>【】]/g, "").trim();

    const isOrphanAd = !(/\d/.test(tempName) || REGEX_TECH_LINE.test(tempName) || REGEX_FLUFF_LINE.test(tempName)) &&
                      tempNameForAd.replace(/[\[\]{}()<>【】]/g, "").replace(/\p{Extended_Pictographic}/gu, "").replace(/\p{Regional_Indicator}/gu, "").trim().length > USER_CONFIG.adTextThreshold;
    const isInfoNode = REGEX_INFO_NODE.test(tempName) || proxy.isSyntheticInfo;

    if (isInfoNode) {
      if (USER_CONFIG.removeInfoNodes) return { skip: true, rawName, blockReason: "信息说明" };
      proxy.server = "127.0.0.1"; proxy.port = 80;
      return { isInfo: true, proxy, rawName };
    }

    const tempNameLower = tempName.toLowerCase();
    const subTagLower = (proxy._subTag || '').toLowerCase();

    let isSpecial = false;
    let specialTargetName = "";

    // 白名单匹配：名字包含关键词（split/单跑）或 _subTag 等于关键词（full 模式 URI 节点）
    if (whitelistKeywordsLower.some(k => tempNameLower.includes(k) || rawName.toLowerCase().includes(k) || (subTagLower && subTagLower === k))) {
        isSpecial = true;
        specialTargetName = proxy.name; // 白名单节点强制保留原名
    }

    if (!isSpecial && USER_CONFIG.specialNodeRules && USER_CONFIG.specialNodeRules.length > 0) {
      const match = USER_CONFIG.specialNodeRules.find(r => r.reg.test(tempName));
      if (match) {
        isSpecial = true;
        specialTargetName = match.targetName || proxy.name;
      }
    }

    if (isSpecial) {
      proxy.name = specialTargetName;
      return {
        proxy, rawName, regionInfo: null, tags: [], featurePools: [],
        pType: (proxy.type || "").toLowerCase(), transportTag: "", attrs: { multiNum: 1 },
        _destCity: null, airportTag: getAirportTag(rawName, proxy),
        groupKey: "special",
        isSpecial: true
      };
    }

    // 🆕 精确记录具体的拦截原因
    let blockReason = "";
    if (isFakeServer) blockReason = "假IP";
    else if (isDummyAuth) blockReason = "假密码";
    else if (isAdTypo) blockReason = "广告词";
    else if (isOrphanAd) blockReason = `超长文本(>${USER_CONFIG.adTextThreshold})`;

    if (blockReason) {
      return { skip: true, rawName, blockReason };
    }

    // --- 步骤 2: 名字基础清洗 ---
    let name = sanitizeNodeName(rawName);
    const isForbidDownload = REGEX_FORBID_DL.test(rawName);

    // --- 步骤 3: 提取倍率、入口、线路等属性 ---
    const { attrs, cleanName } = extractNodeAttributes(name);
    name = cleanName;

    // --- 步骤 4: 地区匹配与落地城市提取 ---
    // regionInfo 优先基于 pure 清洗名(proxy.name)识别，能看到 IP 反查/标准化地区结果；
    // 识别不到再回退原始名。split/单跑时 proxy.name===rawName，行为不变。
    let regionInfo = matchNodeRegion(sanitizeNodeName(proxy.name));
    if (!regionInfo) regionInfo = matchNodeRegion(name);
    let destCityStr = "";
    if (regionInfo && regionInfo.city) {
      const cityMatch = rawName.match(regionInfo._cityReg);
      if (cityMatch) destCityStr = cityMatch[0];
    }

    let tags = new Set(), featurePools = [];
    if (regionInfo) {
      const skipNameClean = USER_CONFIG.enableNodeRename === false;
      FEATURE_RULES.forEach(rule => {
        if (rule.reg.test(name)) {
          tags.add(rule.tag);
          if (rule.pool) featurePools.push(rule.pool);
          if (!skipNameClean) name = name.replace(rule._cleanReg, ""); // 仅在重命名开启时擦除特征文字
        }
      });

      if (attrs.isLowMulti && !isForbidDownload && !tags.has("download")) tags.add("download");

      // 擦除地名文字
      if (regionInfo.id !== "other") {
        name = name.replace(REGEX_ALL_FLAGS, "").replace(regionInfo._cleanReg, "");
      } else {
        // 动态/其他地区：全量擦除地名（字符串 replace 只删第一处，改用全局正则）
        name = name.replace(REGEX_ALL_FLAGS, "").replace(new RegExp(escapeRegex(regionInfo.name), "g"), "");
      }
    }

    name = name.replace(/[\[\]{}()<>（）【】]/g, "").replace(/\b\d{1,3}\b/g, "").replace(/[-_\|\s]+/g, " ").trim() || "其他";

    // --- 步骤 6: 组装传递给第二轮的数据结构 ---
    const lineArr = [attrs.cleanLines].filter(Boolean);
    const pType = (proxy.type || "").toLowerCase();
    const network = (proxy.network || "").toLowerCase();
    const transportTag = (network && network !== "tcp")
      ? network.replace(/^ws$/, "WS").replace(/^h2$/, "H2").replace(/^grpc$/, "GRPC").replace(/^quic$/, "QUIC").replace(/^http$/, "HTTP").toUpperCase()
      : "";

    const _airportTag = getAirportTag(rawName, proxy);
    const _groupKey = (_airportTag ? _airportTag + "__" : "") + (regionInfo ? regionInfo.name : name);

    return {
      proxy, rawName, regionInfo, tags: Array.from(tags), featurePools, pType, transportTag, attrs,
      _destCity: destCityStr || null,
      airportTag: _airportTag,
      groupKey: _groupKey,
      multiNum: attrs.multiNum, bestLineWeight: attrs.bestLineWeight,
      cleanLines: attrs.cleanLines, entryStr: attrs.entryStr
    };
  }).filter(d => {
    if (d && d.skip) {
      if (d.blockReason === "信息说明") {
        infoCount++;
        logger.debug(`🚫 [信息] 「${d.rawName}」`);
      } else {
        discardedCount++;
        logger.debug(`🚫 [丢弃] 「${d.rawName}」 (${d.blockReason})`);
      }
      return false;
    }
    return true;
  });

  // 生成地区排序权重字典
  const REGION_ORDER = {};
  REGION_DEFS.forEach((r, index) => { REGION_ORDER[r.name] = index; });

  // 🧹 多维排序逻辑
  processedData.sort((a, b) => {
    if (a.isInfo !== b.isInfo) return a.isInfo ? -1 : 1;
    if (a.isSpecial !== b.isSpecial) return a.isSpecial ? -1 : 1;
    const orderA = REGION_ORDER[a.regionInfo?.name || a.groupKey] ?? 999;
    const orderB = REGION_ORDER[b.regionInfo?.name || b.groupKey] ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    if (orderA === 999) {
      const nameA = a.regionInfo?.name || a.groupKey || "";
      const nameB = b.regionInfo?.name || b.groupKey || "";
      if (nameA !== nameB) return nameA.localeCompare(nameB, 'zh-CN');
    }
    // ⚡ 线路质量优先（IEPL > CN2/GIA > 专线 > BGP > 中转 > 其他）
    if (a.bestLineWeight !== b.bestLineWeight) return a.bestLineWeight - b.bestLineWeight;
    // 🏷️ 同质量下按订阅聚合，避免跨订阅节点交错
    if (USER_CONFIG.enableAirportTag) {
      const tagA = a.airportTag || "";
      const tagB = b.airportTag || "";
      if (tagA !== tagB) return tagA.localeCompare(tagB, 'zh-CN');
    }
    const getMultiWeight = (num) => num > (USER_CONFIG.highMultiThreshold || 2.0) ? 1 : 0;
    const multiWeightA = getMultiWeight(a.multiNum);
    const multiWeightB = getMultiWeight(b.multiNum);
    if (multiWeightA !== multiWeightB) return multiWeightA - multiWeightB;
    const entryA = a.entryStr || "ZZZ", entryB = b.entryStr || "ZZZ";
    if (entryA !== entryB) return entryA.localeCompare(entryB, 'zh-CN');
    const lineA = a.cleanLines || "ZZZ", lineB = b.cleanLines || "ZZZ";
    if (lineA !== lineB) return lineA.localeCompare(lineB, 'zh-CN');
    if (a.multiNum !== b.multiNum) return a.multiNum - b.multiNum;
    // 🧷 稳定排序锚点：用 server:port 替代 rawName 作为最终 tiebreaker，避免订阅改名导致顺序漂移
    const idA = `${a.proxy?.server || ""}:${a.proxy?.port || ""}`;
    const idB = `${b.proxy?.server || ""}:${b.proxy?.port || ""}`;
    if (idA !== idB) return idA.localeCompare(idB, 'zh-CN');
    return (a.rawName || '').localeCompare(b.rawName || '', 'zh-CN');
  });

  // 🏷️ 编号使用纯地区键（去掉机场前缀），确保跨机场编号连续不重复
  const getRegionOnlyKey = (gk) => {
    const idx = gk.indexOf('__');
    return idx !== -1 ? gk.substring(idx + 2) : gk;
  };

  const getAirportTagFromGroupKey = (gk) => {
    const idx = gk.indexOf('__');
    return idx !== -1 ? gk.substring(0, idx) : "";
  };

  // 隔离节点判定（家宽 / 隔离下载），统一供计数与分发阶段复用
  const isIsoNode = (tags) =>
    (USER_CONFIG.enableResidential && tags.includes("residential")) ||
    (USER_CONFIG.isolateDownload && tags.includes("download"));

  const isoCounts = {}, groupTrack = {}, isoTrack = {};
  const regionTotals = {}; // 地区总节点数（合并所有前缀）
  const groupTotals = {}; // 各分组节点数（含前缀分组与隔离分组，用于计算序号补零位数）
  processedData.forEach(d => {
    if (!d.isInfo) {
      const regionKey = getRegionOnlyKey(d.groupKey);
      const airportTag = getAirportTagFromGroupKey(d.groupKey);
      const prefix = d.proxy._indexPrefix || USER_CONFIG.indexPrefixMap[airportTag];
      const trackKey = prefix ? `${regionKey}_${prefix}` : regionKey;

      // 统计地区总节点数（隔离节点不进地区桶，不参与地区总数）
      const isIso = isIsoNode(d.tags);
      if (!isIso) {
        regionTotals[regionKey] = (regionTotals[regionKey] || 0) + 1;
      }

      // 隔离节点统计组内总数（用于判断是否显示序号）
      if (isIso) {
        const isoKey = `iso_${trackKey}`;
        isoCounts[isoKey] = (isoCounts[isoKey] || 0) + 1;
        groupTotals[isoKey] = (groupTotals[isoKey] || 0) + 1;
      } else {
        groupTotals[trackKey] = (groupTotals[trackKey] || 0) + 1;
      }
    }
  });
  // 全局统一序号补零位数：取最大分组节点数的位数，最小2位
  const maxGroupCount = Math.max(...Object.values(groupTotals), 9);
  const indexPad = Math.max(2, maxGroupCount.toString().length);

  // 节点 → 分桶路由：download/家宽/高倍率/大陆 各自独立或隔离，否则标准入池
  const routeNodeToBucket = ({ item, tags, regionInfo, finalName, displayRaw, tagDisplay, featurePools }) => {
    // 1. ⏬ 低倍率标签处理
    if (tags.includes("download")) {
      BUCKETS.download.push(finalName);
    }
    if (USER_CONFIG.isolateDownload && tags.includes("download")) {
      logger.debug(`⏬ [隔离] ${tagDisplay}「${displayRaw}」 → 「${finalName}」`);
      return;
    }

    // 2. 🏡 家宽特殊处理：独立成组，不进地区桶/高倍率/普通池
    if (USER_CONFIG.enableResidential && tags.includes("residential")) {
      BUCKETS.residential.push(finalName);
      const resiKey = regionInfo.id || regionInfo.name;
      if (!BUCKETS.resiRegionMap[resiKey]) BUCKETS.resiRegionMap[resiKey] = [];
      BUCKETS.resiRegionMap[resiKey].push(finalName);
      logger.debug(`🏡 [家宽] ${tagDisplay}「${displayRaw}」 → 「${finalName}」 → [🏠 家宽优选(${resiKey.toUpperCase()})]`);
      return;
    }

    // 3. 🚀 高倍率节点隔离：超过 highMultiThreshold 则独立为「高倍率优选」，从普通池剔除
    if (USER_CONFIG.isolateHighMulti && (item.multiNum || 1) > (USER_CONFIG.highMultiThreshold || 2.0)) {
      BUCKETS.highMulti.push(finalName);
      logger.debug(`🚀 [隔离] ${tagDisplay}「${displayRaw}」 → 「${finalName}」 → [${HIGH_MULTI_GROUP}]`);
      return;
    }

    // 4. 🇨🇳 中国大陆节点隔离
    if (regionInfo.id === "cn") {
      BUCKETS.cn.push(finalName);
      logger.debug(`🇨🇳 [中国] ${tagDisplay}「${displayRaw}」 → 「${finalName}」`);
      return;
    }

    // 5. 🌏 标准节点入池
    BUCKETS.allStandard.push(finalName);
    featurePools.forEach(p => BUCKETS[p].push(finalName));
    const regKey = regionInfo.id || regionInfo.name;
    if (!BUCKETS[regKey]) BUCKETS[regKey] = [];
    BUCKETS[regKey].push(finalName);

    const assignedBuckets = featurePools.map(p => POOL_GROUP_MAP[p] || `📦 特征池(${p})`);
    assignedBuckets.push(`📍 ${regionInfo.icon} ${regionInfo.name}`);
    logger.debug(`✅ [分发] ${tagDisplay}「${displayRaw}」 → 「${finalName}」 → [${assignedBuckets.join(', ')}]`);
  };

  // 🔄 第二轮遍历：执行重命名，并把节点扔进对应的桶里
  processedData.forEach(item => {
    if (item.isInfo) {
      infoCount++;
      logger.debug(`ℹ️ [保留] 「${item.rawName}」`);
      BUCKETS.info.push(item.proxy.name);
      return;
    }

    const { proxy, regionInfo, groupKey, rawName, tags, featurePools, pType, transportTag, attrs, _destCity } = item;
    const regionOnlyKey = getRegionOnlyKey(groupKey);
    const airportTag = getAirportTagFromGroupKey(groupKey);

    const prefix = proxy._indexPrefix || USER_CONFIG.indexPrefixMap[airportTag];
    const trackKey = prefix ? `${regionOnlyKey}_${prefix}` : regionOnlyKey;

    const isIso = isIsoNode(tags);
    const isoKey = isIso ? `iso_${trackKey}` : trackKey;
    const useTrack = isIso ? isoTrack : groupTrack;

    // 序号生成逻辑：地区总数>1 → 前缀+序号；地区总数=1 → 不显示
    useTrack[isoKey] = (useTrack[isoKey] || 0) + 1;
    const idx = useTrack[isoKey];
    // 隔离节点：判断隔离组内节点数；标准节点：判断地区总节点数
    const regionTotal = isIso ? (isoCounts[isoKey] || 1) : (regionTotals[regionOnlyKey] || 1);
    let numStr;
    if (regionTotal > 1) {
      numStr = prefix ? `${prefix}${idx.toString().padStart(indexPad, "0")}` : ` [${idx.toString().padStart(indexPad, "0")}]`;
    } else {
      numStr = "";
    }

    // 🏷️ 标签提取：优先读 _subTag 字段（full 模式），兜底正则（split/单跑）
    let airportTagStr = "";
    if (USER_CONFIG.enableAirportTag) {
      airportTagStr = getAirportTag(rawName, proxy);
    }
    // 日志用
    const tagDisplay = airportTagStr ? `🏷️${airportTagStr} | ` : "";
    const displayRaw = rawName;
    let finalName;
    if (item.isSpecial) {
      finalName = proxy.name;
    } else if (!regionInfo) {
      finalName = proxy.name;
    } else {
      let featuresStr = "";
      tags.forEach(tag => {
        if (tag === "ipv6" || tag === "dualstack") return; // 网络栈走 {ip_stack}，不进 {features}
        if (USER_CONFIG.showFeatureIcon !== false) {
          if (UI_ICONS.features[tag]) featuresStr += UI_ICONS.features[tag];
        } else {
          if (FEATURE_TEXT_MAP[tag]) featuresStr += (featuresStr ? "/" : "") + FEATURE_TEXT_MAP[tag];
        }
      });

      let protocolIcon = UI_ICONS.protocols[pType] || "";

      let ipStackStr = "";
      if (tags.includes("dualstack")) ipStackStr = "双栈";
      else if (tags.includes("ipv6")) ipStackStr = "IPv6";

      const vars = {
        airport: airportTagStr.trim(),
        icon: regionInfo ? regionInfo.icon : "",
        region: regionInfo ? regionInfo.name : "未知",
        index: numStr,
        features: featuresStr,
        protocol: protocolIcon,
        multi: attrs.multiStr || "",
        in: attrs.entryStr || "",
        city: _destCity || "",
        line: attrs.cleanLines || "",
        ip_stack: ipStackStr,
        transport: transportTag || ""
      };

      if (USER_CONFIG.enableNodeRename !== false) {
        if (typeof USER_CONFIG.renameTemplate === "function") {
          finalName = USER_CONFIG.renameTemplate(vars, proxy);
        } else {
          finalName = USER_CONFIG.renameTemplate.replace(/{(airport|icon|region|index|features|protocol|city|line|in|multi|transport|ip_stack)}/g, (match, key) => vars[key] || "");

          // 仅对字符串模板执行分隔符和空括号清理兜底
          if (regAdjacentSeps) {
              finalName = finalName.replace(regAdjacentSeps, "");
          }
          if (regEdgeSeps) {
              finalName = finalName.replace(regEdgeSeps, "");
          }
          finalName = finalName.replace(/\[\s*\]|\(\s*\)/g, "");
          finalName = finalName.replace(/\s{2,}/g, " ");
        }
      } else {
        // 关闭重命名：完全继承输入名，不做任何替换（full 模式下 = pure 清洗后的 proxy.name）
        finalName = proxy.name;
      }
    }

    proxy.name = finalName;

    // --- 核心分发 + 归属日志 ---
    if (item.isSpecial) {
      BUCKETS.special.push(finalName);
      logger.debug(`🌟 [自定义] ${tagDisplay}「${displayRaw}」 → 「${finalName}」`);
      return;
    }

    if (!regionInfo) {
      BUCKETS.garbage.push(finalName);
      const reasonMsg = USER_CONFIG.strictRegionMatch ? "严格匹配" : "无字典/国旗";
      logger.debug(`🗑️ [未识别] 「${displayRaw}」 → 「${finalName}」 (${reasonMsg})`);
    } else {
      routeNodeToBucket({ item, tags, regionInfo, finalName, displayRaw, tagDisplay, featurePools });
    }
  });

  // =========================================================================
  // --- ▶️ 执行阶段三：组装策略组 (Proxy Groups) ---
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

  // 处理动态生成的未知地区（宽松模式下提取出来的）
  Object.keys(BUCKETS).forEach(key => {
    if (key === "garbage" || key === "download" || key === "highMulti" || key === "cn" || key === "info" || key === "allStandard" || key === "other" || key === "residential" || key === "special") return;
    if (MIXED_REGION_IDS.includes(key) || POOL_GROUP_MAP[key] || REGION_NAMES[key]) return;
    if (REGION_DEFS.some(r => r.id === key || r.name === key)) return;

    // 走到这里的全是纯动态未知地区
    const nodes = BUCKETS[key];
    if (nodes && nodes.length > 0) {
      if (nodes.length >= USER_CONFIG.minorNodeThreshold) {
        const flagMatch = nodes[0].match(REGEX_UNKNOWN_FLAG);
        const icon = flagMatch ? flagMatch[1] : "🌍";
        REGION_NAMES[key] = `${icon} ${key}节点`;
      } else {
        BUCKETS.other.push(...nodes);
        BUCKETS[key] = [];
      }
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
  if (BUCKETS.other?.length > 0) activeRegionGroups.push("🌐 其他节点");

  const resiPrefix = (USER_CONFIG.enableResidential && BUCKETS.residential.length) ? ["🏠 家宽优选"] : [];

  const MODE_MAP = { "auto": "🚀 自动选择", "manual": "📍 手动选择", "fallback": "♻️ 故障转移", "direct": "DIRECT", "reject": "REJECT" };
  const proxyTarget = MODE_MAP[USER_CONFIG.defaultProxyMode] || "🚀 自动选择";
  // 🚀 高倍率隔离组引用（隔离开启且有节点时，+手动选择与各应用组能手动点名走这批节点）
  const highMultiRef = (USER_CONFIG.isolateHighMulti && BUCKETS.highMulti.length > 0) ? [HIGH_MULTI_GROUP] : [];

  const baseOptions = ["📍 手动选择", "🚀 自动选择", "♻️ 故障转移", ...highMultiRef, ...resiPrefix, ...activeRegionGroups];
  const standardOptions = dedupe([proxyTarget, ...baseOptions]);
  const coreSelectProxies = ["🚀 自动选择", "♻️ 故障转移", ...resiPrefix, ...highMultiRef, ...BUCKETS.special, ...activeRegionGroups, "DIRECT", ...BUCKETS.info];

  const buildSelect = (name, proxies, hidden = false) => ({ name, type: "select", proxies: dedupe(proxies), hidden });
  const buildRegionGroup = (id, name, proxies) => {
    let { regionGroupType: type, testURL: url, testInterval: interval, testTolerance: tolerance } = USER_CONFIG;
    if (MIXED_REGION_IDS.includes(id)) type = "select";
    const base = { name, type, proxies: dedupe(proxies) };
    if (type !== "select") Object.assign(base, { url, interval, lazy: true, ...(type === "url-test" && { tolerance }) });
    return base;
  };

  const appGroups = [];
  const { testURL, testInterval, testTolerance } = USER_CONFIG;

  // 📋 各大 App 的硬编码分流策略配置注册表
  const APP_GROUPS_REGISTRY = [

      // 💬 社交通讯
      { key: "enableTelegram",name: "✈️ Telegram",proxies: [...standardOptions, "DIRECT"] },

      // 🛠️ 开发者
      { key: "enableGitHub",  name: "🐱 GitHub",  proxies: [...standardOptions, "DIRECT"] },
      { key: "enableScholar", name: "🎓 学术网站", proxies: ["🇺🇸 美国节点", "🇪🇺 欧洲节点", "🇯🇵 日本节点", "🇸🇬 新加坡节点", "🇹🇼 台湾节点", "🇭🇰 香港节点", proxyTarget, "DIRECT"] },

      // 🎮 游戏
      { key: "enableGame",    name: "🎮 游戏服务", proxies: ["DIRECT", ...standardOptions, ...BUCKETS.game] },

      // 💳 金融
      { key: "enableCrypto",  name: "🪙 加密货币", proxies: ["🇹🇼 台湾节点", "🇯🇵 日本节点", "🇪🇺 欧洲节点", ...resiPrefix, proxyTarget, "DIRECT"] },
      { key: "enablePayPal",  name: "💳 PayPal",  proxies: ["DIRECT", proxyTarget, ...activeRegionGroups, ...resiPrefix] },
  ];

  // AI 节点独立判定
  const buildAIGroups = () => {
    if (!USER_CONFIG.enableAI || !AI_SERVICES) return [];
    const groups = [];
    const aiCore = AI_PREFERRED_REGIONS.map(id => REGION_NAMES[id]);
    AI_SERVICES.forEach(key => {
      const ai = AI_REGISTRY[key];
      if (!ai) return;
      groups.push(buildSelect(ai.name, [...resiPrefix, ...aiCore, ...BUCKETS[ai.tag], proxyTarget, "DIRECT"]));
    });
    return groups;
  };
  appGroups.push(...buildAIGroups());

  // 组装流媒体平台策略组
  const buildStreamingGroups = () => {
    if (!USER_CONFIG.enableStreaming || !STREAMING_SERVICES) return [];
    const groups = [];
    STREAMING_SERVICES.forEach(key => {
      const st = STREAMING_REGISTRY[key];
      if (!st) return;

      let proxies = [];
      // 针对部分特殊平台做地区限制处理
      switch(key) {
        case "tiktok":
          proxies = [...(BUCKETS.tiktok || []), ...activeRegionGroups.filter(g => !["🇭🇰 香港节点", "🇨🇳 大陆节点", "🗑️ 未知识别"].includes(g)), proxyTarget, "DIRECT"];
          break;
        case "bahamut":
          proxies = ["🇹🇼 台湾节点", "🇭🇰 香港节点", proxyTarget, "DIRECT"];
          break;
        case "bilibili":
          proxies = USER_CONFIG.enableDomesticGroup ? ["🇨🇳 中国分流", ...BILI_PREFERRED_REGIONS, "DIRECT"] : ["DIRECT", ...BILI_PREFERRED_REGIONS];
          break;
        default:
          // 标准国际流媒体（如 Netflix/YouTube/Disney/Spotify）
          proxies = [...(BUCKETS[st.pool] || []), ...standardOptions, "DIRECT"];
      }
      groups.push(buildSelect(st.name, proxies));
    });
    return groups;
  };
  appGroups.push(...buildStreamingGroups());

  // 组装社交平台策略组（独立 App 各自建组；其余合并；仅剩一个 App 时直接独立建组，避免空洞合并组）
  const buildSocialGroups = () => {
    if (!USER_CONFIG.enableSocial) return [];
    const groups = [];
    const combinedKeys = [];

    SOCIAL_SERVICES.forEach(key => {
      const app = SOCIAL_REGISTRY[key];
      if (!app) return;

      if (INDEPENDENT_SOCIAL.includes(key)) {
        groups.push(buildSelect(app.name, [...standardOptions, "DIRECT"]));
      } else {
        combinedKeys.push(key);
      }
    });

    if (combinedKeys.length === 1) {
      const app = SOCIAL_REGISTRY[combinedKeys[0]];
      groups.push(buildSelect(app.name, [...standardOptions, "DIRECT"]));
    } else if (combinedKeys.length > 1) {
      groups.push(buildSelect("💬 社交平台", [...standardOptions, "DIRECT"]));
    }
    return groups;
  };
  appGroups.push(...buildSocialGroups());

  // 注册表批量构建
  APP_GROUPS_REGISTRY.forEach(({ key, name, proxies }) => {
    if (USER_CONFIG[key]) appGroups.push(buildSelect(name, proxies));
  });

  // 🗣 WebRTC 专项分流：默认目标随路由方向自动（回国→直连，正常→代理）
  //   UDP 协商(DST-PORT 3478 等)统一交组，避免落到 DIRECT 造成打洞失败/直连泄漏
  if (USER_CONFIG.enableWebRTC) {
    const webrtcReturn = USER_CONFIG.enableDomesticGroup && !USER_CONFIG.proxyFirst;
    const webrtcList = webrtcReturn
      ? ["DIRECT", proxyTarget, "📍 手动选择", "🚀 自动选择", ...activeRegionGroups]  // 回国模式：国内会议直连优先
      : [proxyTarget, "DIRECT", "📍 手动选择", "🚀 自动选择", ...activeRegionGroups];   // 正常模式：海外会议走代理优先
    appGroups.push(buildSelect("🗣 WebRTC", webrtcList));
  }

  // 🎮 游戏下载策略组（与游戏服务共用 enableGame 开关）
  if (USER_CONFIG.enableGame) {
    appGroups.push(buildSelect("🎮 游戏下载", ["DIRECT", "⏬ 下载策略", "🚀 自动选择", "📍 手动选择", ...BUCKETS.game]));
  }

  // 系统服务
  if (USER_CONFIG.enableSystemServices && SYSTEM_SERVICES) {
    SYSTEM_SERVICES.forEach(key => {
      const sys = SYSTEM_REGISTRY[key];
      if (sys) {
        const pList = key === "google" ? [...standardOptions, "DIRECT"] : ["DIRECT", ...standardOptions];
        appGroups.push(buildSelect(sys.name, pList));
      }
    });
  }

  if (USER_CONFIG.enableAdBlock || USER_CONFIG.enableAntiAD) {
    appGroups.push(buildSelect("🚫 广告拦截", ["REJECT-DROP", "REJECT", "DIRECT"]));
  }

  // 核心基础策略组
  const finalGroups = [
    buildSelect("📍 手动选择", coreSelectProxies),
    { name: "🚀 自动选择", type: "url-test", url: testURL, interval: testInterval, tolerance: testTolerance, proxies: BUCKETS.allStandard },
    { name: "♻️ 故障转移", type: "fallback", url: testURL, interval: testInterval, proxies: activeRegionGroups }
  ];

  // 家宽
  if (USER_CONFIG.enableResidential) {
    finalGroups.push({ name: "🏠 家宽优选", type: "fallback", url: testURL, interval: testInterval, proxies: BUCKETS.residential });
  }

  // 下载策略
  finalGroups.push(buildSelect("⏬ 下载策略", ["DIRECT", "🔄 负载均衡-轮询", "🚀 自动选择", ...BUCKETS.download]));
  finalGroups.push({ name: "🔄 负载均衡-轮询", type: "load-balance", strategy: "round-robin", url: testURL, interval: 300, lazy: true, proxies: BUCKETS.download, hidden: true });

  // 高倍率优选（隔离后跨地区聚合；专用组仅含高倍率节点，组引用进手动选择与各应用组便于点名）
  if (USER_CONFIG.isolateHighMulti && BUCKETS.highMulti.length > 0) {
    finalGroups.push(buildSelect(HIGH_MULTI_GROUP, BUCKETS.highMulti));
  }

  // 中国分流
  if (USER_CONFIG.enableDomesticGroup) {
    const cnCore = ["🇨🇳 大陆节点", "🇭🇰 香港节点", "🇲🇴 澳门节点", "🇹🇼 台湾节点"];
    const cnProxies = (USER_CONFIG.enableDomesticGroup && !USER_CONFIG.proxyFirst)
      ? [...cnCore, proxyTarget, "DIRECT"]
      : ["DIRECT", ...cnCore, proxyTarget];
    finalGroups.push(buildSelect("🇨🇳 中国分流", cnProxies));
  }

  finalGroups.push(...appGroups);

  if (USER_CONFIG.enableIPv6) finalGroups.push(buildSelect("🌐 IPv6控制台", ["REJECT", "📍 手动选择", "DIRECT"]));

  // 漏网之鱼
  let fallbackProxies = [proxyTarget, "🚀 自动选择", "📍 手动选择", "♻️ 故障转移", "⏬ 下载策略"];
  if (proxyTarget !== "DIRECT") {
    USER_CONFIG.proxyFirst ? fallbackProxies.push("DIRECT") : fallbackProxies.unshift("DIRECT");
  }
  finalGroups.push(buildSelect("🐟 漏网之鱼", dedupe(fallbackProxies)));

  // 哈希负载均衡
  if (USER_CONFIG.enableRegionHashLB) {
    Object.keys(REGION_NAMES).forEach(id => {
      if (!MIXED_REGION_IDS.includes(id) && BUCKETS[id] && BUCKETS[id].length > 1) {
        const hashGroupName = `⚖️ 负载均衡-哈希 (${id.toUpperCase()})`;
        finalGroups.push({ name: hashGroupName, type: "load-balance", strategy: "consistent-hashing", url: testURL, interval: testInterval, lazy: true, proxies: [...BUCKETS[id]], hidden: true });
        BUCKETS[id].unshift(hashGroupName);
      }
    });
  }

  // 大区国家策略组
  Object.entries(REGION_NAMES).forEach(([id, name]) => {
    if (BUCKETS[id] && BUCKETS[id].length > 0) finalGroups.push(buildRegionGroup(id, name, BUCKETS[id]));
  });
  finalGroups.push(
    buildSelect("🌐 其他节点", BUCKETS.other),
    buildSelect("🗑️ 未知识别", BUCKETS.garbage, USER_CONFIG.hideGarbageGroup)
  );

  // 🎯 自定义节点分组：将自定义节点追加到指定的应用组
  if (USER_CONFIG.customNodeGroups && BUCKETS.special.length > 0) {
    const customGroups = USER_CONFIG.customNodeGroups;
    const existingGroupNames = new Set(finalGroups.map(g => g.name));
    for (const [keyword, targetGroups] of Object.entries(customGroups)) {
      if (!keyword || !Array.isArray(targetGroups)) continue;
      const keywordLower = keyword.toLowerCase();
      const matchedNodes = BUCKETS.special.filter(name => name.toLowerCase().includes(keywordLower));
      if (matchedNodes.length === 0) continue;
      for (const targetName of targetGroups) {
        if (!existingGroupNames.has(targetName)) {
          logger.warn(`[自定义分组] 目标组 "${targetName}" 不存在或未启用，跳过注入`);
          continue;
        }
        const group = finalGroups.find(g => g.name === targetName);
        if (group && group.proxies) {
          const existing = new Set(group.proxies);
          matchedNodes.forEach(n => { if (!existing.has(n)) group.proxies.push(n); });
          logger.info(`🎯 [自定义分组] 注入 ${matchedNodes.length} 个节点到 "${targetName}"`);
        }
      }
    }
  }

  // 🏠 家宽节点注入：将指定地区的家宽节点追加到目标应用组
  if (USER_CONFIG.enableResidential && USER_CONFIG.residentialNodeGroups && BUCKETS.residential.length > 0) {
    const resiGroups = USER_CONFIG.residentialNodeGroups;
    const existingGroupNames = new Set(finalGroups.map(g => g.name));
    const allResiNodes = BUCKETS.residential;
    const resiRegionMap = BUCKETS.resiRegionMap || {};
    for (const [regionKey, targetGroups] of Object.entries(resiGroups)) {
      if (!regionKey || !Array.isArray(targetGroups)) continue;
      let nodesToInject = allResiNodes;
      if (regionKey !== "all") {
        nodesToInject = resiRegionMap[regionKey] || [];
      }
      if (nodesToInject.length === 0) continue;
      for (const targetName of targetGroups) {
        if (!existingGroupNames.has(targetName)) {
          logger.warn(`[家宽注入] 目标组 "${targetName}" 不存在或未启用，跳过注入`);
          continue;
        }
        const group = finalGroups.find(g => g.name === targetName);
        if (group && group.proxies) {
          const existing = new Set(group.proxies);
          nodesToInject.forEach(n => { if (!existing.has(n)) group.proxies.push(n); });
          logger.info(`🏠 [家宽注入] 注入 ${nodesToInject.length} 个${regionKey === "all" ? "" : " " + regionKey.toUpperCase()}家宽节点到 "${targetName}"`);
        }
      }
    }
  }

  config["proxy-groups"] = finalGroups;

  // =========================================================================
  // --- ▶️ 执行阶段四：注入规则集与分流规则 (Rules) ---
  // =========================================================================
  const buildRoutingRules = () => {
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
  // ⚡ QUIC 精细屏蔽：按地域 + 回国模式反向（GEOSITE 抓域名、GEOIP 抓 IP 直连漏网）
  if (USER_CONFIG.enableQUICReject) {
    const isReturn = USER_CONFIG.enableDomesticGroup && !USER_CONFIG.proxyFirst;
    if (isReturn) {
      // 回国模式：只屏蔽国内 QUIC（海外 QUIC 直连放行；国内 QUIC 被挡后降级 TCP 走🇨🇳分流）
      routingRules.push("AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,cn)),REJECT-DROP");
      routingRules.push("AND,((NETWORK,UDP),(DST-PORT,443),(GEOIP,CN)),REJECT-DROP");
    } else {
      // 正常模式：只屏蔽海外 QUIC（国内 QUIC 直连放行；海外 QUIC 被挡后降级 TCP 走代理）
      routingRules.push("AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,geolocation-!cn)),REJECT-DROP");
      routingRules.push("AND,((NETWORK,UDP),(DST-PORT,443),(GEOIP,!CN)),REJECT-DROP");
    }
  }

  // 🚫 广告拦截
  if (USER_CONFIG.enableAdBlock) {
    PROVIDER_BASE["ads"] = "geosite/category-ads-all";
    routingRules.push("RULE-SET,ads,🚫 广告拦截");
  }
  if (USER_CONFIG.enableAntiAD) routingRules.push("RULE-SET,anti-ad,🚫 广告拦截");

  // 组装动态 AI 的规则集资源
  let aiProviders = {};
  let aiRules = [];
  if (USER_CONFIG.enableAI && AI_SERVICES) {
    AI_SERVICES.forEach(key => {
      const ai = AI_REGISTRY[key];
      if (ai) {
        aiProviders[ai.ruleSet] = ai.provider;
        aiRules.push(`RULE-SET,${ai.ruleSet},${ai.name}`);
      }
    });
  }

  // 组装流媒体平台规则集资源
  if (USER_CONFIG.enableStreaming && STREAMING_SERVICES) {
    STREAMING_SERVICES.forEach(key => {
      const st = STREAMING_REGISTRY[key];
      if (!st) return;
      PROVIDER_BASE[key] = st.provider;
      routingRules.push(`RULE-SET,${key},${st.name}`);
    });
  }

  //组装社交平台规则集资源
  if (USER_CONFIG.enableSocial) {
    const nonIndependentKeys = SOCIAL_SERVICES.filter(k => !INDEPENDENT_SOCIAL.includes(k) && SOCIAL_REGISTRY[k]);
    const useCombinedGroup = nonIndependentKeys.length > 1; // 仅当 2+ 个非独立App时才使用合并组

    SOCIAL_SERVICES.forEach(key => {
      const app = SOCIAL_REGISTRY[key];
      if (!app) return;
      const targetGroup = INDEPENDENT_SOCIAL.includes(key) ? app.name :
                          (useCombinedGroup ? "💬 社交平台" : app.name);
      PROVIDER_BASE[key] = app.provider;
      routingRules.push(`RULE-SET,${key},${targetGroup}`);
    });
  }

  // 注入游戏规则集
  if (USER_CONFIG.enableGame && GAME_SERVICES) {
    GAME_SERVICES.forEach(key => {
      const conf = GAME_REGISTRY[key];
      if (!conf) return;
      PROVIDER_BASE[key] = conf.provider;
      // 特殊依赖：steam rules 引用了 steam-cn，需自动附带其 provider
      if (key === "steam" && GAME_REGISTRY["steam-cn"]) PROVIDER_BASE["steam-cn"] = GAME_REGISTRY["steam-cn"].provider;
      routingRules.push(...conf.rules);
    });
  }

  // 注入专项服务规则集（AI / 学术 / GitHub / 加密货币 / PayPal）
  const FEATURE_MAP = [
    { key: "enableAI", providers: aiProviders, rules: aiRules },
    { key: "enableScholar", providers: { scholar: "geosite/category-scholar-!cn" }, rules: ["DOMAIN-KEYWORD,sci-hub,🎓 学术网站", "RULE-SET,scholar,🎓 学术网站"] },
    { key: "enableGitHub", providers: { github: "geosite/github" }, rules: ["RULE-SET,github,🐱 GitHub"] },
    { key: "enableCrypto", providers: { crypto: "geosite/category-cryptocurrency" }, rules: ["RULE-SET,crypto,🪙 加密货币"] },
    { key: "enablePayPal", providers: { paypal: "geosite/paypal" }, rules: ["RULE-SET,paypal,💳 PayPal"] },
    // 🗣 WebRTC 专项：TCP 域名关键词 + UDP 协商标准端口（STUN/TURN），无需外部规则集
    //   TCP 走组（组目标随路由方向），UDP 统一交组避免落 DIRECT 造成打洞失败/直连泄漏
    { key: "enableWebRTC", providers: {}, rules: [
      "DOMAIN-KEYWORD,webrtc,🗣 WebRTC",
      "DOMAIN-KEYWORD,stun,🗣 WebRTC",
      "DOMAIN-KEYWORD,turn,🗣 WebRTC",
      "DST-PORT,3478,🗣 WebRTC",
      "DST-PORT,5349,🗣 WebRTC",
      "DST-PORT,5350,🗣 WebRTC",
      "DST-PORT,19302,🗣 WebRTC",
    ] },
  ];

  FEATURE_MAP.forEach(({ key, providers, rules }) => {
    if (USER_CONFIG[key]) { Object.assign(PROVIDER_BASE, providers); routingRules.push(...rules); }
  });

  // Telegram 独立分流
  if (USER_CONFIG.enableTelegram) {
    if (IS_WIN) routingRules.push("PROCESS-NAME,Telegram.exe,✈️ Telegram");
    if (IS_MAC || IS_LIN) routingRules.push("PROCESS-NAME,Telegram,✈️ Telegram");
    routingRules.push("RULE-SET,telegram,✈️ Telegram", "RULE-SET,telegram-ip,✈️ Telegram,no-resolve");
    Object.assign(PROVIDER_BASE, { telegram: "geosite/telegram", "telegram-ip": "geoip/telegram" });
  }

  // 注入系统服务规则集
  if (USER_CONFIG.enableSystemServices && SYSTEM_SERVICES) {
    SYSTEM_SERVICES.forEach(key => {
      const conf = SYSTEM_REGISTRY[key];
      if (conf) {
        PROVIDER_BASE[key] = conf.provider;
        routingRules.push(...conf.rules);
      }
    });
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
  if (IS_LIN) routingRules.push(...PROCESS_PROXY_LIN.map(p => `PROCESS-NAME,${p},⏬ 下载策略`));
  routingRules.push("RULE-SET,download-games-cn,DIRECT", "RULE-SET,download-games,⏬ 下载策略", "RULE-SET,download-android,⏬ 下载策略");

  const isReturn = USER_CONFIG.enableDomesticGroup && !USER_CONFIG.proxyFirst;
  const cnTarget = USER_CONFIG.enableDomesticGroup ? "🇨🇳 中国分流" : "DIRECT";
  const nonCnTarget = isReturn ? "DIRECT" : proxyTarget;

  if (USER_CONFIG.proxyFirst) routingRules.push(`RULE-SET,non-cn,${nonCnTarget}`, `RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`);
  else routingRules.push(`RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`, `RULE-SET,non-cn,${nonCnTarget}`);

  if (USER_CONFIG.enableIPv6) routingRules.push("IP-CIDR6,::/0,🌐 IPv6控制台,no-resolve");
  if (USER_CONFIG.enableTrafficAudit) {
      routingRules.push("DST-PORT,53/80/443,🐟 漏网之鱼");
      routingRules.push("DST-PORT,1-65535,DIRECT");
  }
  if (CUSTOM_RULES.length) routingRules.push(...CUSTOM_RULES);
  routingRules.push("MATCH,🐟 漏网之鱼");

  const rules = dedupe(routingRules);

  const providers = Object.fromEntries(
    Object.entries(PROVIDER_BASE).map(([name, route]) => {
      const isExternal = /^https?:\/\//.test(route);
      const url = isExternal ? route : `${REPO}/geo/${route}.${ruleFormat}`;
      const fmt  = isExternal ? (/\.mrs$/i.test(route) ? "mrs" : "yaml") : ruleFormat;
      const behavior = isExternal ? "domain" : (route.includes("geoip") ? "ipcidr" : "domain");
      return [
        name, {
          type: "http", behavior,
          url, path: `./ruleset/${name}.${fmt}`,
          interval: 86400, format: fmt, proxy: "DIRECT"
        }
      ];
    })
  );

  if (USER_CONFIG.enableAntiAD) {
    providers["anti-ad"] = { type: "http", behavior: "domain", url: "https://anti-ad.net/clash.yaml", path: "./ruleset/anti-ad.yaml", interval: 86400, format: "yaml", proxy: "DIRECT" };
  }

  // 🧩 合并自定义规则集资源
  if (CUSTOM_RULE_PROVIDERS) {
    Object.entries(CUSTOM_RULE_PROVIDERS).forEach(([name, conf]) => {
      const fmt = conf.format || "yaml";
      providers[name] = {
        type: "http", proxy: "DIRECT", interval: 86400,
        path: `./ruleset/${name}.${fmt}`,
        ...conf
      };
    });
  }
  return { rules, providers };
  };
  const { rules, providers } = buildRoutingRules();
  config["rules"] = rules;
  config["rule-providers"] = providers;

  // =========================================================================
  // --- ▶️ 执行阶段五：🚀 DAG 级联空组清理机制 ---
  // =========================================================================
  const validBasics = new Set(["DIRECT", "REJECT", "REJECT-DROP", "COMPATIBLE", "PASS"]);
  (config.proxies || []).forEach(p => validBasics.add(p.name));

  let changed = true;
  let maxIterations = 20;
  const removedGroups = new Set();

  while (changed && maxIterations > 0) {
    maxIterations--;
    changed = false;
    const aliveGroups = new Set(config["proxy-groups"].map(g => g.name));

    config["proxy-groups"] = config["proxy-groups"].filter(group => {
      // a. 从列表中剔除物理不存在或已被斩首的节点/组
      if (group.proxies) group.proxies = group.proxies.filter(p => validBasics.has(p) || aliveGroups.has(p));

      // b. 判定：被洗劫一空，或用户显式隐藏(非负载均衡组件)
      const isEmpty = !group.proxies || group.proxies.length === 0;
      const isExempt = ["📍 手动选择", "🐟 漏网之鱼"].includes(group.name);

      // 执行斩首
      if (isEmpty && !isExempt) {
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
  if (maxIterations === 0) {
    logger.warn("策略组嵌套层数过深或存在循环引用，清理已提前终止！");
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
  // --- ▶️ 执行阶段六：🎨 UI 面板图标与命名清洗 ---
  // =========================================================================
  const ICON_MAPPING = {
    // === ⚙️ 核心与基础策略组 ===
    "📍 手动选择":     { icon: USER_CONFIG.iconRepoOrz + "Static.png",       newName: "手动选择" },
    "🚀 自动选择":     { icon: USER_CONFIG.iconRepoOrz + "Urltest.png",      newName: "自动选择" },
    "♻️ 故障转移":     { icon: USER_CONFIG.iconRepoOrz + "Available.png",    newName: "故障转移" },
    "⏬ 下载策略":     { icon: USER_CONFIG.iconRepoOrz + "Roundrobin.png",   newName: "下载策略" },
    "🏠 家宽优选":     { icon: USER_CONFIG.iconRepoLige47  + "05icon/home.png",   newName: "家宽优选" },
    "🚀 高倍率优选":   { icon: USER_CONFIG.iconRepoKoolson + "Speedtest.png",newName: "高倍率优选" },

    // === 🌐 综合业务大组 ===
    "🇨🇳 中国分流":     { icon: USER_CONFIG.iconRepoKoolson + "China_Map.png", newName: "中国分流" },
    "🪙 加密货币":     { icon: USER_CONFIG.iconRepoKoolson + "Cryptocurrency.png", newName: "加密货币" },
    "💳 PayPal":       { icon: USER_CONFIG.iconRepoKoolson + "PayPal.png",    newName: "PayPal" },
    "🎮 游戏服务":     { icon: USER_CONFIG.iconRepoKoolson + "Game.png",      newName: "游戏服务" },
    "🎮 游戏下载":     { icon: USER_CONFIG.iconRepoKoolson + "Game.png",      newName: "游戏下载" },
    "💬 社交平台":     { icon: USER_CONFIG.iconRepoKoolson + "Discord.png",   newName: "社交平台" }, // 社交平台兜底组
    "✈️ Telegram":     { icon: USER_CONFIG.iconRepoKoolson + "Telegram.png",  newName: "Telegram" },

    // === 🛡️ 兜底与特殊规则 ===
    "🚫 广告拦截":     { icon: USER_CONFIG.iconRepoKoolson + "Reject.png",    newName: "广告拦截" },
    "🌐 IPv6控制台":   { icon: USER_CONFIG.iconRepoKoolson + "Direct.png",    newName: "IPv6控制台" },
    "🐟 漏网之鱼":     { icon: USER_CONFIG.iconRepoKoolson + "Final.png",     newName: "漏网之鱼" },
    "🌐 其他节点":     { icon: USER_CONFIG.iconRepoKoolson + "Global.png",    newName: "其他节点" },
    "🗑️ 未知识别":     { icon: USER_CONFIG.iconRepoKoolson + "Cydia.png",     newName: "未知识别" }
  };

  // 1. 动态合并 AI 策略组图标
  if (USER_CONFIG.enableAI && AI_SERVICES) {
    AI_SERVICES.forEach(key => {
      const ai = AI_REGISTRY[key];
      if (ai && ai.iconUrl) ICON_MAPPING[ai.name] = { icon: ai.iconUrl, newName: ai.cleanName };
    });
  }

  // 2. 动态合并 流媒体 策略组图标
  if (USER_CONFIG.enableStreaming && STREAMING_SERVICES) {
    STREAMING_SERVICES.forEach(key => {
      const st = STREAMING_REGISTRY[key];
      if (st && st.iconUrl) ICON_MAPPING[st.name] = { icon: st.iconUrl, newName: st.cleanName };
    });
  }

  // 3. 动态合并 独立社交App 策略组图标（含自动晋升的单个非独立App）
  if (USER_CONFIG.enableSocial && SOCIAL_SERVICES) {
    const nonIndependentKeys = SOCIAL_SERVICES.filter(k => !INDEPENDENT_SOCIAL.includes(k) && SOCIAL_REGISTRY[k]);
    const useCombinedGroup = nonIndependentKeys.length > 1;

    SOCIAL_SERVICES.forEach(key => {
      const app = SOCIAL_REGISTRY[key];
      if (!app || !app.iconUrl) return;
      if (INDEPENDENT_SOCIAL.includes(key) || !useCombinedGroup) {
        ICON_MAPPING[app.name] = { icon: app.iconUrl, newName: app.cleanName };
      }
    });
  }

  // 🆕 4. 动态合并 系统服务 策略组图标
  if (USER_CONFIG.enableSystemServices && SYSTEM_SERVICES) {
    SYSTEM_SERVICES.forEach(key => {
      const sys = SYSTEM_REGISTRY[key];
      if (sys && sys.iconUrl) ICON_MAPPING[sys.name] = { icon: sys.iconUrl, newName: sys.cleanName };
    });
  }

  // 🆕 5. 动态合并 开发者与学术 策略组图标
  Object.values(DEV_REGISTRY).forEach(dev => {
      if (dev.iconUrl) ICON_MAPPING[dev.name] = { icon: dev.iconUrl, newName: dev.cleanName };
  });

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
  // --- ▶️ 执行阶段七：内核高级配置覆写 (TUN / DNS / Sniffer) ---
  // =========================================================================
  // TUN 注入
  if (USER_CONFIG.overwriteTun) {
    config["ipv6"] = USER_CONFIG.enableIPv6;
    config["tun"] = {
      ...(config.tun || {}),
      stack: "system", device: "Mihomo", "auto-route": true, "strict-route": true,
      "auto-detect-interface": true, "route-exclude-address": ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"]
    };
  }

  // DNS 注入（总开关: overwriteDns；分级: dnsMergeMode secure/merge/passthrough）
  //    secure=脚本权威写 DNS 服务器，仅订阅有 listen 时保留；merge=订阅友好；passthrough=不干预
  // 📡 DNS 服务器（取值自顶部 USER_CONFIG，可按需改动）
  const CUSTOM_DNS_DEFAULT = USER_CONFIG.dnsDefault;
  const CUSTOM_DNS_DIRECT  = USER_CONFIG.dnsDirect;
  const CUSTOM_DNS_PROXY   = USER_CONFIG.dnsProxy;
  const CUSTOM_DNS_SERVER  = USER_CONFIG.dnsServer;
  const applyDnsOverlay = (config) => {
    const mergeMode = (USER_CONFIG.dnsMergeMode || "secure").toLowerCase();
    if (mergeMode === "passthrough") return;
    const isReturn = USER_CONFIG.enableDomesticGroup && !USER_CONFIG.proxyFirst;
    const directDNS = isReturn ? CUSTOM_DNS_PROXY  : CUSTOM_DNS_DIRECT;
    const proxyDNS  = isReturn ? CUSTOM_DNS_DIRECT : CUSTOM_DNS_PROXY;
    const serverDNS = CUSTOM_DNS_SERVER;
    const sub = config.dns || {};
    const pick = (k, d) => sub[k] !== undefined ? sub[k] : d;

    // dnsListen 拆分：host/port 独立覆盖（支持只写 IP，端口沿用订阅）
    const splitHostPort = (s) => {
      if (!s) return { host: null, port: null };
      const v6Match = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
      if (v6Match) return { host: `[${v6Match[1]}]`, port: v6Match[2] || null };
      const idx = s.lastIndexOf(":");
      if (idx === -1) return { host: s, port: null };
      return { host: s.slice(0, idx), port: s.slice(idx + 1) };
    };
    const userL = splitHostPort(USER_CONFIG.dnsListen);
    const subL  = splitHostPort(sub.listen);
    const finalHost = userL.host || subL.host || "127.0.0.1";
    const finalPort = userL.port || subL.port || "1053";
    const finalListen = `${finalHost}:${finalPort}`;

    // fake-ip-filter：secure=blacklist 合并；whitelist 时 secure 用脚本、merge 用订阅
    const scriptFilter = ["*.lan", "*.local", "*.arpa", "time.*.com", "ntp.*.com", "localhost.ptlogin2.qq.com", "*.msftncsi.com", "www.msftconnecttest.com", "ipv6.msftncsi.com", "*.ipv6-literal.net", "google.cn", "*.music.163.com", "*.music.126.net", "+.stun.*.*", "+.nintendo.net", "+.playstation.net", "+.xboxlive.com"];
    const subMode = (sub["fake-ip-filter-mode"] || "blacklist").toLowerCase();
    const finalMode = mergeMode === "secure" ? "blacklist" : subMode;
    const subList = Array.isArray(sub["fake-ip-filter"]) ? sub["fake-ip-filter"] : [];
    const finalList = finalMode === "blacklist"
      ? dedupe([...scriptFilter, ...subList])
      : (mergeMode === "secure" ? scriptFilter : (subList.length ? subList : scriptFilter));

    // DNS 服务器：secure=脚本权威；merge=订阅优先脚本补缺
    const extractPolicyDNS = (policy) => {
      if (!policy || typeof policy !== "object") return [];
      return [...new Set(Object.values(policy).flat().filter(s => typeof s === "string"))];
    };
    const subProxyServer = sub["proxy-server-nameserver"]
      || (extractPolicyDNS(sub["nameserver-policy"]).length ? extractPolicyDNS(sub["nameserver-policy"]) : undefined)
      || serverDNS;
    const ns = mergeMode === "secure"
      ? { "default-nameserver": CUSTOM_DNS_DEFAULT, "direct-nameserver": directDNS, "direct-nameserver-follow-policy": true, "proxy-server-nameserver": serverDNS, "nameserver": proxyDNS }
      : { "default-nameserver": pick("default-nameserver", CUSTOM_DNS_DEFAULT), "direct-nameserver": pick("direct-nameserver", directDNS), "direct-nameserver-follow-policy": pick("direct-nameserver-follow-policy", true), "proxy-server-nameserver": subProxyServer, "nameserver": pick("nameserver", proxyDNS) };

    // nameserver-policy：secure=脚本 cn/non-cn 分流；merge=订阅 key 优先覆盖
    const scriptPolicy = { "rule-set:cn-domain": directDNS, "rule-set:non-cn": proxyDNS };
    const mergedPolicy = mergeMode === "secure" ? scriptPolicy : { ...scriptPolicy, ...(sub["nameserver-policy"] || {}) };

    config["dns"] = {
      enable: true,
      listen: finalListen,
      ipv6: USER_CONFIG.enableIPv6,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "fake-ip-filter-mode": finalMode,
      "fake-ip-filter": finalList,
      "respect-rules": true,
      "use-hosts": mergeMode === "secure" ? true : pick("use-hosts", true),
      "use-system-hosts": mergeMode === "secure" ? false : pick("use-system-hosts", false),
      ...ns,
      "nameserver-policy": mergedPolicy,
    };
  };
  if (USER_CONFIG.overwriteDns) applyDnsOverlay(config);

  // sniffer 注入
  if (USER_CONFIG.overwriteSniffer) {
    config["sniffer"] = {
      enable: true, "force-dns-mapping": true, "parse-pure-ip": true, "override-destination": true,
      sniff: { TLS: { ports: [443, 8443] }, HTTP: { ports: [80, "8080-8880"], "override-destination": true }, QUIC: { ports: [443, 4433] } }
    };
  }

  // 核心优化注入
  if (USER_CONFIG.enableCoreOptimize) {

    // 1. Profile 记忆模块 (属于 profile 对象)
    config["profile"] = {
      ...(config.profile || {}),
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
      if (isTargetType && isTlsEnabled && !p["client-fingerprint"]) p["client-fingerprint"] = "chrome";
      if (p.udp === undefined && p.type !== "http") p.udp = true;
    });
  }

  // =========================================================================
  // --- 📋 调试摘要：输出最终策略组分布与清洗统计 ---
  // =========================================================================
  // 1. 🧩 策略组容量分布（仅 debug 输出）：树状结构对齐排版
  const groups = config["proxy-groups"];
  if (groups.length > 0) {
    logger.debug(`📋 [策略组容量分布] (共 ${groups.length} 组):`);
    groups.forEach((g, idx) => {
      const isLast = idx === groups.length - 1;
      const branch = isLast ? '└──' : '├──';
      const typeTag = `[${g.type || 'select'}]`;
      const nodeCount = (g.proxies || []).length;
      logger.debug(`    ${branch} 📦 ${g.name} ${typeTag} : ${nodeCount} 个节点`);
    });
  }

  // 2. 动态计算真实的有效节点数量
  const validCount = processedData.length - (USER_CONFIG.removeInfoNodes ? 0 : infoCount);

  // 3. 基础统计
  const statsParts = [
    `有效节点: ${validCount}`,
    `策略组: ${config["proxy-groups"].length}`
  ];
  if (dedupeCount > 0) statsParts.push(`去重: ${dedupeCount}`);
  if (infoCount > 0) statsParts.push(`信息: ${infoCount}`);
  if (discardedCount > 0) statsParts.push(`丢弃: ${discardedCount}`);
  if (ipv6DroppedCount > 0) statsParts.push(`IPv6过滤: ${ipv6DroppedCount}`);
  if (BUCKETS.garbage && BUCKETS.garbage.length > 0) statsParts.push(`未识别: ${BUCKETS.garbage.length}`);

  logger.info(`📊 [统计摘要] ${statsParts.join(' | ')}`);

  // 4. 构建分流去向统计（包括家宽、高倍、特殊、下载、未识别、地区组）
  const flows = [];
  if (USER_CONFIG.enableResidential && BUCKETS.residential && BUCKETS.residential.length) 
    flows.push(`🏠 家宽 ${BUCKETS.residential.length}`);
  if (USER_CONFIG.isolateHighMulti && BUCKETS.highMulti && BUCKETS.highMulti.length) 
    flows.push(`🚀 高倍 ${BUCKETS.highMulti.length}`);
  if (BUCKETS.special && BUCKETS.special.length) 
    flows.push(`⭐ 特殊 ${BUCKETS.special.length}`);
  if (USER_CONFIG.isolateDownload && BUCKETS.download && BUCKETS.download.length) 
    flows.push(`⏬ 下载 ${BUCKETS.download.length}`);
  if (BUCKETS.garbage && BUCKETS.garbage.length) 
    flows.push(`🗑️ 未识别 ${BUCKETS.garbage.length}`);
  if (BUCKETS.other && BUCKETS.other.length) 
    flows.push(`🌐 其他 ${BUCKETS.other.length}`);

  // 地区组统计与细分
  const regionItems = Object.entries(REGION_NAMES)
    .filter(([k]) => BUCKETS[k] && BUCKETS[k].length > 0)
    .map(([k, name]) => {
      const icon = (name.match(/^(\p{Regional_Indicator}{2}|[\uD83C-\uDBFF\uDC00-\uDFFF\u2600-\u27BF])/u) || [name.split(' ')[0] || '📍'])[0];
      return {
        key: k,
        name: name,
        icon: icon,
        count: BUCKETS[k].length
      };
    });
  const regionTotal = regionItems.reduce((acc, r) => acc + r.count, 0);
  if (regionItems.length) flows.push(`🗺️ 地区组 ${regionTotal}`);

  if (flows.length) {
    logger.info(`🧩 [分流去向] ${flows.join(' | ')}`);
    if (regionItems.length) {
      logger.info(`    └── 🗺️ 地区分布: ${regionItems.map(r => `${r.icon} ${r.count}`).join(' | ')}`);
    }
  }

  // EOF: May your routing be fast and your connection secure. 🚀
  return config;
}

// 供 Node.js CommonJS 环境（如 CLI 工具）调用
if (typeof module !== 'undefined' && module.exports) module.exports = { main };
