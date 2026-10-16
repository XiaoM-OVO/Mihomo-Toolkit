/**
 * 地区识别字典与大洲分组
 *
 * 维护标准地区元数据、国旗 Emoji、落地城市及匹配正则。
 */

// 入口地区/运营商前缀正则片段
const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信|香港|台湾|日本|韩国|新加坡|美国|英国|德国|法国|澳洲|英|德|法|澳|美|日|韩|新|港|台)";
const IN_PREFIX_OPTIONAL = `(?:${IN_PREFIX}(?:\\s*(?:->|=>|~>|→|⇒|-|—|=|>|至)\\s*|\\s+)?)?`;

// 顺序决定排序优先级与节点桶名
const REGION_DEFS_RAW = [
  // --- 大中华区 ---
  { id: "cn", name: "中国",   icon: "🇨🇳", city: "深圳|广州|上海|北京|杭州|成都|武汉|南京", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(?:CN(?!2)|PRC)(?![a-zA-Z])|China|(?:美|日|韩|新|港|台|英|德|法|澳)(?:-|->|至|=>|\s)*(?:京|沪|广|深|国内|大陆|中国|落地)/i },
  { id: "hk", name: "香港",   icon: "🇭🇰", _regTemplate: "香港|香江|(?<![空海端])港(?![口湾澳])|(?<![a-zA-Z])(?:HK|HKT|HKBN|HGC|WTT|PCCW)(?![a-zA-Z])|Hong Kong" },
  { id: "mo", name: "澳门",   icon: "🇲🇴", reg: /澳门|澳門|Macau|Macao|(?<![a-zA-Z])CTM(?![a-zA-Z])/i },
  { id: "tw", name: "台湾",   icon: "🇹🇼", city: "台北|新北|台中|高雄|彰化", _regTemplate: "台湾|台灣|(?<![平前后戏平台])台(?![平前后湾灣风])|(?<![a-zA-Z])(?:TW|APTG)(?![a-zA-Z])|Taiwan|Hinet|Kbro|Seednet" },

  // --- 亚洲核心区 ---
  { id: "jp", name: "日本",   icon: "🇯🇵", city: "东京|大阪|埼玉|京都|川崎", _regTemplate: "日本|日(?![常用期间程志照益本])|(?<![a-zA-Z])(?:JP|OCN)(?![a-zA-Z])|Japan|Nuro|Plala" },
  { id: "kr", name: "韩国",   icon: "🇰🇷", city: "首尔|春川", _regTemplate: "韩国|韩(?![信国])|(?<![a-zA-Z])KR(?![a-zA-Z])|Korea" },
  { id: "sg", name: "新加坡", icon: "🇸🇬", city: "狮城", _regTemplate: "新加坡|新(?![建春年线增华上线节点加北坡])|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore|Singtel|StarHub|MyRepublic|ViewQwest" },

  // --- 北美大区 ---
  { id: "us", name: "美国",   icon: "🇺🇸", city: "洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|亚特兰大|凤凰城|硅谷|纽约|迈阿密|华盛顿", _regTemplate: "美国|西美|美西|美东|(?<![完优赞欧])美(?![食味丽国西东])|(?<![a-zA-Z])(?:US|LAX)(?![a-zA-Z])|Los Angeles|America|United States" },

  // --- 欧洲大区 ---
  { group: "eu", name: "英国",   icon: "🇬🇧", city: "伦敦|費勒姆", reg: /英国|(?<![a-zA-Z])UK(?![a-zA-Z])|United Kingdom|Britain/i },
  { group: "eu", name: "德国",   icon: "🇩🇪", city: "法兰克福", reg: /德国|(?<![a-zA-Z])DE(?![a-zA-Z])|Germany/i },
  { group: "eu", name: "法国",   icon: "🇫🇷", city: "巴黎", reg: /法国|(?<![a-zA-Z])FR(?![a-zA-Z])|France/i },
  { group: "eu", name: "俄罗斯", icon: "🇷🇺", city: "莫斯科|伯力|圣彼得堡|新西伯利亚", reg: /俄罗斯|(?<![a-zA-Z])RU(?![a-zA-Z])|Russia/i },
  { group: "eu", name: "乌克兰", icon: "🇺🇦", city: "基辅", reg: /乌克兰|(?<![a-zA-Z])UA(?![a-zA-Z])|Ukraine/i },
  { group: "eu", name: "西班牙", icon: "🇪🇸", city: "马德里", reg: /西班牙|(?<![a-zA-Z])ES(?![a-zA-Z])|Spain/i },
  { group: "eu", name: "荷兰",   icon: "🇳🇱", city: "阿姆斯特丹", reg: /荷兰|(?<![a-zA-Z])NL(?![a-zA-Z])|Netherlands/i },
  { group: "eu", name: "瑞士",   icon: "🇨🇭", city: "苏黎世|日内瓦", reg: /瑞士|(?<![a-zA-Z])CH(?![a-zA-Z])|Switzerland/i },
  { group: "eu", name: "意大利", icon: "🇮🇹", city: "米兰|罗马", reg: /意大利|Italy/i, codeReg: /(?<![a-zA-Z])IT(?![a-zA-Z])/ },
  { group: "eu", name: "瑞典",   icon: "🇸🇪", city: "斯德哥尔摩", reg: /瑞典|(?<![a-zA-Z])SE(?![a-zA-Z])|Sweden/i },
  { group: "eu", name: "爱尔兰", icon: "🇮🇪", city: "都柏林", reg: /爱尔兰|(?<![a-zA-Z])IE(?![a-zA-Z])|Ireland/i },
  { group: "eu", name: "波兰",   icon: "🇵🇱", city: "华沙", reg: /波兰|(?<![a-zA-Z])PL(?![a-zA-Z])|Poland/i },
  { group: "eu", name: "芬兰",   icon: "🇫🇮", city: "赫尔辛基", reg: /芬兰|(?<![a-zA-Z])FI(?![a-zA-Z])|Finland/i },
  { group: "eu", name: "冰岛",   icon: "🇮🇸", city: "雷克雅未克", reg: /冰岛|Iceland/i, codeReg: /(?<![a-zA-Z])IS(?![a-zA-Z])/ },

  // --- 南亚大区 ---
  { group: "sa", name: "印度",     icon: "🇮🇳", city: "孟买|新德里", reg: /印度|India/i, codeReg: /(?<![a-zA-Z])IN(?![a-zA-Z])/ },

  // --- 东南亚大区 ---
  { group: "sea", name: "马来西亚", icon: "🇲🇾", city: "吉隆坡", reg: /马来|马来西亚|Malaysia/i, codeReg: /(?<![a-zA-Z])MY(?![a-zA-Z])/ },
  { group: "sea", name: "泰国",     icon: "🇹🇭", city: "曼谷", reg: /泰国|(?<![a-zA-Z])TH(?![a-zA-Z])|Thailand/i },
  { group: "sea", name: "印尼",     icon: "🇮🇩", city: "雅加达", reg: /印尼|印度尼西亚|(?<![a-zA-Z])ID(?![a-zA-Z])|Indonesia/i },
  { group: "sea", name: "菲律宾",   icon: "🇵🇭", city: "马尼拉", reg: /菲律宾|(?<![a-zA-Z])PH(?![a-zA-Z])|Philippines/i },
  { group: "sea", name: "越南",     icon: "🇻🇳", city: "胡志明|河内", reg: /越南|(?<![a-zA-Z])VN(?![a-zA-Z])|Vietnam/i },

  // --- 美洲大区 ---
  { group: "am", name: "加拿大",    icon: "🇨🇦", city: "多伦多|温哥华|蒙特利尔", reg: /加拿大|(?<![a-zA-Z])CA(?![a-zA-Z])|Canada/i },
  { group: "am", name: "阿根廷",    icon: "🇦🇷", city: "布宜诺斯艾利斯", reg: /阿根廷|(?<![a-zA-Z])AR(?![a-zA-Z])|Argentina/i },
  { group: "am", name: "巴西",      icon: "🇧🇷", city: "圣保罗", reg: /巴西|(?<![a-zA-Z])BR(?![a-zA-Z])|Brazil/i },
  { group: "am", name: "墨西哥",    icon: "🇲🇽", reg: /墨西哥|(?<![a-zA-Z])MX(?![a-zA-Z])|Mexico/i },
  { group: "am", name: "智利",      icon: "🇨🇱", reg: /智利|(?<![a-zA-Z])CL(?![a-zA-Z])|Chile/i },

  // --- 中东大区 ---
  { group: "me", name: "阿联酋",    icon: "🇦🇪", city: "迪拜", reg: /阿联酋|迪拜|(?<![a-zA-Z])(?:AE|UAE)(?![a-zA-Z])/i },
  { group: "me", name: "土耳其",    icon: "🇹🇷", city: "伊斯坦布尔", reg: /土耳其|(?<![a-zA-Z])TR(?![a-zA-Z])|Turkey/i },
  { group: "me", name: "沙特",      icon: "🇸🇦", city: "利雅得|吉达", reg: /沙特|阿拉伯|(?<![a-zA-Z])SA(?![a-zA-Z])|Saudi/i },
  { group: "me", name: "以色列",    icon: "🇮🇱", city: "特拉维夫", reg: /以色列|(?<![a-zA-Z])IL(?![a-zA-Z])|Israel/i },

  // --- 非洲大区 ---
  { group: "af", name: "南非",      icon: "🇿🇦", city: "约翰内斯堡", reg: /南非|(?<![a-zA-Z])ZA(?![a-zA-Z])|South Africa/i },
  { group: "af", name: "尼日利亚",  icon: "🇳🇬", reg: /尼日利亚|(?<![a-zA-Z])NG(?![a-zA-Z])|Nigeria/i },
  { group: "af", name: "埃及",      icon: "🇪🇬", city: "开罗", reg: /埃及|(?<![a-zA-Z])EG(?![a-zA-Z])|Egypt/i },

  // --- 其他零散地区 ---
  { name: "澳大利亚", icon: "🇦🇺", city: "悉尼|墨尔本", reg: /澳大利亚|澳洲|(?<![a-zA-Z])AU(?![a-zA-Z])|Australia|Sydney/i },
];

