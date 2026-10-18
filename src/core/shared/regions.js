/**
 * 地区识别字典与大洲分组 (Region SSOT)
 *
 * 维护标准地区元数据、国旗 Emoji、图标资源、落地城市及匹配正则。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 贡献新国家/大区 Checklist：
 * 1. 查找同大区条目复制对象，保证必填字段齐全：
 *    { id, code, name, groupName, continent, subGroup, foldGroup, icon, iconFile, reg }
 * 2. 两字母代码若为英文常用词（如 IT/IS/IN/MY/AT/BE/PT），必须通过 codeReg 配置严格大写匹配，
 *    禁止直接并入忽略大小写的 reg，防止与节点名常用英文单词产生误匹配；
 * 3. city 城市名需确保尽量全局唯一，避免跨洲撞名；
 * 4. 大洲/次大区扩展只需在 CONTINENT_DEFS 或 SUB_REGION_DEFS 声明 aliases，别名表自动派生；
 * 5. 运行 npm test 验证 validateMapping() 契约自检通过。
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { SINGLE_EXIT_LOOKAHEAD } = require('../../data/cleaner-rules');

// 顺序决定排序优先级与节点桶名 (全量标准化规范契约)
const REGION_DEFS_RAW = [
  // --- 大中华区 ---
  {
    id: "cn",
    code: "CN",
    name: "中国",
    groupName: "大陆节点",
    continent: "asia",
    subGroup: "ea",
    icon: "🇨🇳",
    iconFile: "CN.png",
    city: "深圳|广州|上海|北京|杭州|成都|武汉|南京",
    // 说明：包含针对反向回国节点的正则 "(海外入口)->(国内落地)"。
    // 在 geo.js 中采用最长匹配优先原则（如 "美->沪" 长度 4 优于 "美" 长度 1），确保稳定落地至中国。
    reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(?:CN(?!2)|PRC)(?![a-zA-Z])|China|(?:美|日|韩|新|港|台|英|德|法|澳)(?:-|->|至|=>|\s)*(?:京|沪|广|深|国内|大陆|中国|落地)/i
  },
  {
    id: "hk",
    code: "HK",
    name: "香港",
    groupName: "香港节点",
    continent: "asia",
    subGroup: "ea",
    icon: "🇭🇰",
    iconFile: "HK.png",
    reg: new RegExp(`香港|香江|(?<![空海端])港${SINGLE_EXIT_LOOKAHEAD.港}|(?<![a-zA-Z])(?:HK|HKT|HKBN|HGC|WTT|PCCW)(?![a-zA-Z])|Hong Kong`, "i")
  },
  {
    id: "mo",
    code: "MO",
    name: "澳门",
    groupName: "澳门节点",
    continent: "asia",
    subGroup: "ea",
    icon: "🇲🇴",
    iconFile: "MO.png",
    reg: /澳门|澳門|Macau|Macao|(?<![a-zA-Z])CTM(?![a-zA-Z])/i
  },
  {
    id: "tw",
    code: "TW",
    name: "台湾",
    groupName: "台湾节点",
    continent: "asia",
    subGroup: "ea",
    icon: "🇹🇼",
    iconFile: "TW.png",
    city: "台北|新北|台中|高雄|彰化",
    reg: new RegExp(`台湾|台灣|(?<![平前后戏平台])台${SINGLE_EXIT_LOOKAHEAD.台}|(?<![a-zA-Z])(?:TW|APTG)(?![a-zA-Z])|Taiwan|Hinet|Kbro|Seednet`, "i")
  },

  // --- 亚洲核心区 ---
  {
    id: "jp",
    code: "JP",
    name: "日本",
    groupName: "日本节点",
    continent: "asia",
    subGroup: "ea",
    icon: "🇯🇵",
    iconFile: "JP.png",
    city: "东京|大阪|埼玉|京都|川崎",
    reg: new RegExp(`日本|日${SINGLE_EXIT_LOOKAHEAD.日}|(?<![a-zA-Z])(?:JP|OCN)(?![a-zA-Z])|Japan|Nuro|Plala`, "i")
  },
  {
    id: "kr",
    code: "KR",
    name: "韩国",
    groupName: "韩国节点",
    continent: "asia",
    subGroup: "ea",
    icon: "🇰🇷",
    iconFile: "KR.png",
    city: "首尔|春川",
    reg: /韩国|韩(?![信国])|(?<![a-zA-Z])KR(?![a-zA-Z])|Korea/i
  },
  {
    id: "sg",
    code: "SG",
    name: "新加坡",
    groupName: "新加坡节点",
    continent: "asia",
    subGroup: "sea",
    foldGroup: "sea",
    icon: "🇸🇬",
    iconFile: "SG.png",
    city: "狮城",
    reg: new RegExp(`新加坡|新${SINGLE_EXIT_LOOKAHEAD.新}|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore|Singtel|StarHub|MyRepublic|ViewQwest`, "i")
  },

  // --- 北美大区 ---
  {
    id: "us",
    code: "US",
    name: "美国",
    groupName: "美国节点",
    continent: "americas",
    subGroup: "na",
    foldGroup: "am",
    icon: "🇺🇸",
    iconFile: "US.png",
    city: "洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|亚特兰大|凤凰城|硅谷|纽约|迈阿密|华盛顿",
    reg: new RegExp(`美国|西美|美西|美东|(?<![完优赞欧])美${SINGLE_EXIT_LOOKAHEAD.美}|(?<![a-zA-Z])(?:US|LAX)(?![a-zA-Z])|Los Angeles|America|United States`, "i")
  },

  // --- 欧洲大区 ---
  {
    id: "uk",
    code: "GB",
    name: "英国",
    groupName: "英国节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇬🇧",
    iconFile: "UK.png",
    city: "伦敦|費勒姆",
    reg: /英国|(?<![a-zA-Z])UK(?![a-zA-Z])|United Kingdom|Britain/i
  },
  {
    id: "de",
    code: "DE",
    name: "德国",
    groupName: "德国节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇩🇪",
    iconFile: "DE.png",
    city: "法兰克福",
    reg: /德国|(?<![a-zA-Z])DE(?![a-zA-Z])|Germany/i
  },
  {
    id: "fr",
    code: "FR",
    name: "法国",
    groupName: "法国节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇫🇷",
    iconFile: "FR.png",
    city: "巴黎",
    reg: /法国|(?<![a-zA-Z])FR(?![a-zA-Z])|France/i
  },
  {
    id: "ru",
    code: "RU",
    name: "俄罗斯",
    groupName: "俄罗斯节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇷🇺",
    iconFile: "RU.png",
    city: "莫斯科|伯力|圣彼得堡|新西伯利亚",
    reg: /俄罗斯|(?<![a-zA-Z])RU(?![a-zA-Z])|Russia/i
  },
  {
    id: "ua",
    code: "UA",
    name: "乌克兰",
    groupName: "乌克兰节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇺🇦",
    iconFile: "UA.png",
    city: "基辅",
    reg: /乌克兰|(?<![a-zA-Z])UA(?![a-zA-Z])|Ukraine/i
  },
  {
    id: "es",
    code: "ES",
    name: "西班牙",
    groupName: "西班牙节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇪🇸",
    iconFile: "ES.png",
    city: "马德里",
    reg: /西班牙|(?<![a-zA-Z])ES(?![a-zA-Z])|Spain/i
  },
  {
    id: "nl",
    code: "NL",
    name: "荷兰",
    groupName: "荷兰节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇳🇱",
    iconFile: "NL.png",
    city: "阿姆斯特丹",
    reg: /荷兰|(?<![a-zA-Z])NL(?![a-zA-Z])|Netherlands/i
  },
  {
    id: "ch",
    code: "CH",
    name: "瑞士",
    groupName: "瑞士节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇨🇭",
    iconFile: "CH.png",
    city: "苏黎世|日内瓦",
    reg: /瑞士|(?<![a-zA-Z])CH(?![a-zA-Z])|Switzerland/i
  },
  {
    id: "it",
    code: "IT",
    name: "意大利",
    groupName: "意大利节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇮🇹",
    iconFile: "IT.png",
    city: "米兰|罗马",
    reg: /意大利|Italy/i,
    // 注意：两字母代码 IT 为常用英文单词，绝不能加 i 标志做不区分大小写匹配，必须严格大写匹配
    codeReg: /(?<![a-zA-Z])IT(?![a-zA-Z])/
  },
  {
    id: "se",
    code: "SE",
    name: "瑞典",
    groupName: "瑞典节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇸🇪",
    iconFile: "SE.png",
    city: "斯德哥尔摩",
    reg: /瑞典|(?<![a-zA-Z])SE(?![a-zA-Z])|Sweden/i
  },
  {
    id: "ie",
    code: "IE",
    name: "爱尔兰",
    groupName: "爱尔兰节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇮🇪",
    iconFile: "IE.png",
    city: "都柏林",
    reg: /爱尔兰|(?<![a-zA-Z])IE(?![a-zA-Z])|Ireland/i
  },
  {
    id: "pl",
    code: "PL",
    name: "波兰",
    groupName: "波兰节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇵🇱",
    iconFile: "PL.png",
    city: "华沙",
    reg: /波兰|(?<![a-zA-Z])PL(?![a-zA-Z])|Poland/i
  },
  {
    id: "fi",
    code: "FI",
    name: "芬兰",
    groupName: "芬兰节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇫🇮",
    iconFile: "FI.png",
    city: "赫尔辛基",
    reg: /芬兰|(?<![a-zA-Z])FI(?![a-zA-Z])|Finland/i
  },
  {
    id: "is",
    code: "IS",
    name: "冰岛",
    groupName: "冰岛节点",
    continent: "europe",
    subGroup: "eu",
    foldGroup: "eu",
    icon: "🇮🇸",
    iconFile: "IS.png",
    city: "雷克雅未克",
    reg: /冰岛|Iceland/i,
    // 注意：两字母代码 IS 为常用英文单词 (is)，必须严格大写匹配
    codeReg: /(?<![a-zA-Z])IS(?![a-zA-Z])/
  },

  // --- 南亚大区 ---
  {
    id: "in",
    code: "IN",
    name: "印度",
    groupName: "印度节点",
    continent: "asia",
    subGroup: "sas",
    foldGroup: "sas",
    icon: "🇮🇳",
    iconFile: "IN.png",
    city: "孟买|新德里",
    reg: /印度|India/i,
    // 注意：两字母代码 IN 为常用英文单词 (in)，必须严格大写匹配
    codeReg: /(?<![a-zA-Z])IN(?![a-zA-Z])/
  },

  // --- 东南亚大区 ---
  {
    id: "my",
    code: "MY",
    name: "马来西亚",
    groupName: "马来西亚节点",
    continent: "asia",
    subGroup: "sea",
    foldGroup: "sea",
    icon: "🇲🇾",
    iconFile: "MY.png",
    city: "吉隆坡",
    reg: /马来|马来西亚|Malaysia/i,
    // 注意：两字母代码 MY 为常用英文单词 (my)，必须严格大写匹配
    codeReg: /(?<![a-zA-Z])MY(?![a-zA-Z])/
  },
  {
    id: "th",
    code: "TH",
    name: "泰国",
    groupName: "泰国节点",
    continent: "asia",
    subGroup: "sea",
    foldGroup: "sea",
    icon: "🇹🇭",
    iconFile: "TH.png",
    city: "曼谷",
    reg: /泰国|(?<![a-zA-Z])TH(?![a-zA-Z])|Thailand/i
  },
  {
    id: "id",
    code: "ID",
    name: "印尼",
    groupName: "印尼节点",
    continent: "asia",
    subGroup: "sea",
    foldGroup: "sea",
    icon: "🇮🇩",
    iconFile: "ID.png",
    city: "雅加达",
    reg: /印尼|印度尼西亚|(?<![a-zA-Z])ID(?![a-zA-Z])|Indonesia/i
  },
  {
    id: "ph",
    code: "PH",
    name: "菲律宾",
    groupName: "菲律宾节点",
    continent: "asia",
    subGroup: "sea",
    foldGroup: "sea",
    icon: "🇵🇭",
    iconFile: "PH.png",
    city: "马尼拉",
    reg: /菲律宾|(?<![a-zA-Z])PH(?![a-zA-Z])|Philippines/i
  },
  {
    id: "vn",
    code: "VN",
    name: "越南",
    groupName: "越南节点",
    continent: "asia",
    subGroup: "sea",
    foldGroup: "sea",
    icon: "🇻🇳",
    iconFile: "VN.png",
    city: "胡志明|河内",
    reg: /越南|(?<![a-zA-Z])VN(?![a-zA-Z])|Vietnam/i
  },

  // --- 美洲大区 ---
  {
    id: "ca",
    code: "CA",
    name: "加拿大",
    groupName: "加拿大节点",
    continent: "americas",
    subGroup: "na",
    foldGroup: "am",
    icon: "🇨🇦",
    iconFile: "CA.png",
    city: "多伦多|温哥华|蒙特利尔",
    reg: /加拿大|(?<![a-zA-Z])CA(?![a-zA-Z])|Canada/i
  },
  {
    id: "ar",
    code: "AR",
    name: "阿根廷",
    groupName: "阿根廷节点",
    continent: "americas",
    subGroup: "latam",
    foldGroup: "am",
    icon: "🇦🇷",
    iconFile: "AR.png",
    city: "布宜诺斯艾利斯",
    reg: /阿根廷|(?<![a-zA-Z])AR(?![a-zA-Z])|Argentina/i
  },
  {
    id: "br",
    code: "BR",
    name: "巴西",
    groupName: "巴西节点",
    continent: "americas",
    subGroup: "latam",
    foldGroup: "am",
    icon: "🇧🇷",
    iconFile: "BR.png",
    city: "圣保罗",
    reg: /巴西|(?<![a-zA-Z])BR(?![a-zA-Z])|Brazil/i
  },
  {
    id: "mx",
    code: "MX",
    name: "墨西哥",
    groupName: "墨西哥节点",
    continent: "americas",
    subGroup: "na",
    foldGroup: "am",
    icon: "🇲🇽",
    iconFile: "MX.png",
    reg: /墨西哥|(?<![a-zA-Z])MX(?![a-zA-Z])|Mexico/i
  },
  {
    id: "cl",
    code: "CL",
    name: "智利",
    groupName: "智利节点",
    continent: "americas",
    subGroup: "latam",
    foldGroup: "am",
    icon: "🇨🇱",
    iconFile: "CL.png",
    reg: /智利|(?<![a-zA-Z])CL(?![a-zA-Z])|Chile/i
  },

  // --- 中东大区 ---
  {
    id: "ae",
    code: "AE",
    name: "阿联酋",
    groupName: "阿联酋节点",
    continent: "asia",
    subGroup: "me",
    foldGroup: "me",
    icon: "🇦🇪",
    iconFile: "AE.png",
    city: "迪拜",
    reg: /阿联酋|迪拜|(?<![a-zA-Z])(?:AE|UAE)(?![a-zA-Z])/i
  },
  {
    id: "tr",
    code: "TR",
    name: "土耳其",
    groupName: "土耳其节点",
    continent: "asia",
    subGroup: "me",
    foldGroup: "me",
    icon: "🇹🇷",
    iconFile: "TR.png",
    city: "伊斯坦布尔",
    reg: /土耳其|(?<![a-zA-Z])TR(?![a-zA-Z])|Turkey/i
  },
  {
    id: "sa",
    code: "SA",
    name: "沙特",
    groupName: "沙特节点",
    continent: "asia",
    subGroup: "me",
    foldGroup: "me",
    icon: "🇸🇦",
    iconFile: "SA.png",
    city: "利雅得|吉达",
    reg: /沙特|阿拉伯|(?<![a-zA-Z])SA(?![a-zA-Z])|Saudi/i
  },
  {
    id: "il",
    code: "IL",
    name: "以色列",
    groupName: "以色列节点",
    continent: "asia",
    subGroup: "me",
    foldGroup: "me",
    icon: "🇮🇱",
    iconFile: "IL.png",
    city: "特拉维夫",
    reg: /以色列|(?<![a-zA-Z])IL(?![a-zA-Z])|Israel/i
  },

  // --- 非洲大区 ---
  {
    id: "za",
    code: "ZA",
    name: "南非",
    groupName: "南非节点",
    continent: "africa",
    subGroup: "af",
    foldGroup: "af",
    icon: "🇿🇦",
    iconFile: "ZA.png",
    city: "约翰内斯堡",
    reg: /南非|(?<![a-zA-Z])ZA(?![a-zA-Z])|South Africa/i
  },
  {
    id: "ng",
    code: "NG",
    name: "尼日利亚",
    groupName: "尼日利亚节点",
    continent: "africa",
    subGroup: "af",
    foldGroup: "af",
    icon: "🇳🇬",
    iconFile: "NG.png",
    reg: /尼日利亚|(?<![a-zA-Z])NG(?![a-zA-Z])|Nigeria/i
  },
  {
    id: "eg",
    code: "EG",
    name: "埃及",
    groupName: "埃及节点",
    continent: "africa",
    subGroup: "af",
    foldGroup: "af",
    icon: "🇪🇬",
    iconFile: "EG.png",
    city: "开罗",
    reg: /埃及|(?<![a-zA-Z])EG(?![a-zA-Z])|Egypt/i
  },

  // --- 大洋洲大区 ---
  {
    id: "au",
    code: "AU",
    name: "澳大利亚",
    groupName: "澳大利亚节点",
    continent: "oceania",
    subGroup: "oc",
    foldGroup: "oc",
    icon: "🇦🇺",
    iconFile: "AU.png",
    city: "悉尼|墨尔本",
    reg: /澳大利亚|澳洲|(?<![a-zA-Z])AU(?![a-zA-Z])|Australia|Sydney/i
  }
];

// 七大洲与次大区折叠组定义 (作为策略组大区折叠桶存在)
const CONTINENT_DEFS = [
  { id: "eu",  target: "europe",   icon: "🇪🇺", name: "欧洲",   groupName: "欧洲节点",   iconFile: "EU.png",      continent: "europe",   subGroup: "eu",  foldGroup: "eu",  aliases: ["eu", "europe", "欧洲"] },
  { id: "sea", target: "sea",      icon: "🏝️", name: "东南亚", groupName: "东南亚节点", iconFile: "Global.png",  continent: "asia",     subGroup: "sea", foldGroup: "sea", aliases: ["sea", "southeast-asia", "southeastasia", "东南亚"] },
  // 说明：am 为美洲大区统一折叠组 (Americas)。具体国家按次大区细分为 na (北美) 与 latam (拉美)。
  { id: "am",  target: "americas", icon: "🌵", name: "美洲",   groupName: "美洲节点",   iconFile: "America.png", continent: "americas", subGroup: "am",  foldGroup: "am",  aliases: ["am", "america", "americas", "美洲"] },
  // 说明：南亚次大区代号统一采用 sas (South Asia Subregion)，与沙特国家代码 sa (Saudi Arabia) 解耦脱敏
  { id: "sas", target: "sas",      icon: "🍛", name: "南亚",   groupName: "南亚节点",   iconFile: "Global.png",  continent: "asia",     subGroup: "sas", foldGroup: "sas", aliases: ["sas", "south-asia", "southasia", "南亚"] },
  { id: "me",  target: "me",       icon: "🐪", name: "中东",   groupName: "中东节点",   iconFile: "Global.png",  continent: "asia",     subGroup: "me",  foldGroup: "me",  aliases: ["me", "middle-east", "middleeast", "中东", "西亚"] },
  { id: "af",  target: "africa",   icon: "🦁", name: "非洲",   groupName: "非洲节点",   iconFile: "Global.png",  continent: "africa",   subGroup: "af",  foldGroup: "af",  aliases: ["af", "africa", "非洲"] },
  { id: "oc",  target: "oceania",  icon: "🦘", name: "大洋洲", groupName: "大洋洲节点", iconFile: "AU.png",       continent: "oceania",  subGroup: "oc",  foldGroup: "oc",  aliases: ["oc", "oceania", "大洋洲", "澳洲"] }
];

// 次大区与基础大洲定义（未独立建折叠组的大区别名元数据）
const SUB_REGION_DEFS = [
  { id: "asia",  target: "asia",  aliases: ["asia", "亚洲"] },
  { id: "ea",    target: "ea",    aliases: ["ea", "east-asia", "eastasia", "东亚"] },
  { id: "na",    target: "na",    aliases: ["na", "north-america", "northamerica", "北美"] },
  { id: "latam", target: "latam", aliases: ["latam", "south-america", "southamerica", "南美", "拉美"] }
];

/**
 * 运行时增强：预编译并装配每个地区的 matchReg / cityReg / codeReg
 */
