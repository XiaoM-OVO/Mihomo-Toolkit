/**
 * =========================================================================
 * 📦 Mihomo-Toolkit | 通用纯净节点清洗脚本 (Pure JS Edition) | MIT 许可证
 * =========================================================================
 * 🏷️ 版本: 1.0.0 (Build 2026.07.06)
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
    removeInfoNodes: false,       // 纯净模式: 直接删除"到期时间/剩余流量"等说明节点
    outputGarbage: false,         // 垃圾输出: 是否将拦截的广告/假节点也输出(默认不输出,但会进桶)
    outputUnknown: true,          // 未知输出: 是否将未识别的节点输出(默认输出)

    // ---------------------------------------------------------------------
    // 📝 二、命名模板与展示风格
    // ---------------------------------------------------------------------
    enableStandardRename: true,   // 标准化重命名: 关闭则保留节点原名(防吞词)
    
    // 🖨️ 节点命名模板变量说明 (自由组合，无数据时会自动清理多余空格与符号):
    // {prefix}   -> 自定义前缀 (如: "我的机场-")
    // {airport}  -> 提取的机场名 (如: "[Bitz]")
    // {icon}     -> 地区国旗 emoji (如: "🇺🇸")
    // {region}   -> 地区名称 (如: "美国", "香港")
    // {city}     -> 城市名称 (如: "洛杉矶" - 若无IP检测则提取原名城市)
    // {index}    -> 节点排序编号 (如: " 01", " 02")
    // {features} -> 解锁特征与图标 (如: "📺流媒体", "🏠家宽")
    // {protocol} -> 协议图标 Emoji (如: "🛩️", "🦊")
    // {transport}-> 传输层协议标签 (如: "WS", "H2", "GRPC")
    // {in}       -> 入口地区 (如: "深", "沪")
    // {line}     -> 线路特征 (如: "BGP/家宽")
    // {multi}    -> 倍率数值 (如: "x2.0")
    // {isp}      -> [IP补充] 运营商名称 (如: "Akamai", "Cloudflare")
    // {asn}      -> [IP补充] 自治系统编号 (如: "AS16509")
    // {org}      -> [IP补充] 组织/数据中心 (如: "Amazon.com", "Oracle")
    renameTemplate: "{prefix}{airport} {icon} {region} {index} {features} | {in} {city} {line} {multi} · {transport}",

    customPrefix: "",             // 批量自定义前缀 (也可通过 {prefix} 模板控制)
    showFeatureIcon: false,       // 替换特征文本为 Emoji (开启后"流媒体"变为📺)
    featureBracket: "",           // 特征文本的括号样式: "「」" / "[]" / "()" / "" (留空不显示)

    enableAirportTag: false,      // 提取原机场标签 (例: 提取 [Bitz] 并在同组节点排序)
    airportTag: "",               // 强制覆盖/指定所有节点的机场标签

    // ---------------------------------------------------------------------
    // 🧽 三、清洗、过滤与去重
    // ---------------------------------------------------------------------
    enableDedupe: false,          // 物理去重: 基于 服务器/端口/UUID 等多维度深度去重
    strictRegionMatch: false,     // 严格地区: 未知国旗不再动态捕获，直接丢入"未知"组
    adTextThreshold: 12,          // 广告阈值: 超过该长度且无特定特征视为广告
    blockKeywords: [],            // 黑名单关键词: 包含即拦截，例: ["免费领取", "点击购买"]
    blockServers: [],             // 黑名单服务器: 包含即拦截，例: ["123.123.123.123", "fake.com"]
    highMultiThreshold: 2.5,      // 高倍率软隔离: 超过此倍率的节点在同地区内自动下沉沉底

    // ---------------------------------------------------------------------
    // 🧩 四、IP API 补充检测 (溯源与精准定位)
    // ---------------------------------------------------------------------
    enableIpEnrich: false,        // API 检测总开关 (基于 ip-api.com)
    ipApiKey: "",                 // 🔑 IP-API Pro 密钥 (选填)，如使用 pro.ip-api.com 请填写
    ipEnrichThreshold: 200,       // 🛡️ 安全熔断: 节点总数超过此值自动关闭检测，防止超时
    ipEnrichMode: "missing",      // 检测模式: "missing" 仅检测未知/无地区的节点; "all" 强制检测所有节点
    ipApiEndpoint: "http://ip-api.com/batch", // IP 接口: 可替换为自建反代或 https://pro.ip-api.com/batch
    ipApiBatchSize: 100,          // 批量请求上限: 免费版限制为 100，如遇 429 报错可调低
    ipApiDnsEndpoint: "",         // DoH 解析端点: 留空则自动选择 (阿里 DNS → Google DNS 兜底)
};

// =========================================================================
// 🪛 核心常量与正则字典 (Global)
// =========================================================================
const REGEX_ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g;
const REGEX_INFO_NODE = /剩余流量|套餐到期|到期时间|有效时间|过期|更新公告|重置|维护|不可用|扣费|节点说明|防失联|官网|地址|Q群|电报|Tg群|距离下次|测试|关注频道|官方群组|签到获取/i;
const REGEX_FORBID_DL_STR = "(?:禁止|禁|严禁|请勿|勿|不要|不能|拒绝|屏蔽|防)(?:BT|PT|P2P|下载|测速|迅雷)|(?:仅限|仅供)(?:网页|日常|聊天)|\\b(?:No|Block|Ban)[\\s\\-_]*(?:BT|PT|Torrent|Download)\\b";
const REGEX_CLEANUP = new RegExp(`${REGEX_FORBID_DL_STR}|\\b(?:https?:\\/\\/|www\\.)?[a-zA-Z0-9][-a-zA-Z0-9]{1,62}\\.(?:com|net|org|cc|me|vip|pro|top|xyz|club)\\b`, "ig");
const REGEX_ENTRY_CITY = /(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|SZX|CAN|PVG|SHA|PEK|PKX|HGH|入口|Ingress)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|澳|落地|出口|Exit)/i;
const REGEX_MULTI = /(?:倍率|Rate)\s*[:：]?\s*(\d+(?:\.\d+)?)|(?<![a-zA-Z])(?:[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍率|倍)?|(\d+(?:\.\d+)?)\s*(?:[xX×]|倍率|倍))(?!\s*\d)/i;

const REGEX_TECH_LINE = /(IEPL|IPLC|CMIN2|CMI|CN2\s*GIA|CN2|GIA|9929|4837|CUG|BGP|AWS|GCP|Oracle|Azure|Hinet|Zenlayer|IIJ|NTT|OCN|Softbank|Transit|Relay|隧道|Direct|HGC|HKBN|PCCW|WTT|HKT|CTCUCM|CTCUM|CTCU|CUCT|CMCU|CTCM|CMCT|三网|电联|移联|电移|移动|联通|电信|专线)/gi;
const REGEX_FLUFF_LINE = /(高速|极速|优化|起飞|VIP|Premium|Pro|Plus|标准|基础|高级|节点)/gi;
const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;
const REGEX_ALL_FLAGS = /\p{Regional_Indicator}{2}/gu;

const REGEX_FAKE_IP = /^(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|1\.1\.1\.1|8\.8\.8\.8|1\.2\.3\.4|2\.2\.2\.2|3\.3\.3\.3)/;
const REGEX_DUMMY_AUTH = /^(0{8}-0{4}-0{4}-0{4}-0{12}|123456|password|dummy)$/i;
const REGEX_ISP_CLEAN_1 = /,\s*(Inc|LLC|Ltd|Corp)\.?/ig;
const REGEX_ISP_CLEAN_2 = /\b(Technologies|Communications|Services|Network|Cloud)\b/ig;

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
        "no_download": "🚫", "cdn": "☁️", "cdn中转": "☁️",
    }
};

const FEATURE_TEXT_MAP = {
    "residential": "家宽", "game": "游戏", "streaming": "流媒体",
    "gemini": "Gemini", "claude": "Claude", "chatgpt": "GPT", "ai": "AI",
    "download": "下载", "free": "免费", "no_download": "禁止下载"
};

const STREAMING_SERVICES = [
    { keys: ["Netflix", "NF", "奈飞", "网飞", "耐飞"], abbr: "NF" },
    { keys: ["Disney\\+", "Disney", "迪士尼", "D\\+"], abbr: "D+" },
    { keys: ["YouTube", "YT", "油管"], abbr: "YT" },
    { keys: ["TikTok", "抖音海外", "抖音", "TT"], abbr: "TK" },
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
    { source: "(?:家宽|住宅|宽带|原生|Residential|ISP|Home|HKT|HKBN|HGC|WTT|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|So[-_]?net|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)", tag: "residential" },
    { source: "(?:游戏)|Game|FullCone", tag: "game" },
    { source: "(?:下载)|BT", tag: "download" },
    { source: "(?:免费|白嫖|公益)", tag: "free" },
    { source: "\\b(?:Gemini)\\b", tag: "gemini" },
    { source: "\\b(?:Claude)\\b", tag: "claude" },
    { source: "\\b(?:ChatGPT|OpenAI|GPT)\\b", tag: "chatgpt" },
    { source: "\\b(?:AI(?:解锁|访问|加速|代理)?)\\b", tag: "ai" },
    { source: STREAMING_SOURCE, tag: "streaming" }
];
const FEATURE_RULES = FEATURE_RULES_RAW.map(r => ({
    source: r.source,
    reg: new RegExp(r.source, "i"),
    _cleanReg: new RegExp(r.source, "ig"),
    tag: r.tag
}));

const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)";
const REGION_DEFS = [
    { name: "香港", icon: "🇭🇰", reg: new RegExp(`${IN_PREFIX}?港|香港|香江|(?<![a-zA-Z])(?:HK|HKG|HKT|HKBN|HGC|WTT|PCCW)(?![a-zA-Z])|Hong Kong`, "i") },
    { name: "台湾", icon: "🇹🇼", city: "台北|新北|台中|高雄|彰化", reg: new RegExp(`${IN_PREFIX}?台|台湾|台灣|(?<![a-zA-Z])(?:TW|TPE|KHH|APTG)(?![a-zA-Z])|Taiwan|Hinet|Kbro|Seednet`, "i") },
    { name: "日本", icon: "🇯🇵", city: "东京|大阪|埼玉|京都|川崎", reg: new RegExp(`${IN_PREFIX}?日|日本|(?<![a-zA-Z])(?:JP|NRT|HND|KIX|OCN|IIJ|NTT)(?![a-zA-Z])|Japan|Nuro|Plala`, "i") },
    { name: "韩国", icon: "🇰🇷", city: "首尔|春川", reg: new RegExp(`${IN_PREFIX}?韩|韩国|(?<![a-zA-Z])(?:KR|ICN|SEL)(?![a-zA-Z])|Korea`, "i") },
    { name: "新加坡", icon: "🇸🇬", city: "狮城", reg: new RegExp(`${IN_PREFIX}?新|新加坡|(?<![a-zA-Z])(?:SG|SIN)(?![a-zA-Z])|Singapore|Singtel|StarHub`, "i") },
    { name: "美国", icon: "🇺🇸", city: "洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|纽约|迈阿密|华盛顿", reg: new RegExp(`${IN_PREFIX}?美|美国|西美|(?<![a-zA-Z])(?:US|LAX|SFO|JFK|SJC|ORD)(?![a-zA-Z])|Los Angeles|America`, "i") },
    { name: "英国", icon: "🇬🇧", city: "伦敦", reg: /英国|(?<![a-zA-Z])UK(?![a-zA-Z])|United Kingdom|Britain/i },
    { name: "德国", icon: "🇩🇪", city: "法兰克福", reg: /德国|(?<![a-zA-Z])DE(?![a-zA-Z])|Germany/i },
    { name: "法国", icon: "🇫🇷", city: "巴黎", reg: /法国|(?<![a-zA-Z])FR(?![a-zA-Z])|France/i },
    { name: "荷兰", icon: "🇳🇱", reg: /荷兰|(?<![a-zA-Z])NL(?![a-zA-Z])|Netherlands/i },
    { name: "俄罗斯", icon: "🇷🇺", city: "莫斯科|伯力|圣彼得堡", reg: /俄罗斯|(?<![a-zA-Z])RU(?![a-zA-Z])|Russia/i },
    { name: "土耳其", icon: "🇹🇷", city: "伊斯坦布尔", reg: /土耳其|(?<![a-zA-Z])TR(?![a-zA-Z])|Turkey/i },
    { name: "阿根廷", icon: "🇦🇷", city: "布宜诺斯艾利斯", reg: /阿根廷|(?<![a-zA-Z])AR(?![a-zA-Z])|Argentina/i },
    { name: "马来西亚", icon: "🇲🇾", city: "吉隆坡", reg: /马来|马来西亚|(?<![a-zA-Z])MY(?![a-zA-Z])|Malaysia/i },
    { name: "澳大利亚", icon: "🇦🇺", city: "悉尼|墨尔本", reg: /澳大利亚|澳洲|(?<![a-zA-Z])(?:AU|SYD)(?![a-zA-Z])|Australia|Sydney/i },
    { name: "泰国", icon: "🇹🇭", city: "曼谷", reg: /泰国|(?<![a-zA-Z])TH(?![a-zA-Z])|Thailand/i },
    { name: "印尼", icon: "🇮🇩", city: "雅加达", reg: /印尼|印度尼西亚|(?<![a-zA-Z])ID(?![a-zA-Z])|Indonesia/i },
    { name: "越南", icon: "🇻🇳", city: "胡志明|河内", reg: /越南|(?<![a-zA-Z])VN(?![a-zA-Z])|Vietnam/i },
    { name: "巴西", icon: "🇧🇷", city: "圣保罗", reg: /巴西|(?<![a-zA-Z])BR(?![a-zA-Z])|Brazil/i },
    { name: "菲律宾", icon: "🇵🇭", city: "马尼拉", reg: /菲律宾|(?<![a-zA-Z])PH(?![a-zA-Z])|Philippines/i },
    { name: "加拿大", icon: "🇨🇦", city: "多伦多|温哥华|蒙特利尔", reg: /加拿大|(?<![a-zA-Z])CA(?![a-zA-Z])|Canada|Toronto|Vancouver/i },
    { name: "意大利", icon: "🇮🇹", city: "米兰|罗马", reg: /意大利|(?<![a-zA-Z])IT(?![a-zA-Z])|Italy|Milan/i },
    { name: "西班牙", icon: "🇪🇸", city: "马德里|巴塞罗那", reg: /西班牙|(?<![a-zA-Z])ES(?![a-zA-Z])|Spain/i },
    { name: "瑞典", icon: "🇸🇪", city: "斯德哥尔摩", reg: /瑞典|(?<![a-zA-Z])SE(?![a-zA-Z])|Sweden/i },
    { name: "印度", icon: "🇮🇳", city: "孟买|新德里", reg: /印度|(?<![a-zA-Z])IN(?![a-zA-Z])|India/i },
    { name: "澳门", icon: "🇲🇴", reg: /澳门|澳門|Macau|Macao|(?<![a-zA-Z])CTM(?![a-zA-Z])/i },
    { name: "中国", icon: "🇨🇳", city: "深圳|广州|上海|北京|杭州|成都|武汉|南京", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(CN|PRC)(?![a-zA-Z])|China|(?:美|日|韩|新|港|台|英|德|法|澳)(?:-|->|至|=>|\s)*(?:京|沪|广|深|国内|大陆|中国|落地)/i }
];

REGION_DEFS.forEach(r => {
    const combinedSource = r.city ? `${r.reg.source}|${r.city}` : r.reg.source;
    r._cleanReg = new RegExp(combinedSource, "ig");
    r._matchReg = new RegExp(combinedSource, "i");
    r._cityReg = r.city ? new RegExp(r.city, "i") : null;
});

function operator(proxies, targetPlatform, userConfig = {}) {

    // =========================================================================
    // ⚙️ 初始化配置 (融合顶层默认配置与外部传入配置)
    // =========================================================================
    const CONFIG = { ...DEFAULT_CONFIG, ...userConfig };

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
            return (cp >= 0x1F1E6 && cp <= 0x1F1FF) ? m : ""; 
        });
        name = name.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "");
        name = name.replace(/[\u2190-\u21FF\u2460-\u24FF\u2500-\u27BF\u2B00-\u2BFF]/g, " ");
        return name.replace(REGEX_CLEANUP, "").trim();
    }

    function compressLineArr(arr) {
        const atomSet = new Set(["移", "联", "电"]);
        const comboMap = {
            "电联": new Set(["电","联"]), "移联": new Set(["移","联"]),
            "电移": new Set(["电","移"]), "三网": new Set(["移","联","电"])
        };

        let atomItems = [], nonAtomItems = [];
        for (let item of [...new Set(arr)]) {
            if (atomSet.has(item)) atomItems.push(item);
            else nonAtomItems.push(item);
        }

        const atomCount = new Set(atomItems).size;
        let merged = [];
        if (atomCount >= 3) {
            merged = ["三网"];
        } else if (atomCount === 2) {
            const matchCombo = Object.entries(comboMap).find(([k, members]) =>
                k !== "三网" && members.size === 2 && [...members].every(a => atomItems.includes(a))
            );
            merged = matchCombo ? [matchCombo[0]] : atomItems;
        } else if (atomCount === 1) {
            merged = [atomItems[0]];
        }

        return [...merged, ...nonAtomItems];
    }

    function extractNodeAttributes(name) {
        let attrs = { multiStr: "", entryStr: "", lineArr: [], multiNum: 1.0, bestLineWeight: 99, ispStr: "", asnStr: "" };
        
        // 0. 提取 ISP 和 ASN 信息 (避免被当成无用后缀丢弃)
        name = name.replace(/(Akamai|Cloudflare|Amazon|Oracle|Google|Microsoft|Tencent|Alibaba|DigitalOcean|Linode|Hetzner|OVH|Vultr|Fastly|Edgio|Gcore|Misaka|Kirino)/i, match => {
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
                if (cnKey) short = CN_MAP[cnKey];
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
        for (const r of REGION_DEFS) {
            if (r._matchReg.test(name)) return r;
        }

        if (!CONFIG.strictRegionMatch) {
            const flagMatch = name.match(REGEX_UNKNOWN_FLAG);
            if (flagMatch) {
                return { 
                    id: "other", 
                    icon: flagMatch[1], 
                    name: flagMatch[2].trim(),
                    isUnknown: true,
                    _cleanReg: new RegExp(escapeRegExp(flagMatch[2].trim()), "ig")
                };
            }
        }
        return null;
    }

    function getAirportTag(rawName) {
        if (!CONFIG.enableAirportTag) return "";
        if (CONFIG.airportTag) return CONFIG.airportTag;
        const m = rawName.match(/\[([^\]]{1,4})\]/);
        return m ? m[1] : "";
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
        if (/^fe80[0-9a-f]?:/.test(v6)) return true; // link-local fe80::/10
        if (/^f[cd][0-9a-f]{2}:/i.test(v6)) return true; // ULA fc00::/7
        // IPv4-mapped IPv6: ::ffff:10.x.x.x 等
        const v4Match = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (v4Match) return isPrivateIP(v4Match[1]);
        // 非 IPv4 也非 IPv6 → 域名，放行
        return !v6.includes(':'); // 包含冒号才是 IPv6，否则是域名
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
        if (!looksLikeDomain(domain)) return domain;

        // 方案一：Node.js 系统 DNS（直连，不受墙影响）
        const sysDns = getSystemDns();
        if (sysDns) {
            try {
                const result = await sysDns.promises.lookup(domain, { family: 4 });
                if (result?.address) return result.address;
            } catch {}
        }

        // 方案二：DoH 多端点兜底（阿里优先，国内可达；Google 备用）
        const dohEndpoints = CONFIG.ipApiDnsEndpoint
            ? [CONFIG.ipApiDnsEndpoint]
            : [
                `https://dns.alidns.com/resolve?name=${encodeURIComponent(domain)}&type=A`,
                `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`,
            ];

        for (const url of dohEndpoints) {
            try {
                let data;
                if (http && http.fetch) {
                    const resp = await http.fetch(url, { signal: AbortSignal.timeout(5000) });
                    data = await resp.json();
                } else {
                    data = await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('timeout')), 5000);
                        http.get({ url }, (err, resp) => {
                            clearTimeout(timer);
                            if (err) return reject(err);
                            try { resolve(typeof resp === 'string' ? JSON.parse(resp) : resp); }
                            catch (e) { reject(e); }
                        });
                    });
                }
                const answer = data?.Answer || [];
                const a = answer.find(r => r.type === 1);
                if (a?.data) return a.data;
            } catch {}
        }

        return null;
    }

    /**
     * 批量查询 IP 地理信息
     */
    async function batchQueryIps(ips, http) {
        if (ips.length === 0) return [];
        
        // 动态拼接 URL 和 API 密钥
        const keyParam = CONFIG.ipApiKey ? `&key=${CONFIG.ipApiKey}` : "";
        const url = `${CONFIG.ipApiEndpoint}?fields=status,country,countryCode,city,isp,as,org,query,proxy,hosting,mobile&lang=zh-CN${keyParam}`;
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
                        const ttl = parseInt(resp.headers.get('X-Ttl') || '5', 10); 
                        console.warn(`[IP Enrich] ⚠️ 触发 429 限流，脚本将挂起等待 ${ttl} 秒... (剩余重试: ${retries})`);
                        if (retries === 0) break; 
                        
                        await new Promise(resolve => setTimeout(resolve, (ttl + 1) * 1000));
                        continue; // 醒来后继续循环重试
                    }

                    if (!resp.ok) {
                        const snippet = await resp.text().catch(() => '');
                        console.warn(`[IP Enrich] ⚠️ ip-api 返回 HTTP ${resp.status}: ${snippet.slice(0, 100)}`);
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
                        console.warn(`[IP Enrich] ⚠️ 触发 429 限流，挂起等待 6 秒... (剩余重试: ${retries})`);
                        if (retries === 0) break;
                        await new Promise(resolve => setTimeout(resolve, 6000));
                        continue;
                    }
                }

                // 返回成功的数据
                return Array.isArray(data) ? data : [];
                
            } catch (e) {
                console.warn(`[IP Enrich] ⚠️ 批量查询请求失败: ${e.message}`);
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
     * 🆕 识别是否为知名 CDN/Anycast 供应商
     */
    function isCdnOrAnycast(ipInfo) {
        if (!ipInfo) return false;
        const targetStr = `${ipInfo.isp} ${ipInfo.org} ${ipInfo.as}`.toLowerCase();
        const cdnKeywords = [
            'cloudflare', 'cloudfront', 'fastly', 'akamai', 'gcore', 
            'imperva', 'edgio', 'ddos-guard', 'sucuri', 'incapsula'
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
            if (!item.tags.includes("cdn")) item.tags.push("cdn");
            if (!item.specificFeatures.includes("CDN中转")) item.specificFeatures.push("CDN中转");

            if (item.regionInfo && !item.regionInfo.isUnknown) {
                console.log(`[IP Enrich] 🛡️ 触发防覆盖: [${item.cleanName}] 查出为 CDN(${ipInfo.org})，放弃使用其虚假定位(${ipInfo.country})`);
                
                item._ipSource = true;
                if (ipInfo.isp) item._ipIsp = ipInfo.isp;
                if (ipInfo.org) item._ipOrg = ipInfo.org;
                return; 
            }
        }

        if (CONFIG.ipEnrichMode !== "all" && item.regionInfo && !item.regionInfo.isUnknown) return;

        let regionName = IP_COUNTRY_MAP[ipInfo.countryCode];
        let def = regionName ? REGION_DEFS.find(r => r.name === regionName) : null;

        // 动态兜底：未预定义的地区自动生成国旗 emoji 和区域条目
        if (!def && ipInfo.countryCode && ipInfo.country) {
            regionName = ipInfo.country;
            const icon = String.fromCodePoint(
                0x1F1E6 + ipInfo.countryCode.charCodeAt(0) - 65,
                0x1F1E6 + ipInfo.countryCode.charCodeAt(1) - 65
            );
            def = { name: regionName, icon, _fromDynamic: true, _cleanReg: new RegExp("", "g") };
            console.log(`[IP Enrich] 🆕 动态新增未预定义地区: ${icon} ${regionName} (${ipInfo.countryCode})`);
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
            console.log(`[IP Enrich] 📍 城市校准: [${item._destCity}] -> [${ipInfo.city}]`);
            // 更新为 IP 查到的真实城市
            item._destCity = ipInfo.city; 
        }

        item._ipSource = true;
        if (ipInfo.isp) item._ipIsp = ipInfo.isp;
        if (ipInfo.as) item._ipAsn = ipInfo.as;
        if (ipInfo.org) item._ipOrg = ipInfo.org;
        item._ipProxy = !!ipInfo.proxy;
        item._ipHosting = !!ipInfo.hosting;
        item._ipMobile = !!ipInfo.mobile;

        // 同步更新 groupKey，确保排序编号基于新地区
        item.groupKey = (item.airportTag ? item.airportTag + "__" : "") + def.name;
    }

    /**
     * IP API 补充检测主流程：收集 → 熔断检测 → DNS 解析 → 去重 → 批量查询 → 回填
     */
    async function ipEnrichPhase(nodes) {
        const http = getHttpClient();
        if (!http) { console.log("[IP Enrich] ⚠️ 无可用 HTTP 客户端，跳过 IP 检测"); return; }

        console.log(`[IP Enrich] 🔍 开始 IP 补充检测 (模式: ${CONFIG.ipEnrichMode})`);

        // 🛡️ 第一步：安全熔断机制 (防超时 / 防过度消耗资源)
        let validNodeCount = 0;
        for (const item of nodes) {
            if (!item.isInfo && !item.isGarbage) validNodeCount++;
        }
        
        if (validNodeCount > CONFIG.ipEnrichThreshold) {
            console.warn(`[IP Enrich] 🛑 触发安全熔断！`);
            console.warn(`[IP Enrich] ⚠️ 有效节点数(${validNodeCount}) 超过了安全阈值(${CONFIG.ipEnrichThreshold})。`);
            console.warn(`[IP Enrich] 💡 提示：在 Sub-Store 中大规模并发查 IP 极易导致脚本超时被杀。为保护运行稳定，已自动跳过 IP 检测流程。`);
            return;
        }

        // 第二步：收集需要检测的 server
        const serverToNodes = new Map();
        for (const item of nodes) {
            if (item.isInfo || item.isGarbage) continue;
            if (CONFIG.ipEnrichMode !== "all" && item.regionInfo && !item.regionInfo.isUnknown) continue;
            const server = item.proxy?.server;
            if (!server) continue;
            
            if (!serverToNodes.has(server)) serverToNodes.set(server, []);
            serverToNodes.get(server).push(item);
        }
        if (serverToNodes.size === 0) {
            console.log("[IP Enrich] ✅ 无需补充检测（所有节点已有地区信息）");
            return;
        }
        const collectedTotal = [...serverToNodes.values()].reduce((s, v) => s + v.length, 0);
        console.log(`[IP Enrich] 📡 收集到 ${serverToNodes.size} 个唯一 server，共 ${collectedTotal} 个节点`);

        // 第三步：DNS 批量并发解析域名 → IP，按 IP 去重
        const servers = [...serverToNodes.keys()];
        const resolved = await Promise.all(servers.map(s => resolveDomainToIp(s, http)));
        const ipToNodes = new Map();
        let domainCount = 0, directIpCount = 0;
        for (let i = 0; i < servers.length; i++) {
            const server = servers[i];
            const ip = resolved[i];
            if (ip && !isPrivateIP(ip)) {
                const items = serverToNodes.get(server);
                if (!ipToNodes.has(ip)) ipToNodes.set(ip, []);
                for (const item of items) ipToNodes.get(ip).push(item);
                if (looksLikeDomain(server)) domainCount++; else directIpCount++;
            }
        }
        if (ipToNodes.size === 0) {
            console.log("[IP Enrich] ⚠️ DNS 解析全部失败，无 IP 可查询");
            return;
        }
        const ipNodesTotal = [...ipToNodes.values()].reduce((s, v) => s + v.length, 0);
        console.log(`[IP Enrich] 🌐 DNS 解析完成: ${domainCount} 域名→IP, ${directIpCount} 直连, ${ipToNodes.size} 个唯一 IP (${ipNodesTotal} 节点)`);

        // 第四步：分批批量查询（避免超限）
        const ips = [...ipToNodes.keys()];
        const allResults = [];
        for (let i = 0; i < ips.length; i += CONFIG.ipApiBatchSize) {
            const batch = ips.slice(i, i + CONFIG.ipApiBatchSize);
            console.log(`[IP Enrich] 📦 批量查询第 ${Math.floor(i / CONFIG.ipApiBatchSize) + 1} 批 (${batch.length} IP)...`);
            const batchRes = await batchQueryIps(batch, http);
            allResults.push(...batchRes);
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

        console.log(`[IP Enrich] ✅ 完成: ip-api.com 成功 ${resultMap.size}/${ips.length} IP, ` +
            `回填 ${enrichedCount} 节点${regionDetected > 0 ? `, 识别 ${regionDetected} 个地区` : ""}`);
        if (regionDetected > 0) {
            const byRegion = {};
            for (const item of nodes) {
                if (item.regionInfo?._fromIp) {
                    const n = item.regionInfo.name;
                    byRegion[n] = (byRegion[n] || 0) + 1;
                }
            }
            console.log(`[IP Enrich] 📊 地区分布: ${Object.entries(byRegion).map(([r, c]) => `${r} ${c}`).join(", ")}`);
        }
    }

    // =========================================================================
    // 🚀 第一阶遍历: 提取、清洗与打标
    // =========================================================================
    const proxySet = new Set();
    const processedData = [];
    let dedupeCount = 0;
    let infoCount = 0;
    let discardedCount = 0;

    // 提前处理黑名单（转小写），避免循环内重复开销
    const blockKeywordsLower = (CONFIG.blockKeywords || []).map(k => k.toLowerCase());
    const blockServersLower = (CONFIG.blockServers || []).map(s => s.toLowerCase());

    const BUCKETS = {};
    [...new Set(REGION_DEFS.map(r => r.name)), "garbage", "download", "info", "allStandard", "unknown"].forEach(key => {
        BUCKETS[key] = [];
    });
    FEATURE_RULES.forEach(r => { if (r.tag) BUCKETS[r.tag] = []; });

    proxies.forEach(originalProxy => {
        let proxy = normalizeProxyFields(originalProxy, targetPlatform);
        const rawName = proxy.name || "";
        const tempName = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, "");

        if (REGEX_INFO_NODE.test(tempName)) {
            if (!CONFIG.removeInfoNodes) {
                processedData.push({ proxy, isInfo: true, rawName });
                infoCount++;
            } else {
                discardedCount++;
            }
            return;
        }

        if (CONFIG.enableDedupe) {
            const server = (proxy.server || "").toLowerCase();
            const port = String(proxy.port || "");
            const type = (proxy.type || "").toLowerCase();
            const sni = (proxy.sni || proxy.servername || proxy.peer || proxy["reality-opts"]?.["server-name"] || "").toLowerCase();
            const host = (proxy.host || proxy["ws-opts"]?.headers?.Host || proxy["ws-opts"]?.headers?.host || "").toLowerCase();
            const path = proxy["ws-opts"]?.path || proxy["grpc-opts"]?.["grpc-service-name"] || "";
            const authKey = String(proxy.uuid ?? proxy.password ?? proxy.client_id ?? "");
            
            const key = [server, port, type, sni, host, path, authKey].join('\x01');
            if (proxySet.has(key)) {
                dedupeCount++;
                return;
            }
            proxySet.add(key);
        }

        let isGarbage = false;
        let blockReason = "";
        const tempNameLower = tempName.toLowerCase();
        
        if (blockKeywordsLower.some(k => tempNameLower.includes(k))) {
            isGarbage = true; blockReason = "黑名单关键字";
        } else if (blockServersLower.some(s => (proxy.server || "").toLowerCase().includes(s))) {
            isGarbage = true; blockReason = "黑名单服务器";
        }

        const isFakeIP = REGEX_FAKE_IP.test(proxy.server);
        const isFakeServer = isFakeIP || proxy.server === 'localhost' || proxy.port === 0;
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
                        if (!specificFeatures.includes(fb)) specificFeatures.push(fb);
                    }
                } else {
                    // 非流媒体标签：沿用缩写映射
                    allMatches.forEach(m => {
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
        const airportTag = getAirportTag(rawName);
        const groupKey = (airportTag ? airportTag + "__" : "") + (regionInfo ? regionInfo.name : name);

        processedData.push({
            proxy, rawName, cleanName: name, regionInfo, pType, transportTag,
            groupKey, airportTag, tags: Array.from(tags), specificFeatures, attrs,
            _destCity: destCityStr || null, // 原名字目的地城市，IP 检测后可能被清除
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
            if (a.isGarbage !== b.isGarbage) return a.isGarbage ? 1 : -1;

            const isUnknownA = !a.regionInfo || a.regionInfo.isUnknown;
            const isUnknownB = !b.regionInfo || b.regionInfo.isUnknown;
            if (isUnknownA !== isUnknownB) return isUnknownA ? 1 : -1;

            const orderA = REGION_ORDER[a.regionInfo?.name] ?? 999;
            const orderB = REGION_ORDER[b.regionInfo?.name] ?? 999;
            if (orderA !== orderB) return orderA - orderB;

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

            return (a.rawName || '').localeCompare(b.rawName || '', 'zh-CN');
        });

        const counts = {};
        const groupTrack = {};
        processedData.forEach(d => {
            if (!d.isInfo && !d.isGarbage) counts[d.groupKey] = (counts[d.groupKey] || 0) + 1;
        });

        // 🚀 第二阶遍历: 执行重命名与组装
        const finalProxies = [];
        const nodeMeta = [];

        processedData.forEach(item => {
            if (item.isInfo) {
                if (CONFIG.customPrefix) item.proxy.name = CONFIG.customPrefix + item.proxy.name;
                finalProxies.push(item.proxy);
                BUCKETS.info.push(item.proxy.name);
                nodeMeta.push({ proxy: item.proxy, regionInfo: null, tags: [], groupKey: "info", isInfo: true });
                return;
            }

            if (item.isGarbage) {
                const garbageName = `🗑️ [拦截: ${item.blockReason}] ${item.rawName}`;
                item.proxy.name = garbageName;
                BUCKETS.garbage.push(garbageName);
                if (CONFIG.outputGarbage) finalProxies.push(item.proxy);
                nodeMeta.push({ proxy: item.proxy, regionInfo: null, tags: [], groupKey: "garbage", isInfo: false, isGarbage: true });
                return;
            }

            const { proxy, regionInfo, groupKey, rawName, pType, transportTag, airportTag, tags, specificFeatures } = item;
            groupTrack[groupKey] = (groupTrack[groupKey] || 0) + 1;

            // IP 检测城市：黑名单模式排除不需要城市的城邦地区
            const IGNORE_CITY_REGION = new Set(["香港", "澳门", "新加坡", "台湾"]);
            let finalCity = "";

            // 如果不是城邦地区，提取城市信息
            if (regionInfo && !IGNORE_CITY_REGION.has(regionInfo.name)) {
                // 优先使用 IP 检测出的真实城市，否则使用原名提取出的城市
                finalCity = regionInfo._ipCity || item._destCity || "";
            }

            // 处理其他 IP 补充信息
            const ispStr = item._ipIsp ? cleanIspName(item._ipIsp) : (item.attrs.ispStr || "");
            const orgStr = item._ipOrg ? cleanIspName(item._ipOrg) : (item.attrs.ispStr || "");
            const asnStr = item._ipAsn ? `AS${item._ipAsn.toString().replace(/^AS/i, '')}` : (item.attrs.asnStr || "");

            let finalName;
            let isUnknown = !regionInfo || (regionInfo && regionInfo.isUnknown);
            const myPrefix = CONFIG.customPrefix || "";
            const numStr = counts[groupKey] > 1 ? `[${groupTrack[groupKey].toString().padStart(2, "0")}]` : "";

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
                                const fb = CONFIG.featureBracket || "  ";
                                combinedIcons += `${fb[0] || ""}${specificFeatures.join("/")}${fb[1] || ""}`;
                            }
                        }
                    }

                    finalName = CONFIG.renameTemplate
                        .replace(/\{prefix\}/g, myPrefix)
                        .replace(/\{airport\}/g, airportTag ? `[${airportTag}]` : "")
                        .replace(/\{icon\}/g, regionInfo.icon || "")
                        .replace(/\{region\}/g, regionInfo.name || "")
                        .replace(/\{index\}/g, numStr ? ` ${numStr}` : "")
                        .replace(/\{features\}/g, combinedIcons)
                        .replace(/\{protocol\}/g, UI_ICONS.protocols[pType] || "")
                        .replace(/\{transport\}/g, transportTag || "")
                        .replace(/\{in\}/g, item.attrs.entryStr || "")
                        .replace(/\{line\}/g, item.attrs.cleanLines || "")
                        .replace(/\{multi\}/g, item.attrs.multiStr || "")
                        .replace(/\{city\}/g, finalCity)
                        .replace(/\{isp\}/g, ispStr)
                        .replace(/\{asn\}/g, asnStr)
                        .replace(/\{org\}/g, orgStr)
                        .replace(/\s{2,}/g, " ")                   // 1. 合并因为空占位符产生的多余空格
                        .replace(/\s*[|\-·/]\s*(?=[|\-·/])/g, "")  // 2. 清理相邻的冗余符号 (如 " | · " 变成 " · ")
                        .replace(/\s*[|\-·/]\s*$/g, "")            // 3. 自动清理尾部悬空的符号
                        .trim();

                    // 4. 单独处理可能悬空在最前面的符号
                    finalName = finalName.replace(/^[|\-·/]\s*/, "");
                } else {
                    finalName = `${myPrefix}${item.cleanName}`;
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
                finalProxies.push(proxy);

            } else {
                const coreName = item.rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\ufeff]/g, "");
                finalName = `${myPrefix}❓ 未知 | ${coreName}${numStr ? ' ' + numStr : ''}`
                    .replace(/\s{2,}/g, " ")
                    .trim();
                proxy.name = finalName;
                BUCKETS.unknown.push(finalName);
                if (CONFIG.outputUnknown) finalProxies.push(proxy);
            }

            nodeMeta.push({
                proxy, regionInfo, tags, groupKey,
                isInfo: false, isGarbage: false,
                ipIsp: item._ipIsp || null,
                ipAsn: item._ipAsn || null,
                ipOrg: item._ipOrg || null,
            });
        });

        const stats = {
            total: proxies.length,
            outputCount: finalProxies.length,
            dedupeCount,
            infoCount,
            discardedCount,
            garbageCount: BUCKETS.garbage.length,
            unknownCount: BUCKETS.unknown.length,
            regionCounts: {},
            featureCounts: {}
        };

        Object.keys(BUCKETS).forEach(key => {
            if (["garbage", "download", "info", "allStandard", "unknown"].includes(key)) return;
            if (BUCKETS[key].length > 0) stats.regionCounts[key] = BUCKETS[key].length;
        });
        FEATURE_RULES.forEach(r => {
            if (BUCKETS[r.tag] && BUCKETS[r.tag].length > 0) stats.featureCounts[r.tag] = BUCKETS[r.tag].length;
        });

        return CONFIG.outputMode === "object"
            ? { proxies: finalProxies, meta: { buckets: BUCKETS, stats: stats, nodeMeta: nodeMeta } }
            : finalProxies;
    }

    // 🧩 IP API 补充检测：仅在启用且 HTTP 客户端可用时走异步路径
    if (CONFIG.enableIpEnrich) {
        return (async () => {
            await ipEnrichPhase(processedData);
            return finalizeProcessing();
        })();
    }

    return finalizeProcessing();
}

// 仅在 Node.js CommonJS 环境导出（Sub-Store 忽略此行）
if (typeof module !== 'undefined' && module.exports) module.exports = { operator };