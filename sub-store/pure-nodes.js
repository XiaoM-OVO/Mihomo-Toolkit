/**
 * =========================================================================
 * 📦 Mihomo-Toolkit (Sub-Store 解耦重制版) | 纯净节点清洗脚本
 * ------------------------------------------------------------------------
 * 描述: 专为 Sub-Store 提取的节点过滤、去重与重命名脚本
 * 功能: 物理去重 / 垃圾拦截 / 提取倍率线路 / 批量前缀 / 智能特征图标
 * 优化: 白名单地区豁免 + 可配置硬黑名单 + 分级阈值 + 无副作用拷贝
 * 输出: { proxies, array / meta }
 * =========================================================================
 */

function operator(proxies, targetPlatform, userConfig = {}) {
    // =========================================================================
    // ⚙️ 默认配置（可被外部传入覆盖）
    // =========================================================================
    const CONFIG = {
        outputMode: "array",         // 🚀 输出模式: "array"纯节点数组, "object"包含 meta 元数据的对象
        customPrefix: "",            // 🏷️ 批量自定义前缀
        keepDestinationCity: true,   // 🏙️ 保留落地城市
        showProtocolIcon: false,     // 🏷️ 协议图标
        showFeatureIcon: false,      // 🌟 特征图标
        enableDedupe: false,         // 🧽 物理去重
        removeInfoNodes: false,      // 🗑️ 纯净模式（删除说明节点）
        strictRegionMatch: false,    // 🌏 严格地区（未知节点丢弃）
        adTextThreshold: 12,         // 🔠 广告阈值（提高默认值，降低误杀）
        enableAirportTag: false,     // 🏷️ 标签提取
        airportTag: "",              // 🏷️ 强制指定标签
        // 🆕 自定义硬黑名单（留空则关闭）
        blockKeywords: [],           // 例: ["免费领取", "点击购买", "官网地址"]
        blockServers: [],            // 例: ["123.123.123.123", "fake.com"]
        ...userConfig
    };


    // =========================================================================
    // 🪛 核心常量与正则字典
    // =========================================================================
    const REGEX_INFO_NODE = /剩余流量|套餐到期|到期时间|有效时间|过期|更新公告|重置|维护|不可用|扣费|节点说明|防失联|官网|地址|Q群|电报|Tg群|距离下次|测试|关注频道|官方群组|签到获取/i;
    const REGEX_FORBID_DL_STR = "(?:禁止|禁|严禁|请勿|勿|不要|不能|拒绝|屏蔽|防)(?:BT|PT|P2P|下载|测速|迅雷)";
    const REGEX_CLEANUP = new RegExp(`${REGEX_FORBID_DL_STR}|\\b(?:https?:\\/\\/|www\\.)?[a-zA-Z0-9][-a-zA-Z0-9]{1,62}\\.(?:com|net|org|cc|me|vip|pro|top|xyz|club)\\b`, "ig");
    const REGEX_ENTRY_CITY = /(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|SZX|CAN|PVG|SHA|PEK|PKX|HGH|入口|Ingress)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|澳|落地|出口|Exit)/i;
    const REGEX_MULTI = /(?:倍率|Rate)\s*[:：]?\s*(\d+(?:\.\d+)?)|(?<![a-zA-Z])(?:[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍率|倍)?|(\d+(?:\.\d+)?)\s*(?:[xX×]|倍率|倍))(?!\s*\d)/i;
    const REGEX_TECH_LINE = /(IEPL|IPLC|CMIN2|CMI|CN2\s*GIA|CN2|GIA|9929|4837|CUG|BGP|AWS|GCP|Oracle|Azure|Hinet|Zenlayer|IIJ|NTT|OCN|Softbank|Transit|Relay|隧道|Direct|HGC|HKBN|PCCW|WTT|HKT|CTCUCM|CTCUM|CTCU|CUCT|CMCU|CUCM|CTCM|CMCT|三网|电联|移联|电移|移动|联通|电信|专线)/gi;
    const REGEX_FLUFF_LINE = /(高速|极速|优化|起飞|VIP|Premium|Pro|Plus|标准|基础|高级|节点)/gi;
    const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;
    const REGEX_ALL_FLAGS = /\p{Regional_Indicator}{2}/gu;

    const CN_MAP   = { "移动": "移", "联通": "联", "电信": "电" };
    const LINE_MAP = { "CTCUCM": "三网", "CTCUM": "三网", "CTCU": "电联", "CUCT": "电联", "CMCU": "移联", "CUCM": "移联", "CTCM": "电移", "CMCT": "电移" };
    const TAG_MAP = { 
        "深圳": "深", "SZX": "深", "广州": "广", "CAN": "广", 
        "上海": "沪", "PVG": "沪", "SHA": "沪", "北京": "京", 
        "PEK": "京", "PKX": "京", "杭州": "杭", "HGH": "杭", 
        "四川": "川", "江苏": "苏", "宁波": "甬", "东莞": "莞",
        "南京": "宁", "成都": "蓉", "武汉": "汉", "重庆": "渝", "天津": "津"
    };

    const UI_ICONS = {
        protocols: { "ss": "🛩️", "ssr": "🚀", "vmess": "🦊", "vless": "🛸", "trojan": "🐴", "hysteria": "⚡", "hysteria2": "⚡", "tuic": "💨", "wireguard": "🕸️", "snell": "📡", "socks": "🧦", "socks5": "🧦", "http": "🌐", "https": "🌐", "ssh": "💻" },
        features: { 
            "residential": "🏠", "game": "🎮", "streaming": "📺", 
            "gemini": "♊", "claude": "🦀", "chatgpt": "🤖", "ai": "✨",
            "download": "⏬", "free": "🆓" 
        }
    };

    // 🌟 特征识别字典
    const FEATURE_RULES = [
        { reg: /(?:家宽|住宅|宽带|原生|Residential|ISP|Home|HKT|HKBN|HGC|WTT|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|So[-_]?net|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)/i, _cleanReg: /(?:家宽|住宅|宽带|原生|Residential|ISP|Home|HKT|HKBN|HGC|WTT|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|So[-_]?net|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)/ig, tag: "residential" },
        { reg: /(?:游戏)|\b(?:Game|FullCone)\b/i, _cleanReg: /(?:游戏)|\b(?:Game|FullCone)\b/ig, tag: "game" },
        { reg: /(?:下载)|\bBT\b/i, _cleanReg: /(?:下载)|\bBT\b/ig, tag: "download" },
        { reg: /(?:免费|白嫖|公益)/i, _cleanReg: /(?:免费|白嫖|公益)/ig, tag: "free" },
        { reg: /\b(?:Gemini)\b/i, _cleanReg: /\b(?:Gemini)\b/ig, tag: "gemini" },
        { reg: /\b(?:Claude)\b/i, _cleanReg: /\b(?:Claude)\b/ig, tag: "claude" },
        { reg: /\b(?:ChatGPT|OpenAI|GPT)\b/i, _cleanReg: /\b(?:ChatGPT|OpenAI|GPT)\b/ig, tag: "chatgpt" },
        { reg: /\b(?:AI解锁|AI)\b/i, _cleanReg: /\b(?:AI解锁|AI)\b/ig, tag: "ai" },
        { reg: /\b(?:Netflix|NF|奈飞|网飞|耐飞|YouTube|YT|油管|Disney\+|Disney|迪士尼|D\+|TikTok|抖音海外|TT|Spotify|声田|流媒体|解锁)\b/i, _cleanReg: /\b(?:Netflix|NF|奈飞|网飞|耐飞|YouTube|YT|油管|Disney\+|Disney|迪士尼|D\+|TikTok|抖音海外|TT|Spotify|声田|流媒体|解锁)\b/ig, tag: "streaming" }
    ];

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
        { name: "印度", icon: "🇮🇳", city: "孟买|新德里", reg: /印度|(?<![a-zA-Z])IN(?![a-zA-Z])|India/i },
        { name: "澳门", icon: "🇲🇴", reg: /澳门|澳門|Macau|Macao|(?<![a-zA-Z])CTM(?![a-zA-Z])/i },
        { name: "中国", icon: "🇨🇳", city: "深圳|广州|上海|北京|杭州|成都|武汉|南京", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(CN|PRC)(?![a-zA-Z])|China|(?:美|日|韩|新|港|台|英|德|法|澳)(?:-|->|至|=>|\s)*(?:京|沪|广|深|国内|大陆|中国|落地)/i }
    ];

    // 预编译地区匹配对象
    REGION_DEFS.forEach(r => {
        const combinedSource = r.city ? `${r.reg.source}|${r.city}` : r.reg.source;
        r._cleanReg = new RegExp(combinedSource, "ig");
        r._matchReg = new RegExp(combinedSource, "i");
        r._cityReg = r.city ? new RegExp(r.city, "i") : null;
    });

    // =========================================================================
    // 🛠️ 辅助函数
    // =========================================================================
    function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function sanitizeNodeName(rawName) {
        let name = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, "");
        name = name.replace(/\p{Extended_Pictographic}/gu, m => {
            const cp = m.codePointAt(0);
            return (cp >= 0x1F1E6 && cp <= 0x1F1FF) ? m : ""; 
        });
        name = name.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "");
        name = name.replace(/[\u2190-\u21FF\u2460-\u24FF\u2500-\u27BF\u2B00-\u2BFF]/g, " ");
        return name.replace(REGEX_CLEANUP, "").trim();
    }

    function extractNodeAttributes(name) {
        let attrs = { multiStr: "", entryStr: "", lineArr: [] };
        
        // 入口城市提取
        name = name.replace(REGEX_ENTRY_CITY, match => {
            let m = match.replace(/[-|>至=\s]/g, "");
            attrs.entryStr = TAG_MAP[m.toUpperCase()] || TAG_MAP[m] || m;
            return "";
        });

        // 倍率提取
        let cleanName = name.replace(REGEX_MULTI, (m, m1, m2, m3) => {
            const num = parseFloat(m1 || m2 || m3);
            if (!isNaN(num) && num !== 1) attrs.multiStr = `x${num}`;
            return "";
        });

        // 技术线路匹配
        cleanName = cleanName.replace(REGEX_TECH_LINE, match => {
            let key = match.toUpperCase();
            let short = LINE_MAP[key];
            if (!short) {
                const cnKey = Object.keys(CN_MAP).find(k => match.includes(k));
                if (cnKey) short = CN_MAP[cnKey];
            }
            if (short) attrs.lineArr.push(short);
            return "";
        });

        // 🆕 压缩技术线路简称
        attrs.lineArr = compressLineArr(attrs.lineArr);
        attrs.cleanLines = attrs.lineArr.join("/");
        
        return { attrs, cleanName };
    }
    function compressLineArr(arr) {
    const atoms = ["移", "联", "电"];
    const comboMap = {
        "电联": ["电","联"],
        "移联": ["移","联"],
        "电移": ["电","移"],
        "三网": ["移","联","电"]
    };
    const comboKeys = Object.keys(comboMap);

    let unique = [...new Set(arr)];
    if (unique.includes("三网")) return ["三网"];

    // 检查是否所有原子都被覆盖（不论是通过组合词还是单原子）
    let covered = new Set();
    for (let item of unique) {
        if (comboKeys.includes(item)) {
            comboMap[item].forEach(a => covered.add(a));
        } else if (atoms.includes(item)) {
            covered.add(item);
        }
    }
    if (covered.size === 3) return ["三网"];

    // 否则，如果单原子已被某个组合词包含，则移除该单原子
    let result = [];
    for (let item of unique) {
        if (atoms.includes(item) && comboKeys.some(k => comboMap[k].includes(item))) {
            continue; // 跳过被组合词覆盖的原子
        }
        result.push(item);
    }
    return [...new Set(result)];
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

    // 🆕 字段归一化函数（浅拷贝版本，无副作用）
    function normalizeProxyFields(proxy, platform) {
        // 总是返回新对象，避免污染原始数据
        if (!platform || platform === "clash") return { ...proxy };
        
        const newProxy = { ...proxy };
        // 字段别名映射表
        const aliasMap = {
            sni: ["sni", "servername", "server-name", "tls.servername"],
            host: ["host", "hostname", "http-host"],
            password: ["password", "auth", "key"],
            uuid: ["uuid", "id", "user-id"],
            port: ["port", "listen-port"],
            server: ["server", "address", "hostname"]
        };
        
        // 对每个标准字段，尝试从别名中取值并填充
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
    // 🚀 核心处理循环 (两阶段遍历)
    // =========================================================================
    const proxySet = new Set();
    const processedData = [];
    let dedupeCount = 0;
    let infoCount = 0;
    let discardedCount = 0;

    // 初始化桶（用于返回元数据）
    const BUCKETS = {};
    // 注册所有地区和特征池
    [...new Set(REGION_DEFS.map(r => r.name)), "garbage", "download", "info", "allStandard"].forEach(key => {
        BUCKETS[key] = [];
    });
    FEATURE_RULES.forEach(r => {
        if (r.tag) BUCKETS[r.tag] = [];
    });
    // 额外为 unknown 预留
    BUCKETS.unknown = [];

    // --- 第一阶遍历：属性提取、过滤去重 ---
    proxies.forEach(originalProxy => {
        // 1. 浅拷贝，避免副作用
        let proxy = normalizeProxyFields(originalProxy, targetPlatform);
        
        let rawName = proxy.name || "";
        let tempName = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, "");

        // --- 信息节点优先拦截 ---
        if (REGEX_INFO_NODE.test(tempName)) {
            if (!CONFIG.removeInfoNodes) {
                processedData.push({ proxy, isInfo: true, rawName });
                infoCount++;
            } else {
                discardedCount++;
            }
            return;
        }

        // --- 物理去重 ---
        if (CONFIG.enableDedupe) {
            const server = (proxy.server || "").toLowerCase();
            const port = proxy.port || "";
            const type = proxy.type || "";
            const sni = (proxy.sni || proxy.servername || proxy["reality-opts"]?.["server-name"] || "").toLowerCase();
            const host = (proxy.host || proxy["ws-opts"]?.headers?.Host || proxy["ws-opts"]?.headers?.host || "").toLowerCase();
            const path = proxy["ws-opts"]?.path || proxy["grpc-opts"]?.["grpc-service-name"] || "";
            const authKey = proxy.uuid || proxy.password || proxy.client_id || "";
            
            const key = `${server}|${port}|${type}|${sni}|${host}|${path}|${authKey}`;
            if (proxySet.has(key)) {
                dedupeCount++;
                return;
            }
            proxySet.add(key);
        }

        // ================================================================
        // 🧹 优化版：智能垃圾拦截（白名单豁免 + 硬黑名单 + 分级阈值）
        // ================================================================

        // 1️⃣ 用户自定义硬黑名单（名称关键词 & 服务器地址关键词）
        const blockKeywords = CONFIG.blockKeywords || [];
        const blockServers = CONFIG.blockServers || [];
        if (blockKeywords.some(k => tempName.includes(k))) {
            discardedCount++;
            return;
        }
        if (blockServers.some(s => (proxy.server || "").includes(s))) {
            discardedCount++;
            return;
        }

        // 2️⃣ 伪造服务器（捕获常见占位符）
        const fakeIPs = ['127.0.0.1', '0.0.0.0', '1.1.1.1', '8.8.8.8', 
                         '1.2.3.4', '2.2.2.2', '3.3.3.3', 'localhost'];
        const isFakeServer = fakeIPs.some(ip => (proxy.server || "").toLowerCase().includes(ip)) 
                             || proxy.port === 0;
        const isDummyAuth = /^(0{8}-{0,4}-{0,4}-{0,4}-{0,12}|123456|password|dummy)$/i
                             .test(proxy.uuid || proxy.password || "");
        if (isFakeServer || isDummyAuth) {
            discardedCount++;
            return;
        }

        // 3️⃣ 智能孤儿广告检测（白名单豁免机制）
        const hasDigit = /\d/.test(tempName);
        const hasTechLine = REGEX_TECH_LINE.test(tempName);
        const hasFluff = REGEX_FLUFF_LINE.test(tempName);
        
        // 关键优化：提前匹配地区（只要有地区名，就给与极高的宽容度）
        const hasValidRegion = REGION_DEFS.some(r => r._matchReg.test(tempName));

        // 去掉表情和括号后的纯文本长度
        const cleanText = tempName.replace(/[\[\]]/g, "").replace(/\p{Extended_Pictographic}/gu, "").trim();
        const cleanLength = cleanText.length;
        
        // 阈值分级：有地区的节点，阈值放宽到 20；无地区的，使用用户配置（默认 12）
        const effectiveThreshold = hasValidRegion 
            ? Math.max(CONFIG.adTextThreshold || 12, 18)
            : (CONFIG.adTextThreshold || 12);
        
        const isTooLong = cleanLength > effectiveThreshold;

        let isGarbage = false;

        if (hasValidRegion) {
            // ✅ 包含有效地区（白名单豁免区）
            // 只有同时满足【超长 + 无数字 + 无技术线路】才判定为伪装广告
            if (isTooLong && !hasDigit && !hasTechLine) {
                isGarbage = true;
            }
        } else {
            // ❌ 不包含有效地区 -> 严格检测
            if (isTooLong && !hasDigit && !hasTechLine) {
                isGarbage = true;
            }
            // 额外的：如果连 fluff（优化/高速）都没有，且长度>10，大概率是垃圾通知
            if (!hasFluff && cleanLength > 10 && !hasDigit && !hasTechLine) {
                isGarbage = true;
            }
        }

        if (isGarbage) {
            discardedCount++;
            return;
        }

        // ================================================================
        // 继续正常处理
        // ================================================================
        let name = sanitizeNodeName(rawName);
        const { attrs, cleanName } = extractNodeAttributes(name);
        name = cleanName;

        // 特征提取
        let tags = new Set();
        FEATURE_RULES.forEach(rule => {
            if (rule.reg.test(name)) {
                tags.add(rule.tag);
                name = name.replace(rule._cleanReg, "");
            }
        });

        // 4. 地区匹配
        const regionInfo = matchNodeRegion(name);
        let destCityStr = "";
        if (CONFIG.keepDestinationCity && regionInfo && regionInfo.city && !regionInfo.isUnknown) {
            const cityMatch = rawName.match(regionInfo._cityReg);
            if (cityMatch) destCityStr = cityMatch[0];
        }

        if (regionInfo) {
            if (regionInfo.isUnknown) {
                name = name.replace(REGEX_ALL_FLAGS, "").replace(regionInfo.name, "");
            } else {
                name = name.replace(REGEX_ALL_FLAGS, "").replace(regionInfo._cleanReg, "");
            }
        }
        
        name = name.replace(/[\[\]{}()<>（）【】]/g, "").replace(/[-_\|\s]+/g, " ").trim() || "未知";

        const pType = (proxy.type || "").toLowerCase();
        const suffixArr = [attrs.entryStr, destCityStr, attrs.cleanLines, attrs.multiStr].filter(Boolean);
        const airportTag = getAirportTag(rawName);
        const groupKey = (airportTag ? airportTag + "__" : "") + (regionInfo ? regionInfo.name : name);

        processedData.push({
            proxy,
            rawName,
            regionInfo,
            suffixArr,
            pType,
            groupKey,
            airportTag,
            tags: Array.from(tags),
            isInfo: false
        });
    });

    // --- 计数与排序（保证序号连贯） ---
    const counts = {};
    const groupTrack = {};
    processedData.forEach(d => {
        if (!d.isInfo) counts[d.groupKey] = (counts[d.groupKey] || 0) + 1;
    });

    // --- 第二阶遍历：组装重命名，并填充桶 ---
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

        const { proxy, regionInfo, groupKey, rawName, suffixArr, pType, airportTag, tags } = item;
        groupTrack[groupKey] = (groupTrack[groupKey] || 0) + 1;
        
        const numStr = counts[groupKey] > 1 ? ` [${groupTrack[groupKey].toString().padStart(2, "0")}]` : "";
        const airportTagStr = airportTag ? `[${airportTag}] ` : "";
        const myPrefix = CONFIG.customPrefix || "";
        
        let finalName;
        let isGarbage = false;

        if (regionInfo) {
            // 正常地区节点
            finalName = `${myPrefix}${airportTagStr}${regionInfo.icon} ${regionInfo.name}${numStr}`;
            
            let combinedIcons = "";
            if (CONFIG.showProtocolIcon && UI_ICONS.protocols[pType]) combinedIcons += UI_ICONS.protocols[pType];
            if (CONFIG.showFeatureIcon && tags && tags.length > 0) {
                tags.forEach(tag => { if (UI_ICONS.features[tag]) combinedIcons += UI_ICONS.features[tag]; });
            }
            if (combinedIcons) finalName += ` ${combinedIcons}`;
            if (suffixArr.length) finalName += ` | ${suffixArr.join(" ")}`;
        } else {
            // 未知节点
            if (CONFIG.strictRegionMatch) {
                // 丢弃
                discardedCount++;
                return;
            }
            // 保留，标记为未知
            const coreName = name || rawName;
            finalName = `${myPrefix}${airportTagStr}❓ 未知 | ${coreName}${numStr}`;
            isGarbage = true;
        }

        proxy.name = finalName;
        finalProxies.push(proxy);

        // 填充桶
        if (isGarbage) {
            BUCKETS.garbage.push(finalName);
        } else if (regionInfo && regionInfo.isUnknown) {
            BUCKETS.unknown.push(finalName);
        } else if (regionInfo) {
            const regionKey = regionInfo.name;
            if (!BUCKETS[regionKey]) BUCKETS[regionKey] = [];
            BUCKETS[regionKey].push(finalName);
            BUCKETS.allStandard.push(finalName);
            // 特征池
            tags.forEach(tag => {
                if (!BUCKETS[tag]) BUCKETS[tag] = [];
                BUCKETS[tag].push(finalName);
            });
            // 特殊: 下载隔离
            if (tags.includes("download")) {
                BUCKETS.download.push(finalName);
            }
        } else {
            // 实际上不会到这里，因为上面已处理
        }

        // 记录元数据
        nodeMeta.push({
            proxy,
            regionInfo,
            tags,
            groupKey,
            isInfo: false,
            isGarbage
        });
    });

    // 统计信息
    const stats = {
        total: proxies.length,
        dedupeCount,
        infoCount,
        discardedCount,
        garbageCount: BUCKETS.garbage.length,
        unknownCount: BUCKETS.unknown.length,
        regionCounts: {},
        featureCounts: {}
    };
    // 统计各桶大小
    Object.keys(BUCKETS).forEach(key => {
        if (key === "garbage" || key === "download" || key === "info" || key === "allStandard" || key === "unknown") return;
        if (BUCKETS[key].length > 0) stats.regionCounts[key] = BUCKETS[key].length;
    });
    FEATURE_RULES.forEach(r => {
        if (BUCKETS[r.tag] && BUCKETS[r.tag].length > 0) stats.featureCounts[r.tag] = BUCKETS[r.tag].length;
    });

    // =========================================================================
    // 🚀 返回数据 (根据输出模式开关智能返回)
    // =========================================================================
    if (CONFIG.outputMode === "object") {
        // 高级模式：返回带策略元数据的对象
        return {
            proxies: finalProxies,
            meta: {
                buckets: BUCKETS,
                stats: stats,
                nodeMeta: nodeMeta
            }
        };
    } else {
        // 通用模式（默认）：直接返回节点数组，兼容一切 Sub-Store 常规流程
        return finalProxies;
    }
}