const REGION_FLAG_LOOKUPS = new WeakMap();
let enhancedRegionDefsCache = null;
let defaultRegionFlagLookupCache = null;

function enhanceRegionDefs(defs) {
  defs.forEach(r => {
    const combinedSource = r.city ? `${r.reg.source}|${r.city}` : r.reg.source;
    r.matchReg = new RegExp(combinedSource, "i");
    r.cityReg = r.city ? new RegExp(r.city, "i") : null;
    r.codeReg = r.codeReg || null;
  });
  REGION_FLAG_LOOKUPS.set(defs, new Map(defs.filter(r => r.icon).map(r => [r.icon, r])));
  return defs;
}

function getRegionFlagLookup(defs) {
  if (defs === enhancedRegionDefsCache && defaultRegionFlagLookupCache) {
    return defaultRegionFlagLookupCache;
  }
  let lookup = REGION_FLAG_LOOKUPS.get(defs);
  if (!lookup) {
    lookup = new Map((Array.isArray(defs) ? defs : []).filter(r => r?.icon).map(r => [r.icon, r]));
    if (Array.isArray(defs)) REGION_FLAG_LOOKUPS.set(defs, lookup);
  }
  return lookup;
}

/**
 * 获取完整增强过的地区定义列表（模块级不可变单例缓存，零重复编译开销）
 */
