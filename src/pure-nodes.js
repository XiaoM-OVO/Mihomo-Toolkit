/**
 * =========================================================================
 * 📦 Mihomo-Toolkit | 通用纯净节点清洗脚本 (Pure JS Edition) | MIT 许可证
 * =========================================================================
 * 🏷️ 版本: 1.2.4 (Build 2026.08.24)
 * 👤 作者: XiaoM-OVO
 * 🔌 环境: Node.js / Sub-Store / Surge / Loon / 浏览器 等(多端自适应)
 * 📝 描述: 零依赖跨平台节点处理核心，提供过滤、去重、重命名与自动排序功能。
 * 🛠️ 功能: 物理去重 | 垃圾归档 | 解析倍率与线路 | 批量前缀 | 特征识别 | 多维排序
 * 🌐 仓库: https://github.com/XiaoM-OVO/Mihomo-Toolkit
 * -------------------------------------------------------------------------
 */

// =========================================================================
// ⚙️ 用户自定义配置区 (全局默认设置)
// =========================================================================
const DEFAULT_CONFIG = {
    // ---------------------------------------------------------------------
    // 🚀 一、基础输出与模式控制
    // ---------------------------------------------------------------------
    outputMode: "array",          // 输出模式: "array"纯节点数组, "object"包含 meta 元数据的对象
    logLevel: "info",             // 日志级别: "silent" | "error" | "warn" | "info" | "debug"
    redactLevel: "partial",       // 日志脱敏级别: off | partial | full
    removeInfoNodes: false,       // 纯净模式: 直接删除"到期时间/剩余流量"等说明节点
    outputGarbage: false,         // 垃圾输出: 是否将拦截的广告/假节点也输出(默认不输出,但会进桶)
    outputUnknown: true,          // 未知输出: 是否将未识别的节点输出(默认输出)

    // ---------------------------------------------------------------------
    // 📝 二、命名模板与展示风格
    // ---------------------------------------------------------------------
    enableStandardRename: true,   // 标准化重命名: 关闭则保留节点原名(防吞词)
    
    // 🖨️ 节点命名模板变量说明 (自由组合，无数据时会自动清理多余空格与符号):
    // {prefix}   -> 自定义前缀 (如: "我的机场-")
    // {airport}  -> 提取的机场名 (如: "[AirportA]")
    // {icon}     -> 地区国旗 emoji (如: "🇺🇸")
    // {region}   -> 地区名称 (如: "美国", "香港")
    // {city}     -> 城市名称 (如: "洛杉矶" - 若无IP检测则提取原名城市)
    // {index}    -> 节点排序编号 (如: " 01", " 02")
    // {features} -> 解锁特征与图标 (如: "📺/流媒体", "🏠/家宽")
    // {protocol} -> 协议图标 Emoji (如: "🛩️", "🦊")
    // {transport}-> 传输层协议标签 (如: "WS", "H2", "GRPC")
    // {in}       -> 入口地区 (如: "深", "沪")
    // {line}     -> 线路特征 (如: "BGP/家宽")
    // {multi}    -> 倍率数值 (如: "x2.0")
    // {ip_stack} -> [网络层] 纯IPv6 或 双栈 标识 (如: "IPv6", "双栈")
    // {isp}      -> [IP补充] 运营商名称 (如: "Akamai", "Cloudflare")
    // {asn}      -> [IP补充] 自治系统编号 (如: "AS16509")
    // {org}      -> [IP补充] 组织/数据中心 (如: "Amazon.com", "Oracle")
    renameTemplate: "{prefix}{airport} {icon} {region} {index} {features} | {in} {city} {line} {multi} {ip_stack} · {transport}",
    renameSeparators: ["|", "-", "·", "/", "~", ":", ",", ";", "_", "=", "+", "*", ">", "<", "➩", "=>", "->"], // 🧹 允许作为分隔符被自动清理的悬空符号列表

    customPrefix: "",             // 批量自定义前缀 (也可通过 {prefix} 模板控制)
    showFeatureIcon: false,       // 替换特征文本为 Emoji (开启后"流媒体"变为📺)

    enableAirportTag: false,      // 提取原机场标签 (例: 提取 [AirportA] 并在同组节点排序)
    airportTag: "",               // 强制覆盖/指定所有节点的机场标签

    // ---------------------------------------------------------------------
    // 🧽 三、清洗、过滤与去重
    // ---------------------------------------------------------------------
    enableDedupe: false,          // 物理去重: 基于 服务器/端口/UUID 等多维度深度去重
    strictRegionMatch: false,     // 严格地区: 未知国旗不再动态捕获，直接丢入"未知"组
    adTextThreshold: 12,          // 广告阈值: 超过该长度且无特定特征视为广告
    whitelistKeywords: [],        // 白名单关键词: 包含即放行并保留原名，不参与脚本逻辑，例: ["跳过清洗", "直连节点"]
    blockKeywords: [],            // 黑名单关键词: 包含即拦截，例: ["免费领取", "点击购买"]
    blockServers: [],             // 黑名单服务器: 包含即拦截，例: ["123.123.123.123", "fake.com"]
    highMultiThreshold: 2.5,      // 高倍率软隔离: 超过此倍率的节点在同地区内自动下沉沉底
    specialNodeRules: [],         // 自定义重命名: 防止被当成垃圾节点扔掉，且跳过裂变，直接强行重命名,示例: { reg: /url.test|测速/i, targetName: "🚀 节点测速" }
    indexPrefixMap: {},           // 序号前缀映射: 键=订阅标签, 值=前缀(如 { "AirportA": "A", "AirportB": "B" })

    // ---------------------------------------------------------------------
    // 🧩 四、IP API 补充检测 (溯源与精准定位)
    // ---------------------------------------------------------------------
    enableIpEnrich: false,        // 🌍 API 总开关 (调用 ip-api.com)
    ipEnrichTimeout: 15000,       // 🌍 全局超时熔断(毫秒): 超过此时间仍未解析完成则强制放弃 API 增强并返回现有节点，防止死等
    ipApiKey: "",                 // 🔑 IP-API Pro 密钥 (选填)，如使用 pro.ip-api.com 请填写
    ipEnrichThreshold: 200,       // 🛡️ 安全熔断: 节点总数超过此值自动关闭检测，防止超时
    ipEnrichMode: "missing",      // 检测模式: "missing" 仅检测未知/无地区的节点; "all" 强制检测所有节点
    enableIpv6Tag: false,         // 🏷️ 启用 IPv6/双栈 识别 (开启后才会查询 AAAA 记录)
    enableCellularTag: false,     // 🏷️ 启用蜂窝网络识别
    enableResidentialTag: false,  // 🏷️ 启用家宽识别 (自动开启高精度 PTR 验证与白名单兜底)
    enableFission: false,         // 🚦 节点裂变 (将使用域名的节点裂变为多个IP节点。警告: 容易导致API限频和状态 429，请慎用)
    fissionStack: "all",          // 🚦 裂变栈偏好: "all" (保留所有), "v4" (只裂变 IPv4), "v6" (只裂变 IPv6)
    fissionMaxNodes: 4,           // 🚦 裂变阈值保护: 单个节点最多裂变为多少个子节点 (防止多IP域名导致节点数量暴增)
    fissionExcludeKeywords: ["负载均衡", "故障转移", "自动选择", "自动匹配", "最优选择"], // 🚦 裂变黑名单: 包含这些关键词的节点将跳过裂变
    ipApiEndpoint: "http://ip-api.com/batch", // IP 库接口: 替换为可解除 https://pro.ip-api.com/batch
    ipApiBatchSize: 100,          // 批量请求上限: 免费版限制为 100，如遇 429 报错可调低
    ipApiBatchDelay: 4000,        // 批次间隔(毫秒): 免费版限制 15次/分钟，设为 4000 可严格防 429
    ipApiDnsConcurrency: 15,      // DNS 并发数: 控制 DoH 解析的瞬间并发量，防止请求过载
    ipApiDnsEndpoint: "",         // DoH 解析端点: 留空则自动选择 (阿里 DNS → Google DNS 兜底)
};

// =========================================================================
// 🪛 核心常量与正则字典 (Global)
// =========================================================================
const REGEX_ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g;
const REGEX_INFO_NODE = /剩余流量|套餐到期|到期时间|有效时间|已过期|即将过期|更新公告|流量重置|重置时间|维护公告|不可用|扣费|节点说明|防失联|官网|官网地址|网址地址|Q群|电报|Tg群|距离下次|关注频道|官方群组|签到获取/i;
const REGEX_FORBID_DL_STR = "(?:禁止|禁|严禁|请勿|勿|不要|不能|拒绝|屏蔽|防)(?:BT|PT|P2P|下载|测速|迅雷)|(?:仅限|仅供)(?:网页|日常|聊天)|\\b(?:No|Block|Ban)[\\s\\-_]*(?:BT|PT|Torrent|Download)\\b";
const REGEX_CLEANUP = new RegExp(`\\b(?:https?:\\/\\/|www\\.)[a-zA-Z0-9][-a-zA-Z0-9]{1,62}\\.(?:com|net|org|cc|me|vip|pro|top|xyz|club)\\b`, "ig");
const REGEX_ENTRY_CITY = /(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|SZX|CAN|PVG|SHA|PEK|PKX|HGH|入口|Ingress)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|澳|落地|出口|Exit)/i;
const REGEX_MULTI = /(?:倍率|Rate)\s*[:：]?\s*(\d+(?:\.\d+)?)|(?<![a-zA-Z])(?:[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍率|倍)?|(\d+(?:\.\d+)?)\s*(?:[xX×]|倍率|倍))(?!\s*\d)/i;