// 动态派生未定义 reg 的模板项
for (const r of REGION_DEFS_RAW) {
  if (r._regTemplate && !r.reg) {
    r.reg = new RegExp(IN_PREFIX_OPTIONAL + '(?:' + r._regTemplate + ')', "i");
  }
}

// 六大洲折叠大区定义
const CONTINENT_DEFS = [
  { id: "eu",  icon: "🇪🇺", name: "欧洲" },   // 👑 高频大区：英/德/法/俄 等
  { id: "sea", icon: "🏝️", name: "东南亚" }, // 👑 高频大区：马/泰/印尼/越/菲 等
  { id: "am",  icon: "🌵", name: "美洲" },   // 🌎 次高频：加/巴/阿/智 等
  { id: "sa",  icon: "🍛", name: "南亚" },   // 🍛 较冷门：印度/巴基斯坦 等
  { id: "me",  icon: "🐪", name: "中东" },   // 🐪 冷门区：阿联酋/沙特/以色列 等
  { id: "af",  icon: "🦁", name: "非洲" }    // 🦁 极冷区：南非/尼日利亚/埃及 等
];

/**
 * 运行时增强：预生成每个地区的 _cleanReg / _matchReg / _cityReg
 */
const REGION_FLAG_LOOKUPS = new WeakMap();