function getEnhancedRegionDefs() {
  if (!enhancedRegionDefsCache) {
    const cloned = REGION_DEFS_RAW.map(r => ({ ...r }));
    enhanceRegionDefs(cloned);
    enhancedRegionDefsCache = Object.freeze(cloned);
    defaultRegionFlagLookupCache = new Map(enhancedRegionDefsCache.filter(r => r.icon).map(r => [r.icon, r]));
  }
  return enhancedRegionDefsCache;
}

/**
 * SSOT 自检函数：校验全量地区与大洲定义的完整性与唯一性，杜绝 ID 碰撞或字段漂移
 */
function validateMapping() {
  const mismatches = [];
  const seenIds = new Set();
  const REQUIRED_REGION_FIELDS = ['id', 'name', 'groupName', 'continent', 'icon', 'iconFile', 'reg'];

  for (const r of REGION_DEFS_RAW) {
    for (const field of REQUIRED_REGION_FIELDS) {
      if (!r[field]) {
        mismatches.push(`${r.id || r.name || '未知'}: 缺少合法的 ${field} 字段`);
      }
    }
    if (seenIds.has(r.id)) {
      mismatches.push(`${r.name}: 存在重复的地区 id "${r.id}"`);
    } else {
      seenIds.add(r.id);
    }

    if (r.reg && !(r.reg instanceof RegExp)) mismatches.push(`${r.id}: reg 必须为 RegExp 实例`);
    if (r.codeReg && !(r.codeReg instanceof RegExp)) mismatches.push(`${r.id}: codeReg 必须为 RegExp 实例`);
  }

  // 校验大洲/次大区定义不与国家地区 ID 冲突（如 sas vs sa）
  for (const c of CONTINENT_DEFS) {
    if (seenIds.has(c.id)) {
      mismatches.push(`大洲/次大区 id "${c.id}" (${c.name}) 与国家地区 id 冲突！`);
    }
  }

  if (mismatches.length) {
    throw new Error("[region-defs] SSOT 校验失败:\n  " + mismatches.join("\n  "));
  }
  return true;
}