const REGEX_TECH_LINE = /(IEPL|IPLC|CMIN2|CMI|CN2\s*GIA|CN2|GIA|9929|4837|CUG|BGP|AWS|GCP|Oracle|Azure|Hinet|Zenlayer|IIJ|NTT|OCN|Softbank|Transit|Relay|隧道|Direct|HGC|HKBN|PCCW|WTT|HKT|CTCUCM|CTCUM|CTCU|CUCT|CMCU|CTCM|CMCT|三网|电联|移联|电移|移动|联通|电信|专线|测试|实验|备用|测速)/gi;
const REGEX_FLUFF_LINE = /(高速|极速|优化|起飞|VIP|Premium|Pro|Plus|标准|基础|高级|节点)/gi;
const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;
const REGEX_ALL_FLAGS = /\p{Regional_Indicator}{2}/gu;

const REGEX_FAKE_IP = /^(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|198\.1[8-9]\.|1\.1\.1\.1|8\.8\.8\.8|1\.2\.3\.4|2\.2\.2\.2|3\.3\.3\.3)/;
const REGEX_DUMMY_AUTH = /^(0{8}-0{4}-0{4}-0{4}-0{12}|123456|password|dummy)$/i;

const UI_ICONS = {
    protocols: { 
        "ss": "🛩️", "ssr": "🚀", "vmess": "🦊", "vless": "🛸", "trojan": "🐴", 
        "hysteria": "⚡", "hysteria2": "⚡", "tuic": "💨", "wireguard": "🕸️", 
        "snell": "📡", "socks": "🧦", "socks5": "🧦", "http": "🌐", "https": "🌐", 
        "ssh": "💻", "xray": "☢️", "shadowtls": "🛡️", "reality": "🎭"
    },
    features: {
        "家宽": "🏠", "游戏": "🎮", "流媒体": "📺", "下载": "⏬", "免费": "🆓",
        "gpt": "🤖", "gemini": "♊", "claude": "🦀", "ai": "✨",
        "nf": "🎬", "d+": "🐭", "yt": "▶️", "tk": "🎵", "sp": "🎧",
        "no_download": "🚫", "cdn": "☁️", "CDN": "☁️", "aws": "🛰️", "AWS": "🛰️", "蜂窝": "📱"
    }
};

const FEATURE_TEXT_MAP = {
    "residential": "家宽", "game": "游戏", "streaming": "流媒体",
    "gemini": "Gemini", "claude": "Claude", "chatgpt": "GPT", "ai": "AI",
    "download": "下载", "free": "免费", "no_download": "禁止下载",
    "cellular": "蜂窝", "ipv6": "IPv6", "dualstack": "双栈"
};

const STREAMING_SERVICES = [
    { keys: ["Netflix", "NF", "奈飞", "网飞", "耐飞"], abbr: "NF" },
    { keys: ["Disney\\+", "Disney", "迪士尼", "D\\+"], abbr: "D+" },
    { keys: ["YouTube", "YT", "油管"], abbr: "YT" },
    { keys: ["TikTok", "抖音海外", "抖音", "TT"], abbr: "TT" },
    { keys: ["Spotify", "声田"], abbr: "SP" },
];
const STREAMING_GENERIC = ["流媒体", "解锁"];

const STREAMING_SOURCE = [
    ...STREAMING_SERVICES.flatMap(s => s.keys),
    ...STREAMING_GENERIC
].map(k => {
    return /[\u4e00-\u9fa5]/.test(k) ? `(?:${k})` : `\\b(?:${k})\\b`;
}).join("|");

const STREAMING_ABBR = {};
STREAMING_SERVICES.forEach(s => s.keys.forEach(k => {
    STREAMING_ABBR[k.replace(/\\/g, "").toLowerCase()] = s.abbr;
}));

const FEATURE_RULES_RAW = [
    { source: REGEX_FORBID_DL_STR, tag: "no_download" }, 
    { source: "(?:家宽|住宅|宽带|原生|🏠|Residential|ISP|Home|HKT|HKBN|HGC|WTT|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|So[-_]?net|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)", tag: "residential" },
    { source: "(?:游戏)|Game|FullCone", tag: "game" },
    { source: "(?:下载)|BT", tag: "download" },
    { source: "(?:免费|白嫖|公益)", tag: "free" },
    { source: "\\b(?:Gemini)\\b", tag: "gemini" },
    { source: "\\b(?:Claude)\\b", tag: "claude" },
    { source: "\\b(?:ChatGPT|OpenAI|GPT)\\b", tag: "chatgpt" },
    { source: "\\b(?:AI(?:解锁|访问|加速|代理)?)\\b", tag: "ai" },
    { source: "\\b(?:IPv6)\\b", tag: "ipv6" },
    { source: "(?:双栈|DualStack)", tag: "dualstack" },
    { source: "(?:蜂窝|Cellular|移动网络)", tag: "cellular" },
    { source: STREAMING_SOURCE, tag: "streaming" }
];
const FEATURE_RULES = FEATURE_RULES_RAW.map(r => ({
    source: r.source,
    reg: new RegExp(r.source, "i"),
    _cleanReg: new RegExp(r.source, "ig"),
    tag: r.tag
}));

/* ↓↓↓↓↓ INJECT_BEGIN ↓↓↓↓↓ */
const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信|香港|台湾|日本|韩国|新加坡|美国|英国|德国|法国|澳洲|英|德|法|澳|美|日|韩|新|港|台)";
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

REGION_DEFS.forEach(r => {
    const combinedSource = r.city ? `${r.reg.source}|${r.city}` : r.reg.source;
    r._cleanReg = new RegExp(combinedSource, "ig");
    r._matchReg = new RegExp(combinedSource, "i");
    r._cityReg = r.city ? new RegExp(r.city, "i") : null;
});
/* ↑↑↑↑↑ INJECT_END ↑↑↑↑↑ */