function enhanceRegionDefs(defs) {
  defs.forEach(r => {
    const combinedSource = r.city ? `${r.reg.source}|${r.city}` : r.reg.source;
    r._cleanReg = new RegExp(combinedSource, "ig");
    r._matchReg = new RegExp(combinedSource, "i");
    r._cityReg = r.city ? new RegExp(r.city, "i") : null;
    r._codeMatchReg = r.codeReg || null;
  });
  REGION_FLAG_LOOKUPS.set(defs, new Map(defs.filter(r => r.icon).map(r => [r.icon, r])));
  return defs;
}

function getRegionFlagLookup(defs) {
  let lookup = REGION_FLAG_LOOKUPS.get(defs);
  if (!lookup) {
    lookup = new Map((Array.isArray(defs) ? defs : []).filter(r => r?.icon).map(r => [r.icon, r]));
    if (Array.isArray(defs)) REGION_FLAG_LOOKUPS.set(defs, lookup);
  }
  return lookup;
}

/**
 * 获取一份完整增强过的地区定义列表克隆
 */
function getEnhancedRegionDefs() {
  const cloned = REGION_DEFS_RAW.map(r => ({ ...r }));
  return enhanceRegionDefs(cloned);
}

/**
 * 自检函数
 */
function validateMapping() {
  const mismatches = [];
  for (const r of REGION_DEFS_RAW) {
    if (r._regTemplate != null) {
      const expectedSource = IN_PREFIX_OPTIONAL + '(?:' + r._regTemplate + ')';
      const actualSource = r.reg.source;
      const rebuiltSource = new RegExp(expectedSource, "i").source;
      if (actualSource !== rebuiltSource) {
        mismatches.push(`${r.name}: reg.source 与 IN_PREFIX_OPTIONAL + _regTemplate 不一致`);
      }
    }
  }
  if (mismatches.length) {
    throw new Error("[region-defs] _regTemplate 校验失败:\n  " + mismatches.join("\n  "));
  }
  return true;
}

// 默认免折叠主力大区清单 (即使节点数低于阈值也保证独立建组)
const DEFAULT_CORE_REGIONS = ['cn', 'hk', 'tw', 'jp', 'kr', 'sg', 'us'];

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
 * 映射标准地区名 -> { groupKey, countryCode, regionName }
 */
const REGION_METADATA_MAP = Object.freeze(
  REGION_DEFS_RAW.reduce((acc, r) => {
    const code = countryCodeFromFlag(r.icon);
    const groupKey = r.id || (r.name === '英国' ? 'uk' : (code ? code.toLowerCase() : 'unknown'));
    acc[r.name] = Object.freeze({
      groupKey,
      countryCode: code,
      regionName: r.name
    });
    return acc;
  }, {})
);

module.exports = {
  CONTINENT_DEFS,
  DEFAULT_CORE_REGIONS,
  REGION_METADATA_MAP,
  getEnhancedRegionDefs,
  getRegionFlagLookup,
  validateMapping
};