/**
 * 从国旗 Emoji 动态派生 ISO 3166-1 alpha-2 国家/地区代码 (纯函数)
 * @param {string} icon
 * @returns {string|null}
 */
function countryCodeFromFlag(icon) {
  if (!icon || typeof icon !== 'string') return null;
  const chars = Array.from(icon);
  if (chars.length !== 2) return null;
  const cp0 = chars[0].codePointAt(0);
  const cp1 = chars[1].codePointAt(0);
  if (cp0 >= 0x1F1E6 && cp0 <= 0x1F1FF && cp1 >= 0x1F1E6 && cp1 <= 0x1F1FF) {
    return String.fromCharCode(cp0 - 0x1F1E6 + 65, cp1 - 0x1F1E6 + 65);
  }
  return null;
}

/**
 * 权威地区元数据事实源 (单一事实源 SSOT，派生自 REGION_DEFS_RAW)
 * 映射标准地区名 -> { groupKey, countryCode, regionName, groupName, icon, continent, subGroup, foldGroup }
 */
const REGION_METADATA_MAP = Object.freeze(
  REGION_DEFS_RAW.reduce((acc, r) => {
    acc[r.name] = Object.freeze({
      groupKey: r.id,
      countryCode: r.code,
      regionName: r.name,
      groupName: r.groupName,
      icon: r.icon,
      continent: r.continent,
      subGroup: r.subGroup,
      foldGroup: r.foldGroup
    });
    return acc;
  }, {})
);