function operator(proxies, targetPlatform, userConfig = {}) {

    if (!Array.isArray(proxies)) proxies = [];

    // =========================================================================
    // ⚙️ 初始化配置 (融合顶层默认配置与外部传入配置)
    // =========================================================================
    const CONFIG = { ...DEFAULT_CONFIG, ...userConfig };

    const LOG_LEVELS = { "silent": 0, "error": 1, "warn": 2, "info": 3, "debug": 4 };
    const currentLogLevel = LOG_LEVELS[CONFIG.logLevel] ?? 3;

    let redactLevel = CONFIG.redactLevel || 'partial';

    function redact(obj) {
        if (redactLevel === 'off' || redactLevel === 'partial') return obj;
        if (typeof obj === 'string') {
            return obj.replace(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g, '***.***.***.***')
                      .replace(/\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g, '***.***')
                      .replace(/\b([A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g, '***:***');
        }
        return obj;
    }

    const logger = {
        debug: (...args) => { if (currentLogLevel >= 4) console.log("[Pure]    DBG  " + args.map(redact).join(' ')); },
        info:  (...args) => { if (currentLogLevel >= 3) console.log("[Pure]    INFO " + args.map(redact).join(' ')); },
        warn:  (...args) => { if (currentLogLevel >= 2) console.warn("[Pure]    WARN " + args.map(redact).join(' ')); },
        error: (...args) => { if (currentLogLevel >= 1) console.error("[Pure]    ERR  " + args.map(redact).join(' ')); }
    };

    logger.info("pure-nodes v1.2.4 已加载");

    // =========================================================================
    // 🪛 构建动态字典
    // =========================================================================

    const CN_MAP   = { "移动": "移", "联通": "联", "电信": "电", ...(CONFIG.cnMap || {}) };
    const LINE_MAP = { "CTCUCM": "三网", "CTCUM": "三网", "CTCU": "电联", "CUCT": "电联", "CMCU": "移联", "CUCM": "移联", "CTCM": "电移", "CMCT": "电移", ...(CONFIG.lineMap || {}) };
    const TAG_MAP = {
        "深圳": "深", "SZX": "深", "广州": "广", "CAN": "广",
        "上海": "沪", "PVG": "沪", "SHA": "沪", "北京": "京",
        "PEK": "京", "PKX": "京", "杭州": "杭", "HGH": "杭",
        "四川": "川", "江苏": "苏", "宁波": "甬", "东莞": "莞",
        "南京": "宁", "成都": "蓉", "武汉": "汉", "重庆": "渝", "天津": "津",
        ...(CONFIG.tagMap || {})
    };



    // =========================================================================
    // 🛠️ 辅助函数
    // =========================================================================
    function cleanIspName(str) {
        if (!str) return "";
        return str.replace(/,\s*(Inc|LLC|Ltd|Corp)\.?/ig, "")
                .replace(/\b(Technologies|Communications|Services|Network|Cloud)\b/ig, "")
                .replace(/\s{2,}/g, " ")
                .trim();
        }

    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function sanitizeNodeName(rawName) {
        let name = rawName.replace(REGEX_ZERO_WIDTH, "");
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

    function compressLineArr(arr) {
        const FULL_SET = new Set(["电信", "移动", "联通"]);
        const SHORT_MAP = { "电信": "电", "移动": "移", "联通": "联" };
        const atomSet = new Set(Object.values(SHORT_MAP));
        const comboMap = {
            "电联": new Set(["电","联"]), "移联": new Set(["移","联"]),
            "电移": new Set(["电","移"]), "三网": new Set(["移","联","电"])
        };

        const deduped = [...new Set(arr)];
        let carrierItems = [], nonCarrierItems = [];
        for (let item of deduped) {
            if (FULL_SET.has(item) || atomSet.has(item)) {
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
            merged = matchCombo ? [matchCombo[0]] : [...new Set(carrierItems)];
        } else if (carrierCount === 1) {
            const single = [...new Set(carrierItems)][0];
            const fullName = Object.keys(SHORT_MAP).find(k => SHORT_MAP[k] === single);
            merged = [fullName];
        }

        return [...merged, ...nonCarrierItems];
    }

    function extractNodeAttributes(name) {
        let attrs = { multiStr: "", entryStr: "", lineArr: [], multiNum: 1.0, bestLineWeight: 99, ispStr: "", asnStr: "" };
        
        // 0. 提取 ISP 和 ASN 信息 (避免被当成无用后缀丢弃)
        name = name.replace(/(Akamai|Cloudflare|Amazon|AWS|Oracle|Google|Microsoft|Tencent|Alibaba|DigitalOcean|Linode|Hetzner|OVH|Vultr|Fastly|Edgio|Gcore|Misaka|Kirino)/i, match => {
            attrs.ispStr = match;
            return "";
        });
        name = name.replace(/AS\d{2,6}/i, match => {
            attrs.asnStr = match.toUpperCase();
            return "";
        });

        // 1. 提取并擦除入口城市
        name = name.replace(REGEX_ENTRY_CITY, (match, p1) => {
            let m = (p1 || match).replace(/[-|>至=\s]/g, "");
            attrs.entryStr = TAG_MAP[m.toUpperCase()] || TAG_MAP[m] || m;
            return "";
        });

        // 2. 提取并擦除倍率
        let cleanName = name.replace(REGEX_MULTI, (m, m1, m2, m3) => {
            const num = parseFloat(m1 || m2 || m3);
            if (!isNaN(num)) {
                attrs.multiNum = num;
                if (num !== 1) attrs.multiStr = `x${num}`;
            }
            return "";
        });

        // 3. 提取线路类型
        let fluffStr = "";
        cleanName = cleanName.replace(REGEX_FLUFF_LINE, match => { fluffStr += match.toUpperCase(); return ""; });

        const techTerms = [];
        cleanName = cleanName.replace(REGEX_TECH_LINE, match => {
            let key = match.toUpperCase();
            techTerms.push(key);
            let short = LINE_MAP[key];
            if (!short) {
                const cnKey = Object.keys(CN_MAP).find(k => match.includes(k));
                if (cnKey) short = cnKey; // 先存全称：电信/移动/联通
            }
            if (short) attrs.lineArr.push(short);
            else if (match.length >= 2) attrs.lineArr.push(key);
            return "";
        });

        attrs.lineArr = compressLineArr(attrs.lineArr);
        attrs.cleanLines = [...new Set(attrs.lineArr)].join("/");

        const weightSource = techTerms.join(" ") + " " + fluffStr;
        attrs.bestLineWeight = /(IEPL|IPLC)/.test(weightSource) ? 1 :
                              /(GIA|CN2|9929|CMIN2)/.test(weightSource) ? 2 :
                              /(专线|VIP|PRO|高速|极速|优化|PREMIUM)/.test(weightSource) ? 3 :
                              /(BGP|CMI)/.test(weightSource) ? 4 :
                              /(中转|隧道)/.test(weightSource) ? 5 : 6;
        
        return { attrs, cleanName };
    }

    function matchNodeRegion(name) {
        const matchedRegions = REGION_DEFS.map(r => {
            const m = name.match(r._matchReg);
            return m ? { def: r, len: m[0].length, index: m.index } : null;
        }).filter(Boolean);

        if (matchedRegions.length > 0) {
            const bestMatch = matchedRegions.reduce((prev, curr) => {
                if (curr.len !== prev.len) return curr.len > prev.len ? curr : prev;
                return curr.index > prev.index ? curr : prev;
            }, matchedRegions[0]);
            return bestMatch?.def || null;
        }

        if (!CONFIG.strictRegionMatch) {
            const flagMatch = name.match(REGEX_UNKNOWN_FLAG);
            if (flagMatch) {
                const dynamicName = flagMatch[2].trim();
                return { 
                    id: "other", 
                    icon: flagMatch[1], 
                    name: dynamicName,
                    isUnknown: true,
                    _cleanReg: new RegExp(escapeRegExp(dynamicName), "ig"),
                    _matchReg: new RegExp(escapeRegExp(dynamicName), "i"),
                    _cityReg: null
                };
            }
        }
        return null;
    }

    function getAirportTag(rawName, proxy) {
        if (!CONFIG.enableAirportTag) return "";

        // 1. 优先读 builder 注入的 _subTag 字段（full 模式，符号无关）
        if (proxy && proxy._subTag) return proxy._subTag;

        // 2. 关键词强制抓取（split 场景：用户配置 airportTag 关键词列表）
        if (CONFIG.airportTag) {
            const tags = CONFIG.airportTag.split(",").map(t => t.trim()).filter(Boolean);
            for (const t of tags) {
                if (rawName.includes(t)) return t;
            }
        }

        // 3. 正则兜底（split/单跑场景：上游或机场自带的 [] 等包裹符号）
        const regStr = CONFIG.airportTagReg;
        let reg = /^\[([^\]]{1,8})\]/i;
        try {
            if (typeof regStr === 'string') { const m = regStr.match(/^\/(.*?)\/([a-z]*)$/); reg = m ? new RegExp(m[1], m[2]) : new RegExp(regStr, 'i'); } else if (regStr instanceof RegExp) { reg = regStr; }
        } catch (e) {
            reg = /^\[([^\]]{1,8})\]/i;
        }
        const m = rawName.match(reg);
        return m ? (m[1] || m[0]) : "";
    }

    function formatTagDisplay(rawName) {
        const tag = getAirportTag(rawName);
        if (!tag) return { display: rawName, tagDisplay: "" };
        const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const display = rawName.replace(new RegExp(`^\\[${escapedTag}\\]\\s*`, 'i'), '');
        return { display, tagDisplay: `🏷️${tag} | ` };
    }

    function deepCloneSimple(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(item => deepCloneSimple(item));
        const cloned = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                cloned[key] = deepCloneSimple(obj[key]);
            }
        }
        return cloned;
    }

    function normalizeProxyFields(originalProxy, platform) {
        let newProxy;
        try {
            if (typeof structuredClone === "function") {
                newProxy = structuredClone(originalProxy);
            } else {
                newProxy = JSON.parse(JSON.stringify(originalProxy));
            }
        } catch (e) {
            newProxy = deepCloneSimple(originalProxy);
        }
        
        if (!platform || platform === "clash") return newProxy;
        
        const aliasMap = {
            sni: ["sni", "servername", "server-name", "tls.servername", "peer"],
            host: ["host", "hostname", "http-host"],
            password: ["password", "auth", "key"],
            uuid: ["uuid", "id", "user-id", "client_id"],
            port: ["port", "listen-port"],
            server: ["server", "address", "hostname"]
        };
        
        for (const [standard, aliases] of Object.entries(aliasMap)) {
            if (newProxy[standard] === undefined || newProxy[standard] === null) {
                for (const alias of aliases) {
                    if (newProxy[alias] !== undefined && newProxy[alias] !== null) {
                        newProxy[standard] = newProxy[alias];
                        break;
                    }
                }
            }
        }
        return newProxy;
    }

    // =========================================================================
    // 🧩 IP API 补充检测
    // =========================================================================

    /**
     * 判断是否为私有/保留 IP 地址
     */
    function isPrivateIP(ip) {
        if (!ip || typeof ip !== 'string') return true;

        // IPv4 检测
        const v4Parts = ip.trim().split('.').map(Number);
        if (v4Parts.length === 4 && !v4Parts.some(isNaN)) {
            if (v4Parts[0] === 10) return true;
            if (v4Parts[0] === 127) return true;
            if (v4Parts[0] === 0) return true;
            if (v4Parts[0] === 100 && v4Parts[1] >= 64 && v4Parts[1] <= 127) return true;
            if (v4Parts[0] === 172 && v4Parts[1] >= 16 && v4Parts[1] <= 31) return true;
            if (v4Parts[0] === 192 && v4Parts[1] === 168) return true;
            return false;
        }

        // IPv6 检测
        const v6 = ip.trim().toLowerCase();
        if (v6 === '::1' || v6 === '::') return true;
        if (/^fe[89ab][0-9a-f]{2}:/i.test(v6)) return true; // link-local fe80::/10
        if (/^f[cd][0-9a-f]{2}:/i.test(v6)) return true; // ULA fc00::/7
        // IPv4-mapped IPv6: ::ffff:10.x.x.x 等
        const v4Match = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (v4Match) return isPrivateIP(v4Match[1]);
        // 既不是合法 IPv4，也不是合法 IPv6 的无效字符串 → 实施拦截
        return !v6.includes(':');
    }

    /**
     * 简单域名检测
     */
    function looksLikeDomain(str) {
        return /^[a-zA-Z0-9][-a-zA-Z0-9]{0,61}(\.[a-zA-Z0-9][-a-zA-Z0-9]{0,61})+$/.test(str);
    }

    /**
     * 获取可用的 HTTP 客户端
     */
    function getHttpClient() {
        if (typeof $http !== 'undefined') return $http;
        if (typeof fetch === 'function') return { fetch };
        return null;
    }

    /**
     * 获取系统 DNS（Node.js 环境才有）
     */
    function getSystemDns() {
        try {
            if (typeof require !== 'undefined') return require('dns');
        } catch {}
        return null;
    }

    /**
     * DNS 解析域名到 IP
     * 策略：优先系统 DNS（不被墙），次选 DoH（阿里 DNS → Google DNS 兜底）
     */
    async function resolveDomainToIp(domain, http) {
        if (!looksLikeDomain(domain)) return { ip: domain, ips: [domain], stack: domain.includes(':') ? "v6" : "v4" };

        // 方案一：Node.js 系统 DNS（直连，不受墙影响）
        const sysDns = getSystemDns();
        if (sysDns) {
            try {
                const results = await sysDns.promises.lookup(domain, { all: true }); 
                if (results && results.length > 0) {
                    const allIps = [...new Set(results.map(r => r.address))].filter(ip => !REGEX_FAKE_IP.test(ip));
                    if (allIps.length === 0) throw new Error("DNS lookup returned only fake IPs");
                    const hasV4 = allIps.some(ip => ip.includes('.'));
                    const hasV6 = allIps.some(ip => ip.includes(':'));
                    const stack = (hasV4 && hasV6) ? "dual" : (hasV6 ? "v6" : "v4");
                    const ip = hasV4 ? allIps.find(ip => ip.includes('.')) : allIps[0];
                    return { ip, ips: allIps, stack };
                }
            } catch {}
        }

        // 方案二：DoH 多端点兜底（阿里优先，国内可达；尝试 A 和 AAAA；Google 备用）
        async function queryDoh(type) {
            const urls = CONFIG.ipApiDnsEndpoint
                ? [CONFIG.ipApiDnsEndpoint]
                : [
                    `https://dns.alidns.com/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
                    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`
                ];
            for (const url of urls) {
                try {
                    let data;
                    if (http && http.fetch) {
                        const resp = await http.fetch(url, { signal: AbortSignal.timeout(2000) });
                        data = await resp.json();
                    } else {
                        data = await new Promise((resolve, reject) => {
                            const timer = setTimeout(() => reject(new Error('timeout')), 2000);
                            http.get({ url }, (err, resp) => {
                                clearTimeout(timer);
                                if (err) return reject(err);
                                try { resolve(typeof resp === 'string' ? JSON.parse(resp) : resp); }
                                catch (e) { reject(e); }
                            });
                        });
                    }
                    const answer = data?.Answer || [];
                    const records = answer.filter(r => r.type === (type === 'A' ? 1 : 28)).map(r => r.data);
                    if (records.length > 0) return records;
                } catch {}
            }
            return [];
        }

        const promises = [queryDoh('A')];
        if (CONFIG.enableIpv6Tag || CONFIG.enableFission) promises.push(queryDoh('AAAA'));

        const [v4Res, v6Res] = await Promise.all(promises);
        
        let allIps = [];
        if (v4Res) allIps.push(...v4Res);
        if (v6Res) allIps.push(...v6Res);
        allIps = [...new Set(allIps)];

        if (allIps.length > 0) {
            const hasV4 = allIps.some(ip => ip.includes('.'));
            const hasV6 = allIps.some(ip => ip.includes(':'));
            const stack = (hasV4 && hasV6) ? "dual" : (hasV6 ? "v6" : "v4");
            const ip = hasV4 ? allIps.find(ip => ip.includes('.')) : allIps[0];
            return { ip, ips: allIps, stack };
        }
        
        return null;
    }

    /**
     * 批量查询 IP 地理信息
     */
    async function batchQueryIps(ips, http) {
        if (ips.length === 0) return [];
        
        // 动态拼接 URL 和 API 密钥
        const keyParam = CONFIG.ipApiKey ? `&key=${encodeURIComponent(CONFIG.ipApiKey)}` : "";
        const url = `${CONFIG.ipApiEndpoint}?fields=status,country,countryCode,city,isp,as,asname,org,reverse,query,proxy,hosting,mobile&lang=zh-CN${keyParam}`;
        const body = JSON.stringify(ips);

        let retries = 3; // 最大重试次数
        
        while (retries > 0) {
            try {
                let data;
                
                // --- 🚀 Node.js / Sub-Store 新版 (支持 fetch) 环境 ---
                if (http && http.fetch) {
                    const resp = await http.fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body,
                        signal: AbortSignal.timeout(10000)
                    });
                    
                    // 🟡 拦截 429 限流，精准等待 X-Ttl 秒
                    if (resp.status === 429) {
                        retries--;
                        const ttl = Math.min(parseInt(resp.headers.get('X-Ttl') || '5', 10), 60); 
                        logger.warn(`触发 429 限流，脚本将挂起等待 ${ttl} 秒... (剩余重试: ${retries})`);
                        if (retries === 0) break; 
                        
                        await new Promise(resolve => setTimeout(resolve, (ttl + 1) * 1000));
                        continue; // 醒来后继续循环重试
                    }

                    if (!resp.ok) {
                        const snippet = await resp.text().catch(() => '');
                        logger.warn(`ip-api 返回 HTTP ${resp.status}: ${snippet.slice(0, 100)}`);
                        return [];
                    }
                    data = await resp.json();
                } 
                // --- 🐢 Surge / Loon / Sub-Store 旧版环境兼容 ---
                else {
                    data = await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('timeout')), 10000);
                        const reqOpts = { url, body, headers: { 'Content-Type': 'application/json' } };
                        
                        const callback = (err, resp, bodyData) => {
                            clearTimeout(timer);
                            if (err) return reject(err);
                            
                            // 兼容多端回调结构
                            let status = resp?.status || resp?.statusCode || 200;
                            let resBody = bodyData || resp;
                            
                            if (status === 429) return resolve({ _is429: true }); // 标记为 429
                            
                            try { resolve(typeof resBody === 'string' ? JSON.parse(resBody) : resBody); }
                            catch (e) { reject(e); }
                        };

                        if (typeof $httpClient !== 'undefined') $httpClient.post(reqOpts, callback);
                        else if (http.post) http.post(reqOpts, callback);
                        else reject(new Error("No valid HTTP client found"));
                    });

                    // 🟡 旧版环境 429 处理 (读不到 Header，固定等 6 秒)
                    if (data && data._is429) {
                        retries--;
                        logger.warn(`触发 429 限流，挂起等待 6 秒... (剩余重试: ${retries})`);
                        if (retries === 0) break;
                        await new Promise(resolve => setTimeout(resolve, 6000));
                        continue;
                    }
                }

                // 返回成功的数据
                return Array.isArray(data) ? data : [];
                
            } catch (e) {
                logger.warn(`批量查询请求失败: ${e.message}`);
                return []; // 彻底失败直接跳出，不盲目重试
            }
        }
        return [];
    }

    /**
     * countryCode → 地区名映射
     */
    const IP_COUNTRY_MAP = {
        "HK": "香港", "JP": "日本", "KR": "韩国", "SG": "新加坡",
        "US": "美国", "GB": "英国", "DE": "德国", "FR": "法国",
        "NL": "荷兰", "RU": "俄罗斯", "TR": "土耳其", "AR": "阿根廷",
        "MY": "马来西亚", "AU": "澳大利亚", "TH": "泰国",
        "ID": "印尼", "VN": "越南", "BR": "巴西", "PH": "菲律宾",
        "CA": "加拿大", "IT": "意大利", "ES": "西班牙", "SE": "瑞典",
        "IN": "印度", "MO": "澳门", "TW": "台湾", "CN": "中国"
    };

    /**
     * 🆕 城市→地区映射（从 REGION_DEFS 自动构建，用于中转节点防覆盖）
     * 支持：城市名（深圳）、简写（深）、地区名（香港）
     */
    const CITY_TO_REGION = (() => {
        const map = {};
        REGION_DEFS.forEach(region => {
            if (region.city) {
                region.city.split('|').forEach(city => {
                    map[city] = region.name;
                    const short = TAG_MAP[city.toUpperCase()] || TAG_MAP[city] || "";
                    if (short) map[short] = region.name;
                });
            }
            map[region.name] = region.name;
            if (region.id) map[region.id.toUpperCase()] = region.name;
        });
        return map;
    })();

    /**
     * 🆕 识别是否为知名 CDN/Anycast 供应商
     */
    function isCdnOrAnycast(ipInfo) {
        if (!ipInfo) return false;
        const targetStr = `${ipInfo.isp} ${ipInfo.org} ${ipInfo.as}`.toLowerCase();
        const cdnKeywords = [
            'cloudflare', 'cloudfront', 'fastly', 'akamai', 'gcore', 
            'imperva', 'edgio', 'ddos-guard', 'sucuri', 'incapsula',
            'amazon', 'aws'   // AWS/骁云等云厂商：和 CDN 一桌，不信任其反查定位
        ];
        return cdnKeywords.some(kw => targetStr.includes(kw));
    }

    /**
     * 向节点应用 IP 检测结果
     */
    function enrichNodeRegion(item, ipInfo) {
        if (item.isInfo || item.isGarbage) return;

        const isCDN = isCdnOrAnycast(ipInfo);
        if (isCDN) {
            // CDN 走通用 ☁️ 标；AWS/云厂家单独 🛰️ 标，两不同供应商透明区分
            const isAws = /(amazon|aws)/.test(`${ipInfo.isp} ${ipInfo.org} ${ipInfo.as}`.toLowerCase());
            const tag = isAws ? "aws" : "cdn";
            const feat = isAws ? "AWS" : "CDN";
            if (!item.tags.includes(tag)) item.tags.push(tag);
            if (!item.specificFeatures.includes(feat)) item.specificFeatures.push(feat);
        }

        // --- 1. 保存 IP 元数据与特征打标 (无视地区覆盖策略，只要进来了就必打标) ---
        item._ipSource = true;
        if (ipInfo.isp) item._ipIsp = ipInfo.isp;
        if (ipInfo.as) item._ipAsn = ipInfo.as;
        if (ipInfo.asname) item._ipAsname = ipInfo.asname;
        if (ipInfo.org) item._ipOrg = ipInfo.org;

        if (CONFIG.enableIpv6Tag || CONFIG.enableCellularTag || CONFIG.enableResidentialTag) {
            if (CONFIG.enableIpv6Tag) {
                const stack = item._ipStack || (ipInfo.query && ipInfo.query.includes(':') ? "v6" : "v4");
                if (stack === "dual") {
                    if (!item.tags.includes("dualstack")) item.tags.push("dualstack");
                } else if (stack === "v6") {
                    if (!item.tags.includes("ipv6")) item.tags.push("ipv6");
                }
            }

            if (!isCDN) {
                if (CONFIG.enableCellularTag && ipInfo.mobile) {
                    if (!item.tags.includes("cellular")) item.tags.push("cellular");
                    if (!item.specificFeatures.includes("蜂窝")) item.specificFeatures.push("蜂窝");
                } else if (CONFIG.enableResidentialTag && ipInfo.hosting === false) {
                    let isRes = false;
                    const ptr = (ipInfo.reverse || "").toLowerCase();
                    const isp = (ipInfo.isp || "").toLowerCase();
                    
                    if (/(dyn|broadband|dsl|cable|dialup|pppoe|pool|client|user|customer|dynamic|dhcp|hinet-ip|telecom|host|netvigator|dip0)/i.test(ptr)) {
                        isRes = true;
                    } else if (/(comcast|verizon|spectrum|att|cox|hinet|kbro|seednet|aptg|so-net|nuro|ocn|plala|singtel|starhub|myrepublic|netvigator|ctm|viewqwest|hkbn|hkt)/i.test(isp)) {
                        isRes = true;
                    }

                    if (isRes) {
                        if (!item.tags.includes("residential")) item.tags.push("residential");
                        if (!item.specificFeatures.includes("家宽")) item.specificFeatures.push("家宽");
                    }
                }
            }
        }

        // 如果用户只在 "missing" 模式，且节点已有合法地区，则在此终止，不进行后续覆盖
        if (CONFIG.ipEnrichMode !== "all" && item.regionInfo && !item.regionInfo.isUnknown) return;

        // 🛡️ all 模式专属：CDN / 中转节点防覆盖保护
        if (CONFIG.ipEnrichMode === "all") {
            if (isCDN && item.regionInfo && !item.regionInfo.isUnknown) {
                logger.info(`🛡️ 触发防覆盖: [${item.rawName}] 查出为 CDN(${ipInfo.org})，放弃使用其虚假定位(${ipInfo.country})`);
                return;
            }

            const entryRegion = CITY_TO_REGION[item.attrs?.entryStr];
            const ipRegion = IP_COUNTRY_MAP[ipInfo.countryCode];
            if (entryRegion && ipRegion && entryRegion === ipRegion) {
                const hasExit = REGION_DEFS.some(r => r.name !== entryRegion && r._matchReg.test(item.rawName));
                if (hasExit) {
                    logger.info(`🛡️ 中转节点保护: [${item.rawName}] 入口=${item.attrs.entryStr}→${entryRegion},IP=${ipRegion}，跳过覆盖`);
                    return;
                }
            }
        }

        let regionName = IP_COUNTRY_MAP[ipInfo.countryCode];
        let def = regionName ? REGION_DEFS.find(r => r.name === regionName) : null;

        // 动态兜底：未预定义的地区自动生成国旗 emoji 和区域条目
        if (!def && ipInfo.countryCode && ipInfo.country) {
            if (CONFIG.strictRegionMatch) {
                logger.info(`🛡️ 严格模式拦截: IP查出未定义地区(${ipInfo.country})，按规则拒绝为其动态建组`);
                return;
            }
            regionName = ipInfo.country;
            const icon = String.fromCodePoint(
                0x1F1E6 + ipInfo.countryCode.charCodeAt(0) - 65,
                0x1F1E6 + ipInfo.countryCode.charCodeAt(1) - 65
            );
            def = { name: regionName, icon, _fromDynamic: true, _cleanReg: new RegExp("", "g") };
            logger.info(`🆕 动态新增未预定义地区: ${icon} ${regionName} (${ipInfo.countryCode})`);
        }

        if (!def) return;

        // 保存旧地区名，用于后续判断是否需要清除旧城市
        const oldRegionName = item.regionInfo?.name;

        item.regionInfo = {
            name: def.name,
            icon: def.icon,
            _fromIp: true,
            _cleanReg: def._cleanReg,
            _matchReg: def._matchReg || new RegExp(def.name, "i"),
            _cityReg: def._cityReg || null,
            _ipCity: ipInfo.city || "",
            _isDynamic: !!def._fromDynamic,
        };

        // 如果 IP 查到了更精确的城市，且跟名字里的城市不一样，则替换它
        if (ipInfo.city && item._destCity && ipInfo.city.toLowerCase() !== item._destCity.toLowerCase()) {
            logger.info(`📍 城市校准: [${item._destCity}] -> [${ipInfo.city}]`);
            // 更新为 IP 查到的真实城市
            item._destCity = ipInfo.city; 
        }

        // 同步更新 groupKey，确保排序编号基于新地区
        item.groupKey = (item.airportTag ? item.airportTag + "__" : "") + def.name;
    }

    /**
     * IP API 补充检测主流程：收集 → 熔断检测 → DNS 解析 → 去重 → 批量查询 → 回填
     */
    async function ipEnrichPhase(nodes) {
        const http = getHttpClient();
        if (!http) { logger.warn("无可用 HTTP 客户端，跳过 IP 检测"); return; }

        logger.info(`🔍 开始 IP 补充检测 (模式: ${CONFIG.ipEnrichMode})`);

        // 🛡️ 第一步：安全熔断机制 (防超时 / 防过度消耗资源)
        let validNodeCount = 0;
        for (const item of nodes) {
            if (!item.isInfo && !item.isGarbage && !item.isSpecial) validNodeCount++;
        }
        
        if (validNodeCount > CONFIG.ipEnrichThreshold) {
            logger.warn(`🛑 触发安全熔断！`);
            logger.warn(`有效节点数(${validNodeCount}) 超过了安全阈值(${CONFIG.ipEnrichThreshold})。`);
            logger.warn(`💡 提示：在 Sub-Store 中大规模并发查 IP 极易导致脚本超时被杀。为保护运行稳定，已自动跳过 IP 检测流程。`);
            return;
        }

        // 第二步：收集需要检测的 server
        const serverToNodes = new Map();
        const hasTagFeature = CONFIG.enableIpv6Tag || CONFIG.enableCellularTag || CONFIG.enableResidentialTag;
        
        for (const item of nodes) {
            if (item.isInfo || item.isGarbage || item.isSpecial) continue;
            
            // 如果既没有打标需求，又处于 missing 模式且已有地区，则不需要探测
            if (!hasTagFeature && CONFIG.ipEnrichMode !== "all" && item.regionInfo && !item.regionInfo.isUnknown) {
                continue;
            }
            
            const server = item.proxy?.server;
            if (!server) continue;
            
            if (!serverToNodes.has(server)) serverToNodes.set(server, []);
            serverToNodes.get(server).push(item);
        }
        if (serverToNodes.size === 0) {
            logger.info("✅ 无需补充检测（所有节点已有地区信息）");
            return;
        }
        const collectedTotal = [...serverToNodes.values()].reduce((s, v) => s + v.length, 0);
        logger.info(`📡 收集到 ${serverToNodes.size} 个唯一 server，共 ${collectedTotal} 个节点`);

        // 第三步：DNS 批量解析域名 → IP (引入并发控制，避免瞬间发包过多导致超时)
        const servers = [...serverToNodes.keys()];
        const resolved = [];
        const DNS_CONCURRENCY = CONFIG.ipApiDnsConcurrency || 15; // 每次最多并发查 15 个域名
        for (let i = 0; i < servers.length; i += DNS_CONCURRENCY) {
            const chunk = servers.slice(i, i + DNS_CONCURRENCY);
            const res = await Promise.all(chunk.map(s => resolveDomainToIp(s, http)));
            resolved.push(...res);
            // 简单延时缓冲，防止 DoH 接口 QPS 过高被拦截
            if (i + DNS_CONCURRENCY < servers.length) await new Promise(r => setTimeout(r, 150));
        }

        const ipToNodes = new Map();
        let domainCount = 0, directIpCount = 0, fissionCount = 0;
        for (let i = 0; i < servers.length; i++) {
            const server = servers[i];
            const res = resolved[i];
            if (res && res.ip && !isPrivateIP(res.ip)) {
                const { ip, ips, stack } = res;
                const items = serverToNodes.get(server);
                
                if (CONFIG.enableFission && ips && ips.length > 1 && looksLikeDomain(server)) {
                    for (const item of items) {
                        
                        // 裂变黑名单检查
                        let shouldSkipFission = false;
                        for (const kw of CONFIG.fissionExcludeKeywords) {
                            if (kw && item.rawName.includes(kw)) {
                                shouldSkipFission = true;
                                break;
                            }
                        }
                        
                        if (shouldSkipFission) {
                            item._ipStack = stack;
                            if (!ipToNodes.has(ip)) ipToNodes.set(ip, []);
                            ipToNodes.get(ip).push(item);
                            continue;
                        }

                        // 根据配置过滤裂变所需的 IP 栈
                        let fissionIps = ips;
                        if (CONFIG.fissionStack === "v4") {
                            fissionIps = ips.filter(ip => !ip.includes(':'));
                        } else if (CONFIG.fissionStack === "v6") {
                            fissionIps = ips.filter(ip => ip.includes(':'));
                        }

                        // 如果过滤后没有任何符合要求的 IP，则跳过裂变，当作普通节点处理
                        if (fissionIps.length === 0) {
                            item._ipStack = stack;
                            if (!ipToNodes.has(ip)) ipToNodes.set(ip, []);
                            ipToNodes.get(ip).push(item);
                            continue;
                        }
                        
                        if (!fissionTrack[server]) {
                            fissionTrack[server] = fissionIps.slice(0, Math.min(fissionIps.length, CONFIG.fissionMaxNodes));
                        }

                        // 1. 处理原节点 (指向第一个 IP)
                        item._ipStack = fissionIps[0].includes(':') ? "v6" : "v4";
                        item.proxy.server = fissionIps[0].includes(':') && !fissionIps[0].startsWith('[') ? `[${fissionIps[0]}]` : fissionIps[0];
                        // 净化历史遗留或误判的栈标签，确保裂变后完全基于物理 IP 重新打标
                        item.tags = item.tags.filter(t => t !== "dualstack" && t !== "ipv6");
                        
                        // SNI 防漏：如果原始 server 是域名，必须将其注入 SNI 和 Host
                        if (item.proxy.tls || ["ws", "grpc", "h2", "http"].includes(item.proxy.network)) {
                            if (!item.proxy.sni && !item.proxy.servername) item.proxy.servername = server;
                        }
                        if (item.proxy.network === "ws" && !item.proxy["ws-opts"]?.headers?.Host) {
                            if (!item.proxy["ws-opts"]) item.proxy["ws-opts"] = {};
                            if (!item.proxy["ws-opts"].headers) item.proxy["ws-opts"].headers = {};
                            item.proxy["ws-opts"].headers.Host = server;
                        }

                        if (!ipToNodes.has(fissionIps[0])) ipToNodes.set(fissionIps[0], []);
                        ipToNodes.get(fissionIps[0]).push(item);

                        // 2. 裂变生成克隆节点
                        const maxClones = Math.min(fissionIps.length, CONFIG.fissionMaxNodes);
                        for (let j = 1; j < maxClones; j++) {
                            const cloneIp = fissionIps[j];
                            if (isPrivateIP(cloneIp)) continue;

                            const cloneItem = { ...item };
                            if (item.attrs) cloneItem.attrs = { ...item.attrs };
                            cloneItem.tags = [...item.tags];
                            cloneItem.specificFeatures = [...item.specificFeatures];
                            cloneItem.proxy = JSON.parse(JSON.stringify(item.proxy));
                            
                            cloneItem.proxy.server = cloneIp.includes(':') && !cloneIp.startsWith('[') ? `[${cloneIp}]` : cloneIp;
                            cloneItem._ipStack = cloneIp.includes(':') ? "v6" : "v4";
                            cloneItem._isFission = true; // 标记裂变节点

                            if (!ipToNodes.has(cloneIp)) ipToNodes.set(cloneIp, []);
                            ipToNodes.get(cloneIp).push(cloneItem);
                            
                            nodes.push(cloneItem);
                            fissionCount++;
                        }
                    }
                    domainCount++;
                } else {
                    for (const item of items) {
                        item._ipStack = stack;
                    }
                    if (!ipToNodes.has(ip)) ipToNodes.set(ip, []);
                    for (const item of items) ipToNodes.get(ip).push(item);
                    if (looksLikeDomain(server)) domainCount++; else directIpCount++;
                }
            }
        }
        if (ipToNodes.size === 0) {
            logger.warn("DNS 解析全部失败，无 IP 可查询");
            return;
        }
        const ipNodesTotal = [...ipToNodes.values()].reduce((s, v) => s + v.length, 0);
        logger.info(`🌐 DNS 解析完成: ${domainCount} 域名→IP, ${directIpCount} 直连, ${ipToNodes.size} 个唯一 IP (${ipNodesTotal} 节点)`);
        if (fissionCount > 0) {
            logger.info(`🧬 节点裂变已触发: 共增殖产生了 ${fissionCount} 个新实体节点`);
        }

        // 第四步：分批批量查询（避免超限）
        const ips = [...ipToNodes.keys()];
        const allResults = [];
        const batchSize = Math.min(CONFIG.ipApiBatchSize || 100, 100);
        for (let i = 0; i < ips.length; i += batchSize) {
            const batch = ips.slice(i, i + batchSize);
            logger.info(`📦 批量查询第 ${Math.floor(i / batchSize) + 1} 批 (${batch.length} IP)...`);
            const batchRes = await batchQueryIps(batch, http);
            allResults.push(...batchRes);
            
            // 每次批次之间强制等待 (默认 4s，防 429)
            if (i + batchSize < ips.length) {
                await new Promise(r => setTimeout(r, CONFIG.ipApiBatchDelay));
            }
        }

        // 第五步：回填节点信息
        const resultMap = new Map();
        for (const r of allResults) {
            if (r?.status === "success") resultMap.set(r.query, r);
        }
        let enrichedCount = 0, regionDetected = 0;
        for (const [ip, items] of ipToNodes) {
            const info = resultMap.get(ip);
            if (!info) continue;
            for (const item of items) {
                const before = item.regionInfo?.name || "未知";
                enrichNodeRegion(item, info);
                const after = item.regionInfo?.name || "未知";
                if (before !== after || item.regionInfo?._fromIp) {
                    if (before === "未知" || item.regionInfo?._fromIp) regionDetected++;
                }
                enrichedCount++;
            }
        }

        logger.info(`✅ 完成: ip-api.com 成功 ${resultMap.size}/${ips.length} IP, ` +
            `回填 ${enrichedCount} 节点${regionDetected > 0 ? `, 识别 ${regionDetected} 个地区` : ""}`);
        if (regionDetected > 0) {
            const byRegion = {};
            for (const item of nodes) {
                if (item.regionInfo?._fromIp) {
                    const n = item.regionInfo.name;
                    byRegion[n] = (byRegion[n] || 0) + 1;
                }
            }
            logger.info(`📊 地区分布: ${Object.entries(byRegion).map(([r, c]) => `${r} ${c}`).join(", ")}`);
        }
    }

    // =========================================================================
    // 🚀 第一阶遍历: 提取、清洗与打标
    // =========================================================================
    const proxySet = new Map();
    const processedData = [];
    const fissionTrack = {};
    let dedupeCount = 0;
    let infoCount = 0;
    let discardedCount = 0;

    // 提前处理黑名单（转小写），避免循环内重复开销
    const whitelistKeywordsLower = (CONFIG.whitelistKeywords || []).map(k => k.toLowerCase());
    const blockKeywordsLower = (CONFIG.blockKeywords || []).map(k => k.toLowerCase());
    const blockServersLower = (CONFIG.blockServers || []).map(s => s.toLowerCase());

    const BUCKETS = {};
    [...new Set(REGION_DEFS.map(r => r.name)), "garbage", "download", "info", "special", "allStandard", "unknown"].forEach(key => {
        BUCKETS[key] = [];
    });
    FEATURE_RULES.forEach(r => { if (r.tag) BUCKETS[r.tag] = []; });

    proxies.forEach(originalProxy => {
        let proxy = normalizeProxyFields(originalProxy, targetPlatform);
        const rawName = proxy.name || "";
        proxy._rawName = rawName;  // 保存原始名，供下游脚本追溯
        const tempName = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, "");

        if (REGEX_INFO_NODE.test(tempName) || proxy.isSyntheticInfo) { if (!CONFIG.removeInfoNodes || proxy.isSyntheticInfo) { processedData.push({ proxy, isInfo: true, rawName }); infoCount++; } else { discardedCount++; } return; }

        if (CONFIG.enableDedupe) {
            const server = (proxy.server || "").toLowerCase();
            const port = String(proxy.port || "");
            const type = (proxy.type || "").toLowerCase();
            const sni = (proxy.sni || proxy.servername || proxy.peer || proxy["reality-opts"]?.["server-name"] || "").toLowerCase();
            const host = (proxy.host || proxy["ws-opts"]?.headers?.Host || proxy["ws-opts"]?.headers?.host || "").toLowerCase();
            const path = (proxy["ws-opts"]?.path || proxy["grpc-opts"]?.["grpc-service-name"] || "").toLowerCase();
            const authKey = String(proxy.uuid ?? proxy.password ?? proxy.client_id ?? "");
            
            const key = [server, port, type, sni, host, path, authKey].join('\x01');
            if (proxySet.has(key)) {
                dedupeCount++;
                const existing = proxySet.get(key) || '未知';
                const dedupeInfo = formatTagDisplay(rawName);
                const existingInfo = formatTagDisplay(existing);
                logger.debug(`🧽 [去重] 「${dedupeInfo.tagDisplay}${dedupeInfo.display}」→ 与「${existingInfo.tagDisplay}${existingInfo.display}」重复，已移除`);
                return;
            }
            proxySet.set(key, rawName);
        }

        const tempNameLower = tempName.toLowerCase();
        const subTagLower = (proxy._subTag || '').toLowerCase();

        let isSpecial = false;
        let specialTargetName = "";

        // 白名单匹配：名字包含关键词（split/单跑）或 _subTag 等于关键词（full 模式 URI 节点）
        if (whitelistKeywordsLower.some(k => tempNameLower.includes(k) || (subTagLower && subTagLower === k))) {
            isSpecial = true;
            specialTargetName = proxy.name;
        }

        if (!isSpecial && CONFIG.specialNodeRules && CONFIG.specialNodeRules.length > 0) {
            const match = CONFIG.specialNodeRules.find(r => r.reg.test(tempName));
            if (match) {
                isSpecial = true;
                specialTargetName = match.targetName || proxy.name;
            }
        }

        if (isSpecial) {
            processedData.push({ proxy, isSpecial: true, specialTargetName, rawName, isInfo: false, isGarbage: false });
            return;
        }

        let isGarbage = false;
        let blockReason = "";
        
        if (blockKeywordsLower.some(k => tempNameLower.includes(k))) {
            isGarbage = true; blockReason = "黑名单关键字";
        } else if (blockServersLower.some(s => (proxy.server || "").toLowerCase().includes(s))) {
            isGarbage = true; blockReason = "黑名单服务器";
        }

        const isFakeIP = REGEX_FAKE_IP.test(proxy.server);
        const isFakeServer = isFakeIP || proxy.server === 'localhost' || Number(proxy.port) === 0;
        const isDummyAuth = REGEX_DUMMY_AUTH.test(proxy.uuid || proxy.password || "");
        
        if (!isGarbage && (isFakeServer || isDummyAuth)) {
            isGarbage = true; blockReason = "假IP/假密码";
        }

        if (!isGarbage) {
            const hasDigit = /\d/.test(tempName);
            const hasTechLine = REGEX_TECH_LINE.test(tempName);
            const hasFluff = REGEX_FLUFF_LINE.test(tempName);
            const hasValidRegion = REGION_DEFS.some(r => r._matchReg.test(tempName));
            const hasFeature = FEATURE_RULES.some(rule => rule.reg.test(tempName)); 

            const cleanText = tempName.replace(/[\[\]]/g, "").replace(/\p{Extended_Pictographic}/gu, "").trim();
            const cleanLength = cleanText.length;
            const effectiveThreshold = hasValidRegion ? Math.max(CONFIG.adTextThreshold || 12, 18) : (CONFIG.adTextThreshold || 12);
            
            if (cleanLength > effectiveThreshold && !hasDigit && !hasTechLine && !hasFeature) {
                isGarbage = true; blockReason = "超长广告文本";
            } else if (!hasValidRegion && !hasFluff && cleanLength > 10 && !hasDigit && !hasTechLine && !hasFeature) {
                isGarbage = true; blockReason = "孤儿广告";
            }
        }

        if (isGarbage) {
            discardedCount++;
            processedData.push({ proxy, isGarbage: true, rawName, blockReason });
            return;
        }

        // ================================================================
        let name = sanitizeNodeName(rawName);
        const { attrs, cleanName } = extractNodeAttributes(name);
        if (CONFIG.enableStandardRename) name = cleanName;

        let tags = new Set();
        let specificFeatures = []; 

        FEATURE_RULES.forEach(rule => {
            // 使用全局匹配 /ig，确保特征都能被搜到
            const allMatches = name.match(rule._cleanReg);
            if (allMatches) {
                tags.add(rule.tag);

                if (rule.tag === "streaming") {
                    // 流媒体：先收集具体服务缩写，避免"NF/D+/YT/流媒体"这种冗余
                    let seen = new Set();
                    const specifics = [];
                    let hasGeneric = false;
                    allMatches.forEach(m => {
                        const abbr = STREAMING_ABBR[m.toLowerCase()];
                        if (abbr) {
                            if (!seen.has(abbr)) { seen.add(abbr); specifics.push(abbr); }
                        } else {
                            hasGeneric = true;
                        }
                    });
                    if (specifics.length > 0) {
                        specificFeatures.push(...specifics);
                    } else if (hasGeneric) {
                        const fb = FEATURE_TEXT_MAP["streaming"];
                        if (fb && !specificFeatures.includes(fb)) specificFeatures.push(fb);
                    }
                } else {
                    // 非流媒体标签：沿用缩写映射
                    allMatches.forEach(m => {
                        if (rule.tag === "ipv6" || rule.tag === "dualstack") return; // 属于网络层，不在应用层 features 中展示

                        let word = m.toUpperCase();
                        if (/CHATGPT|OPENAI|GPT/i.test(word)) word = "GPT";
                        else if (/家宽|住宅|RESIDENTIAL/i.test(word)) word = "家宽";
                        else if (rule.tag === "game") word = "游戏";
                        else if (rule.tag === "download") word = "下载";
                        else if (rule.tag === "free") word = "免费";
                        else if (rule.tag === "ai") word = "AI";
                        else word = FEATURE_TEXT_MAP[rule.tag] || word;

                        if (!specificFeatures.includes(word)) specificFeatures.push(word);
                    });
                }

                if (CONFIG.enableStandardRename) {
                    name = name.replace(rule._cleanReg, "");
                }
            }
        });

        // 🏷️ 如果开启打标，且节点 server 纯 IP 时直接识别网络栈
        if (CONFIG.enableIpv6Tag && proxy.server && !looksLikeDomain(proxy.server)) {
            if (proxy.server.includes(':')) tags.add("ipv6");
        }

        const regionInfo = matchNodeRegion(name);
        let destCityStr = "";
        if (regionInfo && regionInfo.city && !regionInfo.isUnknown) {
            const cityMatch = rawName.match(regionInfo._cityReg);
            if (cityMatch) destCityStr = cityMatch[0];
        }

        if (regionInfo) {
            if (CONFIG.enableStandardRename) {
                if (regionInfo.isUnknown) {
                    name = name.replace(REGEX_ALL_FLAGS, "").replace(regionInfo.name, "");
                } else {
                    name = name.replace(REGEX_ALL_FLAGS, "").replace(regionInfo._cleanReg, "");
                }
            }
        }
        
        if (CONFIG.enableStandardRename) {
            name = name.replace(/[\[\]{}()<>（）【】]/g, "").replace(/[-_\|\s]+/g, " ").trim() || "其他";
        } else {
            name = name.trim() || "其他";
        }

        const pType = (proxy.type || "").toLowerCase();
        const network = (proxy.network || "").toLowerCase();
        const transportTag = (network && network !== "tcp")
          ? network.replace(/^ws$/, "WS").replace(/^h2$/, "H2").replace(/^grpc$/, "GRPC").replace(/^quic$/, "QUIC").replace(/^http$/, "HTTP").toUpperCase()
          : "";
        const airportTag = getAirportTag(rawName, proxy);
        const groupKey = (airportTag ? airportTag + "__" : "") + (regionInfo ? regionInfo.name : name);

        processedData.push({
            proxy, rawName, cleanName: name, regionInfo, pType, transportTag,
            groupKey, airportTag, tags: Array.from(tags), specificFeatures, attrs,
            _destCity: destCityStr || null,
            isInfo: false, isGarbage: false
        });
    });

    // =========================================================================
    // 🧩 后续流程：排序 → 重命名 → 组装
    // =========================================================================
    function finalizeProcessing() {
        // 🧹 数据排序
        const REGION_ORDER = {};
        REGION_DEFS.forEach((r, index) => { REGION_ORDER[r.name] = index; });

        processedData.sort((a, b) => {
            if (a.isInfo !== b.isInfo) return a.isInfo ? -1 : 1;
            if (a.isSpecial !== b.isSpecial) return a.isSpecial ? -1 : 1;
            if (a.isGarbage !== b.isGarbage) return a.isGarbage ? 1 : -1;

            const isUnknownA = !a.regionInfo || a.regionInfo.isUnknown;
            const isUnknownB = !b.regionInfo || b.regionInfo.isUnknown;
            if (isUnknownA !== isUnknownB) return isUnknownA ? 1 : -1;

            const orderA = REGION_ORDER[a.regionInfo?.name] ?? 999;
            const orderB = REGION_ORDER[b.regionInfo?.name] ?? 999;
            if (orderA !== orderB) return orderA - orderB;

            // 对于不在 REGION_DEFS 里的动态/冷门地区（order 都是 999），按地区名拼音排序，防止混在一起
            if (orderA === 999) {
                const nameA = a.regionInfo?.name || "";
                const nameB = b.regionInfo?.name || "";
                if (nameA !== nameB) return nameA.localeCompare(nameB, 'zh-CN');
            }

            const getMultiWeight = (num) => num > (CONFIG.highMultiThreshold || 99) ? 1 : 0;
            const mwA = getMultiWeight(a.attrs?.multiNum || 1);
            const mwB = getMultiWeight(b.attrs?.multiNum || 1);
            if (mwA !== mwB) return mwA - mwB;

            const weightA = a.attrs?.bestLineWeight ?? 99;
            const weightB = b.attrs?.bestLineWeight ?? 99;
            if (weightA !== weightB) return weightA - weightB;

            const entryA = a.attrs?.entryStr || "ZZZ", entryB = b.attrs?.entryStr || "ZZZ";
            if (entryA !== entryB) return entryA.localeCompare(entryB, 'zh-CN');

            const lineA = a.attrs?.cleanLines || "ZZZ", lineB = b.attrs?.cleanLines || "ZZZ";
            if (lineA !== lineB) return lineA.localeCompare(lineB, 'zh-CN');

            const multiA = a.attrs?.multiNum ?? 1, multiB = b.attrs?.multiNum ?? 1;
            if (multiA !== multiB) return multiA - multiB;

            const idA = `${a.proxy?.server || ""}:${a.proxy?.port || ""}`;
            const idB = `${b.proxy?.server || ""}:${b.proxy?.port || ""}`;
            if (idA !== idB) return idA.localeCompare(idB, 'zh-CN');
            return (a.rawName || '').localeCompare(b.rawName || '', 'zh-CN');
        });

        const getRegionOnlyKey = (gk) => {
            const idx = gk.indexOf('__');
            return idx !== -1 ? gk.substring(idx + 2) : gk;
        };
        
        const getAirportTagFromGroupKey = (gk) => {
            const idx = gk.indexOf('__');
            return idx !== -1 ? gk.substring(0, idx) : "";
        };

        const regionTotals = {}; // 地区总节点数（合并所有前缀）
        const groupTrack = {}; // 分组内序号计数器（按 trackKey 独立计数）
        const groupTotals = {}; // 各分组节点数（含前缀分组，用于计算序号补零位数）
        processedData.forEach(d => {
            if (!d.isInfo && !d.isGarbage && !d.isSpecial) {
                const regionKey = getRegionOnlyKey(d.groupKey);
                const airportTag = getAirportTagFromGroupKey(d.groupKey);
                const prefix = d.proxy._indexPrefix || CONFIG.indexPrefixMap[airportTag];
                const trackKey = prefix ? `${regionKey}_${prefix}` : regionKey;
                // 统计地区总节点数
                regionTotals[regionKey] = (regionTotals[regionKey] || 0) + 1;
                // 统计各分组节点数
                groupTotals[trackKey] = (groupTotals[trackKey] || 0) + 1;
            }
        });
        // 全局统一序号补零位数：取最大分组节点数的位数，最小2位
        const maxGroupCount = Math.max(...Object.values(groupTotals), 9);
        const indexPad = Math.max(2, maxGroupCount.toString().length);

        // --- ⚙️ 构建多分隔符兜底清理动态正则 ---
        const defaultSeps = ["|", "-", "·", "/", "~", ":", ",", ";", "_", "=", "+", "*", ">", "<", "➩", "=>", "->"];
        const customSeps = Array.isArray(CONFIG.renameSeparators) ? CONFIG.renameSeparators : defaultSeps;
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
        const regAdjacentSeps = combined ? new RegExp(`\\s*${combined}\\s*(?=${combined})`, 'g') : null;
        const regEdgeSeps = combined ? new RegExp(`^(?:\\s|${combined})+|(?:\\s|${combined})+$`, 'g') : null;

        // 🚀 第二阶遍历: 执行重命名与组装
        const finalProxies = [];
        const nodeMeta = [];

        processedData.forEach(item => {
            if (item.isInfo) {
                if (CONFIG.customPrefix) item.proxy.name = CONFIG.customPrefix + item.proxy.name;
                finalProxies.push(item.proxy);
                BUCKETS.info.push(item.proxy.name);
                nodeMeta.push({ rawName: item.rawName, cleanName: item.proxy.name, proxy: item.proxy, regionInfo: null, tags: [], groupKey: "info", isInfo: true });
                return;
            }

            if (item.isSpecial) {
                item.proxy.name = item.specialTargetName;
                BUCKETS.special.push(item.proxy.name);
                finalProxies.push(item.proxy);
                nodeMeta.push({ rawName: item.rawName, cleanName: item.proxy.name, proxy: item.proxy, regionInfo: null, tags: [], groupKey: "special", isInfo: false, isGarbage: false, isSpecial: true });
                return;
            }

            if (item.isGarbage) {
                const garbageName = `🗑️ [拦截: ${item.blockReason}] ${item.rawName}`;
                item.proxy.name = garbageName;
                BUCKETS.garbage.push(garbageName);
                if (CONFIG.outputGarbage) finalProxies.push(item.proxy);
                nodeMeta.push({ rawName: item.rawName, cleanName: item.proxy.name, proxy: item.proxy, regionInfo: null, tags: [], groupKey: "garbage", isInfo: false, isGarbage: true });
                return;
            }

            const { proxy, regionInfo, groupKey, rawName, pType, transportTag, airportTag, tags, specificFeatures } = item;
            
            const regionOnlyKey = getRegionOnlyKey(groupKey);
            const tagFromKey = getAirportTagFromGroupKey(groupKey);
            
            const prefix = proxy._indexPrefix || CONFIG.indexPrefixMap[tagFromKey];
            const trackKey = prefix ? `${regionOnlyKey}_${prefix}` : regionOnlyKey;

            // 序号生成逻辑：地区总数>1 → 前缀+序号；地区总数=1 → 不显示
            groupTrack[trackKey] = (groupTrack[trackKey] || 0) + 1;
            const idx = groupTrack[trackKey];
            const regionTotal = regionTotals[regionOnlyKey] || 1;
            let numStr;
            if (regionTotal > 1) {
              numStr = prefix ? `${prefix}${idx.toString().padStart(indexPad, "0")}` : idx.toString().padStart(indexPad, "0");
            } else {
              numStr = "";
            }

            const IGNORE_CITY_REGION = new Set(["香港", "澳门", "新加坡", "台湾"]);
            let finalCity = "";
            if (regionInfo && !IGNORE_CITY_REGION.has(regionInfo.name)) {
                finalCity = regionInfo._ipCity || item._destCity || "";
            }

            const ispStr = item._ipIsp ? cleanIspName(item._ipIsp) : (item.attrs.ispStr || "");
            const orgStr = item._ipOrg ? cleanIspName(item._ipOrg) : (item.attrs.ispStr || "");
            const asnStr = item._ipAsn ? `AS${item._ipAsn.toString().replace(/^AS/i, '')}` : (item.attrs.asnStr || "");
            const asnameStr = item._ipAsname ? item._ipAsname : "";

            let finalName;
            let isUnknown = !regionInfo || (regionInfo && regionInfo.isUnknown);
            const myPrefix = CONFIG.customPrefix || "";

            if (!isUnknown) {
                if (CONFIG.enableStandardRename) {
                    let combinedIcons = "";

                    if (tags.length > 0) {
                        if (CONFIG.showFeatureIcon) {
                            const items = specificFeatures.length > 0 ? specificFeatures : tags;
                            items.forEach(f => {
                                const key = f.toLowerCase();
                                if (UI_ICONS.features[key]) combinedIcons += UI_ICONS.features[key];
                                else if (UI_ICONS.features[f]) combinedIcons += UI_ICONS.features[f];
                            });
                        } else {
                            if (specificFeatures.length > 0) {
                                combinedIcons += specificFeatures.join("/");
                            }
                        }
                    }

                    finalName = CONFIG.renameTemplate
                        .replace(/\{prefix\}/g, myPrefix)
                        .replace(/\{airport\}/g, airportTag || "")
                        .replace(/\{icon\}/g, regionInfo.icon || "")
                        .replace(/\{region\}/g, regionInfo.name || "")
                        .replace(/\{index\}/g, numStr)
                        .replace(/\{features\}/g, combinedIcons)
                        .replace(/\{protocol\}/g, UI_ICONS.protocols[pType] || "")
                        .replace(/\{transport\}/g, transportTag || "")
                        .replace(/\{in\}/g, item.attrs.entryStr || "")
                        .replace(/\{line\}/g, item.attrs.cleanLines || "")
                        .replace(/\{multi\}/g, item.attrs.multiStr || "")
                        .replace(/\{ip_stack\}/g, tags.includes("dualstack") ? "双栈" : (tags.includes("ipv6") ? "IPv6" : ""))
                        .replace(/\{city\}/g, finalCity)
                        .replace(/\{isp\}/g, ispStr)
                        .replace(/\{asn\}/g, asnStr)
                        .replace(/\{asname\}/g, asnameStr)
                        .replace(/\{org\}/g, orgStr)
                        .replace(/\s{2,}/g, " ");
                if (regAdjacentSeps) {
                    finalName = finalName.replace(regAdjacentSeps, "");
                }
                if (regEdgeSeps) {
                    finalName = finalName.replace(regEdgeSeps, "");
                }
                finalName = finalName.trim();
                } else {
                    finalName = `${myPrefix}${item.rawName}`;
                }

                const regionKey = regionInfo.name;
                if (!BUCKETS[regionKey]) BUCKETS[regionKey] = [];
                BUCKETS[regionKey].push(finalName);
                BUCKETS.allStandard.push(finalName);
                tags.forEach(tag => {
                    if (!BUCKETS[tag]) BUCKETS[tag] = [];
                    BUCKETS[tag].push(finalName);
                });
                proxy.name = finalName;
                const logInfo = formatTagDisplay(item.rawName);
                logger.debug(`\u2705 [清洗] ${logInfo.tagDisplay}「${logInfo.display}」 -> 「${finalName}」`);
                finalProxies.push(proxy);

            } else {
                const coreName = (item.cleanName || item.rawName).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\ufeff]/g, "");
                finalName = `${myPrefix}❓ 未知 | ${coreName}${numStr ? ' ' + numStr : ''}`
                    .replace(/\s{2,}/g, " ")
                    .trim();
                proxy.name = finalName;
                BUCKETS.unknown.push(finalName);
                const logInfo2 = formatTagDisplay(item.rawName);
                logger.debug(`\u2753 [未识别] ${logInfo2.tagDisplay}「${logInfo2.display}」 -> 「${finalName}」`);
                if (CONFIG.outputUnknown) finalProxies.push(proxy);
            }

            nodeMeta.push({
                rawName: item.rawName, cleanName: proxy.name,
                proxy, regionInfo, tags, groupKey,
                isInfo: false, isGarbage: false, isFission: !!item._isFission,
                ipIsp: item._ipIsp || null,
                ipAsn: item._ipAsn || null,
                ipAsname: item._ipAsname || null,
                ipOrg: item._ipOrg || null,
            });
        });

        let fissionCount = 0;
        processedData.forEach(d => { if (d._isFission) fissionCount++; });

        const stats = {
            total: proxies.length,
            outputCount: finalProxies.length,
            dedupeCount,
            infoCount,
            discardedCount,
            garbageCount: BUCKETS.garbage.length,
            unknownCount: BUCKETS.unknown.length,
            fissionCount,
            regionCounts: {},
            featureCounts: {}
        };

        Object.keys(BUCKETS).forEach(key => {
            if (["garbage", "download", "info", "special", "allStandard", "unknown"].includes(key)) return;
            if (BUCKETS[key].length > 0) stats.regionCounts[key] = BUCKETS[key].length;
        });
        FEATURE_RULES.forEach(r => {
            if (BUCKETS[r.tag] && BUCKETS[r.tag].length > 0) stats.featureCounts[r.tag] = BUCKETS[r.tag].length;
        });

        const cleanBuckets = {};
        Object.keys(BUCKETS).forEach(key => {
            if (BUCKETS[key].length > 0) cleanBuckets[key] = BUCKETS[key];
        });

        const reportLines = [
            '====== 🚀 Mihomo-Toolkit 节点清洗报告 ======',
            `📥 概况: 读入 ${stats.total} 个节点，最终保留 ${stats.outputCount} 个`,
            `♻️ 过滤: 物理去重 ${stats.dedupeCount} 个，剔除无效/广告 ${stats.discardedCount} 个，分离说明节点 ${stats.infoCount} 个`
        ];
        
        if (stats.fissionCount > 0) {
            reportLines.push(`🧬 裂变: 解析域名产生 ${stats.fissionCount} 个分身 IP 节点`);
        }

        const topRegions = Object.entries(stats.regionCounts).sort((a,b) => b[1] - a[1]).slice(0, 5).map(r => `${r[0]}(${r[1]})`).join(', ');
        if (topRegions) {
            reportLines.push(`🌍 地区: ${topRegions} 等 (未知地区 ${stats.unknownCount} 个)`);
        }

        const topFeatures = Object.entries(stats.featureCounts).sort((a,b) => b[1] - a[1]).map(r => `${r[0]}(${r[1]})`).join(', ');
        if (topFeatures) {
            reportLines.push(`🏷️ 特征: ${topFeatures}`);
        }
        reportLines.push('============================================');

        return CONFIG.outputMode === "object"
            ? { proxies: finalProxies, meta: { buckets: cleanBuckets, stats: stats, humanReport: reportLines.join('\n'), fissionTrack, nodeMeta: nodeMeta } }
            : finalProxies;
    }

    // 🧩 IP API 补充检测：仅在启用且 HTTP 客户端可用时走异步路径
    if (CONFIG.enableIpEnrich) {
        return (async () => {
            try {
                if (CONFIG.ipEnrichTimeout > 0) {
                    let timeoutId;
                    try {
                        await Promise.race([
                            ipEnrichPhase(processedData),
                            new Promise((_, reject) => {
                                timeoutId = setTimeout(() => reject(new Error("IP_ENRICH_TIMEOUT")), CONFIG.ipEnrichTimeout);
                            })
                        ]);
                    } finally {
                        if (timeoutId) clearTimeout(timeoutId);
                    }
                } else {
                    await ipEnrichPhase(processedData);
                }
            } catch (e) {
                if (e.message === "IP_ENRICH_TIMEOUT") {
                    logger.warn(`请求总耗时超过设定阈值 (${CONFIG.ipEnrichTimeout}ms)，强制触发熔断！将跳过剩余 IP 分析并返回已处理的节点。`);
                } else {
                    logger.error(`发生异常: ${e.message}`);
                }
            }
            return finalizeProcessing();
        })();
    }

    return finalizeProcessing();
}

// 仅在 Node.js CommonJS 环境导出（Sub-Store 忽略此行）
if (typeof module !== 'undefined' && module.exports) module.exports = { operator };
