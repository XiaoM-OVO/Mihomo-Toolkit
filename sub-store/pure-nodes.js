/**
 * =========================================================================
 * 📦 Mihomo-Toolkit | Sub-Store 解耦重制版 | 纯净节点清洗脚本 | MIT 许可证
 * =========================================================================
 * 🏷️ 版本: 1.0.0-beta.1 (Build 2026.06.30)
 * 👤 作者: XiaoM-OVO
 * 📝 描述: 专为 Sub-Store 设计的节点处理脚本，提供过滤、去重、重命名与自动排序功能。
 * 🛠️ 功能: 物理去重 | 垃圾节点归档 | 解析倍率与线路 | 批量前缀 | 智能特征图标 | 多维排序
 * 🌐 仓库: https://github.com/XiaoM-OVO/Mihomo-Toolkit
 * -------------------------------------------------------------------------
 */

function operator(proxies, targetPlatform, userConfig = {}) {

    // =========================================================================
    // ⚙️ 默认配置（可被外部传入覆盖）
    // =========================================================================
    const CONFIG = {
        outputMode: "array",          // 🚀 输出模式: "array"纯节点数组, "object"包含 meta 元数据的对象
        outputGarbage: false,         // 🗑️ 垃圾输出: 是否将拦截的广告/假节点也输出(默认不输出,但会进桶)
        outputUnknown: true,          // ❓ 未知输出: 是否将未识别的节点输出(默认输出)
        
        enableStandardRename: true,   // 📝 标准化重命名: 关闭则保留节点原名(防吞词)
        renameTemplate: "{prefix}{airport} {icon} {region}{index} {features} {suffix}", // 🏷️ 自定义命名模板
        
        customPrefix: "",             // 🏷️ 批量自定义前缀(也可通过 {prefix} 模板控制)
        keepDestinationCity: true,    // 🏙️ 保留落地城市
        showRegionIcon: true,         // 🌍 显示地区国旗 Emoji
        showProtocolIcon: false,      // 🏷️ 显示协议图标 Emoji
        showFeatureIcon: false,       // 🌟 显示特征图标 Emoji (即使开启，具体解锁文本也会保留)
        featureBracket: "",           // 🏷️ 特征标签括号: "「」" / "[]" / "()" / "" 留空不显示

        enableDedupe: false,          // 🧽 物理去重 (基于服务器/端口/UUID等多维度)
        removeInfoNodes: false,       // 🗑️ 纯净模式 (直接删除到期说明节点)
        strictRegionMatch: false,     // 🌏 严格地区 (未知国旗不再动态捕获，直接丢入未知组)
        adTextThreshold: 12,          // 🔠 广告阈值 (超过该长度且无特定特征视为广告)
        enableAirportTag: false,      // 🏷️ 提取原机场标签 (例: [Bitz])
        airportTag: "",               // 🏷️ 强制覆盖/指定所有节点的机场标签
        blockKeywords: [],            // 🆕 黑名单关键词，例: ["免费领取", "点击购买"]
        blockServers: [],             // 🆕 屏蔽服务器，例: ["123.123.123.123", "fake.com"]
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
    
    const REGEX_TECH_LINE = /(IEPL|IPLC|CMIN2|CMI|CN2\s*GIA|CN2|GIA|9929|4837|CUG|BGP|AWS|GCP|Oracle|Azure|Hinet|Zenlayer|IIJ|NTT|OCN|Softbank|Transit|Relay|隧道|Direct|HGC|HKBN|PCCW|WTT|HKT|CTCUCM|CTCUM|CTCU|CUCT|CMCU|CTCM|CMCT|三网|电联|移联|电移|移动|联通|电信|专线)/gi;
    const REGEX_FLUFF_LINE = /(高速|极速|优化|起飞|VIP|Premium|Pro|Plus|标准|基础|高级|节点)/gi;
    const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;
    const REGEX_ALL_FLAGS = /\p{Regional_Indicator}{2}/gu;

    const CN_MAP   = { "移动": "移", "联通": "联", "电信": "电", ...(userConfig.cnMap || {}) };
    const LINE_MAP = { "CTCUCM": "三网", "CTCUM": "三网", "CTCU": "电联", "CUCT": "电联", "CMCU": "移联", "CUCM": "移联", "CTCM": "电移", "CMCT": "电移", ...(userConfig.lineMap || {}) };
    const TAG_MAP = {
        "深圳": "深", "SZX": "深", "广州": "广", "CAN": "广",
        "上海": "沪", "PVG": "沪", "SHA": "沪", "北京": "京",
        "PEK": "京", "PKX": "京", "杭州": "杭", "HGH": "杭",
        "四川": "川", "江苏": "苏", "宁波": "甬", "东莞": "莞",
        "南京": "宁", "成都": "蓉", "武汉": "汉", "重庆": "渝", "天津": "津",
        ...(userConfig.tagMap || {})
    };

    const UI_ICONS = {
        protocols: { 
            "ss": "🛩️", "ssr": "🚀", "vmess": "🦊", "vless": "🛸", "trojan": "🐴", 
            "hysteria": "⚡", "hysteria2": "⚡", "tuic": "💨", "wireguard": "🕸️", 
            "snell": "📡", "socks": "🧦", "socks5": "🧦", "http": "🌐", "https": "🌐", 
            "ssh": "💻", "xray": "☢️", "shadowtls": "🛡️", "reality": "🎭"
        },
        features: {
            // specificFeatures 值 → emoji，1:1 映射无冗余（showFeatureIcon 专用）
            "家宽": "🏠", "游戏": "🎮", "流媒体": "📺", "下载": "⏬", "免费": "🆓",
            "gpt": "🤖", "gemini": "♊", "claude": "🦀", "ai": "✨",
            "nf": "🎬", "d+": "🐭", "yt": "▶️", "tk": "🎵", "sp": "🎧",
        }
    };

    const FEATURE_TEXT_MAP = {
        "residential": "家宽", "game": "游戏", "streaming": "流媒体",
        "gemini": "Gemini", "claude": "Claude", "chatgpt": "GPT", "ai": "AI",
        "download": "下载", "free": "免费"
    };

    // 流媒体：数据同源 —— 关键词 → 缩写，避免在正则和映射中各写一遍
    const STREAMING_SERVICES = [
        { keys: ["Netflix", "NF", "奈飞", "网飞", "耐飞"], abbr: "NF" },
        { keys: ["Disney\\+", "Disney", "迪士尼", "D\\+"], abbr: "D+" },
        { keys: ["YouTube", "YT", "油管"], abbr: "YT" },
        { keys: ["TikTok", "抖音海外", "抖音", "TT"], abbr: "TK" },
        { keys: ["Spotify", "声田"], abbr: "SP" },
    ];
    const STREAMING_GENERIC = ["流媒体", "解锁"]; // 无具体服务时兜底

    // 由数据自动生成：正则 source + 缩写查找表
    const STREAMING_SOURCE = [
        ...STREAMING_SERVICES.flatMap(s => s.keys),
        ...STREAMING_GENERIC
    ].map(k => `\\b(?:${k})\\b`).join("|");

    const STREAMING_ABBR = {};
    STREAMING_SERVICES.forEach(s => s.keys.forEach(k => {
        // 剥掉正则转义符（如 Disney\+ → Disney+），得到匹配后的真实文本作为 key
        STREAMING_ABBR[k.replace(/\\/g, "").toLowerCase()] = s.abbr;
    }));

    const FEATURE_RULES_RAW = [
        { source: "(?:家宽|住宅|宽带|原生|Residential|ISP|Home|HKT|HKBN|HGC|WTT|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|So[-_]?net|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)", tag: "residential" },
        { source: "(?:游戏)|\\b(?:Game|FullCone)\\b", tag: "game" },
        { source: "(?:下载)|\\bBT\\b", tag: "download" },
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
        let attrs = { multiStr: "", entryStr: "", lineArr: [], multiNum: 1.0, bestLineWeight: 99 };
        
        name = name.replace(REGEX_ENTRY_CITY, match => {
            let m = match.replace(/[-|>至=\s]/g, "");
            attrs.entryStr = TAG_MAP[m.toUpperCase()] || TAG_MAP[m] || m;
            return "";
        });

        let cleanName = name.replace(REGEX_MULTI, (m, m1, m2, m3) => {
            const num = parseFloat(m1 || m2 || m3);
            if (!isNaN(num)) {
                attrs.multiNum = num;
                if (num !== 1) attrs.multiStr = `x${num}`;
            }
            return "";
        });

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
            attrs.lineArr.push(short || key);
            return "";
        });

        attrs.lineArr = compressLineArr(attrs.lineArr);
        attrs.cleanLines = attrs.lineArr.join("/");

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

    function normalizeProxyFields(originalProxy, platform) {
        let newProxy;
        try {
            newProxy = typeof structuredClone === "function" 
                ? structuredClone(originalProxy) 
                : JSON.parse(JSON.stringify(originalProxy));
        } catch (e) {
            newProxy = { ...originalProxy }; 
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
    // 🚀 第一阶遍历: 提取、清洗与打标
    // =========================================================================
    const proxySet = new Set();
    const processedData = [];
    let dedupeCount = 0;
    let infoCount = 0;
    let discardedCount = 0;

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
            
            const key = `${server}|${port}|${type}|${sni}|${host}|${path}|${authKey}`;
            if (proxySet.has(key)) {
                dedupeCount++;
                return;
            }
            proxySet.add(key);
        }

        let isGarbage = false;
        let blockReason = "";
        const tempNameLower = tempName.toLowerCase();
        
        if (CONFIG.blockKeywords?.some(k => tempNameLower.includes(k.toLowerCase()))) {
            isGarbage = true; blockReason = "黑名单关键字";
        } else if (CONFIG.blockServers?.some(s => (proxy.server || "").toLowerCase().includes(s.toLowerCase()))) {
            isGarbage = true; blockReason = "黑名单服务器";
        }

        const isFakeIP = /^(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|1\.1\.1\.1|8\.8\.8\.8|1\.2\.3\.4|2\.2\.2\.2|3\.3\.3\.3)/.test(proxy.server);
        const isFakeServer = isFakeIP || proxy.server === 'localhost' || proxy.port === 0;
        const isDummyAuth = /^(0{8}-{0,4}-{0,4}-{0,4}-{0,12}|123456|password|dummy)$/i.test(proxy.uuid || proxy.password || "");
        
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
        name = cleanName;

        let tags = new Set();
        let specificFeatures = []; 

        FEATURE_RULES.forEach(rule => {
            // 使用全局匹配 /ig，确保特征都能被搜到
            const allMatches = name.match(new RegExp(rule.source, "ig"));
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
                    name = name.replace(new RegExp(rule.source, "ig"), "");
                }
            }
        });

        const regionInfo = matchNodeRegion(name);
        let destCityStr = "";
        if (CONFIG.keepDestinationCity && regionInfo && regionInfo.city && !regionInfo.isUnknown) {
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
        
        name = name.replace(/[\[\]{}()<>（）【】]/g, "").replace(/[-_\|\s]+/g, " ").trim() || "其他";

        const pType = (proxy.type || "").toLowerCase();
        const suffixArr = [attrs.entryStr, destCityStr, attrs.cleanLines, attrs.multiStr].filter(Boolean);
        const airportTag = getAirportTag(rawName);
        const groupKey = (airportTag ? airportTag + "__" : "") + (regionInfo ? regionInfo.name : name);

        processedData.push({ 
            proxy, rawName, cleanName: name, regionInfo, suffixArr, pType, 
            groupKey, airportTag, tags: Array.from(tags), specificFeatures, attrs, // 传入特定词汇数组
            isInfo: false, isGarbage: false 
        });
    });

    // =========================================================================
    // 🧹 数据排序
    // =========================================================================
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

    // =========================================================================
    // 🚀 第二阶遍历: 执行重命名与组装
    // =========================================================================
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

        const { proxy, regionInfo, groupKey, rawName, suffixArr, pType, airportTag, tags, specificFeatures } = item;
        groupTrack[groupKey] = (groupTrack[groupKey] || 0) + 1;
        
        let finalName;
        let isUnknown = !regionInfo || (regionInfo && regionInfo.isUnknown);
        const myPrefix = CONFIG.customPrefix || "";
        const numStr = counts[groupKey] > 1 ? `[${groupTrack[groupKey].toString().padStart(2, "0")}]` : "";

        if (!isUnknown) {
            if (CONFIG.enableStandardRename) {
                let combinedIcons = "";
                if (CONFIG.showProtocolIcon && UI_ICONS.protocols[pType]) combinedIcons += UI_ICONS.protocols[pType];
                
                if (tags.length > 0) {
                    if (CONFIG.showFeatureIcon) {
                        // 用细粒度 specificFeatures 查 emoji，兜底回退到标签级
                        const items = specificFeatures.length > 0 ? specificFeatures : Array.from(tags);
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
                    .replace(/\{icon\}/g, CONFIG.showRegionIcon ? regionInfo.icon : "")
                    .replace(/\{region\}/g, regionInfo.name)
                    .replace(/\{index\}/g, numStr ? ` ${numStr}` : "") // 空格处理，防止孤立
                    .replace(/\{features\}/g, combinedIcons)
                    .replace(/\{suffix\}/g, suffixArr.length ? `| ${suffixArr.join(" ")}` : "")
                    .replace(/\s{2,}/g, " ") // 清理多余空格
                    .trim();

                // 移除可能的开头多余符号
                if (finalName.startsWith("| ")) finalName = finalName.substring(2);
            } else {
                // 📝 模式B：不开启标准重命名 (保留原名词汇)
                finalName = `${myPrefix}${item.cleanName}`;
            }
            
            // 归入各地区与特征桶
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
            // ❓ 未知节点处理
            const coreName = item.cleanName || rawName;
            finalName = `${myPrefix}${airportTag ? `[${airportTag}] ` : ""}❓ 未知 | ${coreName} ${numStr}`.replace(/\s{2,}/g, " ").trim();
            proxy.name = finalName;
            BUCKETS.unknown.push(finalName);
            if (CONFIG.outputUnknown) finalProxies.push(proxy);
        }

        nodeMeta.push({ proxy, regionInfo, tags, groupKey, isInfo: false, isGarbage: false });
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