/**
 * 洲级与次大区标准代号映射 (单一事实源自派生，杜绝手动维护漂移)
 */
const CONTINENT_ALIAS_MAP = Object.freeze(
  [...CONTINENT_DEFS, ...SUB_REGION_DEFS].reduce((map, item) => {
    const target = item.target || item.id;
    for (const alias of (item.aliases || [])) {
      map[alias.toLowerCase()] = target;
    }
    return map;
  }, {})
);

/**
 * 判断指定地区元数据是否属于特定大洲/次大区
 * @param {object} regionDef 地区元数据对象 (来自 REGION_DEFS_RAW、CONTINENT_DEFS 或节点 regionInfo)
 * @param {string} continentToken 大洲或次大区代号 (如 'asia', '欧洲', 'sea', 'sas')
 * @returns {boolean}
 */
function isRegionInContinent(regionDef, continentToken) {
  if (!regionDef || !continentToken) return false;
  const target = CONTINENT_ALIAS_MAP[String(continentToken).trim().toLowerCase()];
  if (!target) return false;

  const rContinent = (regionDef.continent || '').toLowerCase();
  const rSubGroup = (regionDef.subGroup || '').toLowerCase();
  const rFoldGroup = (regionDef.foldGroup || regionDef.group || '').toLowerCase();
  const rId = (regionDef.id || '').toLowerCase();

  // 1. 大洲级全量匹配 (asia, europe, americas, oceania, africa)
  if (rContinent === target) return true;

  // 2. 次大区 / 折叠大区代码匹配 (ea, sea, sas, me, na, latam, eu, af, oc)
  if (rSubGroup === target || rFoldGroup === target || rId === target) return true;

  return false;
}

/**
 * 从策略组名称列表中筛选出属于特定大洲/次大区的策略组名
 * @param {Array<string>} groupNames 策略组名称数组
 * @param {string} continentToken 大洲或次大区代号
 * @returns {Array<string>}
 */
function filterRegionsByContinent(groupNames = [], continentToken) {
  if (!Array.isArray(groupNames) || !continentToken) return [];
  const target = CONTINENT_ALIAS_MAP[String(continentToken).trim().toLowerCase()];
  if (!target) return [];

  const defs = getEnhancedRegionDefs();
  return groupNames.filter(name => {
    if (!name || typeof name !== 'string') return false;
    const clean = name.replace(/节点$/, '').trim();

    // 1. 匹配 CONTINENT_DEFS (如 '欧洲', '东南亚', '美洲', '南亚', '中东', '非洲', '大洋洲')
    const contMatch = CONTINENT_DEFS.find(c => c.name === clean || c.groupName === name || c.id === clean.toLowerCase());
    if (contMatch) {
      return isRegionInContinent(contMatch, target);
    }

    // 2. 匹配具体地区 REGION_DEFS (如 '香港', '日本', '大陆', '美国', '德国' 等)
    const rMatch = defs.find(r => r.name === clean || r.groupName === name || r.id === clean.toLowerCase());
    if (rMatch) {
      return isRegionInContinent(rMatch, target);
    }

    return false;
  });
}

module.exports = {
  CONTINENT_DEFS,
  SUB_REGION_DEFS,
  CONTINENT_ALIAS_MAP,
  REGION_METADATA_MAP,
  isRegionInContinent,
  filterRegionsByContinent,
  getEnhancedRegionDefs,
  getRegionFlagLookup,
  validateMapping
};
