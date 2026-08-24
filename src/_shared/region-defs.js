/**
 * 📦 Mihomo-Toolkit | 地区识别字典（唯一真源）
 * 改完本文件后运行 `npm run inject` 自动同步到 pure-nodes.js / mihomo-toolkit.js
 * 注：模板式条目（reg 用了 `${IN_PREFIX}` 插值）需同步补 `_regTemplate` 字段，
 *     存 `${IN_PREFIX}` 之后的模式串，用于注入脚本还原 `new RegExp(...)` 源码
 */

// 入口地区/运营商前缀正则片段
const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信|香港|台湾|日本|韩国|新加坡|美国|英国|德国|法国|澳洲|英|德|法|澳|美|日|韩|新|港|台)";

// 顺序决定排序优先级与节点桶名
const REGION_DEFS_RAW = [
  //--- 大中华区 ---
  { id: "cn", name: "中国",   icon: "🇨🇳", city: "深圳|广州|上海|北京|杭州|成都|武汉|南京", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-zA-Z])(CN|PRC)(?![a-zA-Z])|China|(?:美|日|韩|新|港|台|英|德|法|澳)(?:-|->|至|=>|\s)*(?:京|沪|广|深|国内|大陆|中国|落地)/i },
  { id: "hk", name: "香港",   icon: "🇭🇰", reg: new RegExp(`${IN_PREFIX}港|香港|香江|(?<![a-zA-Z])(?:HK|HKT|HKBN|HGC|WTT|PCCW)(?![a-zA-Z])|Hong Kong`, "i"), _regTemplate: "港|香港|香江|(?<![a-zA-Z])(?:HK|HKT|HKBN|HGC|WTT|PCCW)(?![a-zA-Z])|Hong Kong" },
  { id: "mo", name: "澳门",   icon: "🇲🇴", reg: /澳门|澳門|Macau|Macao|(?<![a-zA-Z])CTM(?![a-zA-Z])/i },
  { id: "tw", name: "台湾",   icon: "🇹🇼", city: "台北|新北|台中|高雄|彰化", reg: new RegExp(`${IN_PREFIX}台|台湾|台灣|(?<![a-zA-Z])(?:TW|APTG)(?![a-zA-Z])|Taiwan|Hinet|Kbro|Seednet`, "i"), _regTemplate: "台|台湾|台灣|(?<![a-zA-Z])(?:TW|APTG)(?![a-zA-Z])|Taiwan|Hinet|Kbro|Seednet" },

  // --- 亚洲核心区 ---
  { id: "jp", name: "日本",   icon: "🇯🇵", city: "东京|大阪|埼玉|京都|川崎", reg: new RegExp(`${IN_PREFIX}日|日本|(?<![a-zA-Z])(?:JP|OCN)(?![a-zA-Z])|Japan|Nuro|Plala`, "i"), _regTemplate: "日|日本|(?<![a-zA-Z])(?:JP|OCN)(?![a-zA-Z])|Japan|Nuro|Plala" },
  { id: "kr", name: "韩国",   icon: "🇰🇷", city: "首尔|春川", reg: new RegExp(`${IN_PREFIX}韩|韩国|(?<![a-zA-Z])KR(?![a-zA-Z])|Korea`, "i"), _regTemplate: "韩|韩国|(?<![a-zA-Z])KR(?![a-zA-Z])|Korea" },
  { id: "sg", name: "新加坡", icon: "🇸🇬", city: "狮城", reg: new RegExp(`${IN_PREFIX}新|新加坡|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore|Singtel|StarHub|MyRepublic|ViewQwest`, "i"), _regTemplate: "新|新加坡|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore|Singtel|StarHub|MyRepublic|ViewQwest" },

  // --- 北美大区 ---
  { id: "us", name: "美国",   icon: "🇺🇸", city: "洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|亚特兰大|凤凰城|硅谷|纽约|迈阿密|华盛顿", reg: new RegExp(`${IN_PREFIX}美|美国|西美|(?<![a-zA-Z])(?:US|LAX)(?![a-zA-Z])|Los Angeles|America`, "i"), _regTemplate: "美|美国|西美|(?<![a-zA-Z])(?:US|LAX)(?![a-zA-Z])|Los Angeles|America" },

  // --- 欧洲大区 ---
  { group: "eu", name: "英国",   icon: "🇬🇧", city: "伦敦|費勒姆", reg: /英国|(?<![a-zA-Z])UK(?![a-zA-Z])|United Kingdom|Britain/i },
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
  { group: "eu", name: "冰岛",   icon: "🇮🇸", city: "雷克雅未克", reg: /冰岛|(?<![a-zA-Z])IS(?![a-zA-Z])|Iceland/i },

  // --- 南亚大区 ---
  { group: "sa", name: "印度",     icon: "🇮🇳", city: "孟买|新德里", reg: /印度|(?<![a-zA-Z])IN(?![a-zA-Z])|India/i },

  // --- 东南亚大区 ---
  { group: "sea", name: "马来西亚", icon: "🇲🇾", city: "吉隆坡", reg: /马来|马来西亚|(?<![a-zA-Z])MY(?![a-zA-Z])|Malaysia/i },
  { group: "sea", name: "泰国",     icon: "🇹🇭", city: "曼谷", reg: /泰国|(?<![a-zA-Z])TH(?![a-zA-Z])|Thailand/i },
  { group: "sea", name: "印尼",     icon: "🇮🇩", city: "雅加达", reg: /印尼|印度尼西亚|(?<![a-zA-Z])ID(?![a-zA-Z])|Indonesia/i },
  { group: "sea", name: "菲律宾",   icon: "🇵🇭", city: "马尼拉", reg: /菲律宾|(?<![a-zA-Z])PH(?![a-zA-Z])|Philippines/i },
  { group: "sea", name: "越南",     icon: "🇻🇳", city: "胡志明|河内", reg: /越南|(?<![a-zA-Z])VN(?![a-zA-Z])|Vietnam/i },

  // --- 美洲大区 --
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

/** 运行时增强：预生成每个地区的 _cleanReg / _matchReg / _cityReg */
function enhanceRegionDefs(defs) {
  defs.forEach(r => {
    const combinedSource = r.city ? `${r.reg.source}|${r.city}` : r.reg.source;
    r._cleanReg = new RegExp(combinedSource, "ig");
    r._matchReg = new RegExp(combinedSource, "i");
    r._cityReg = r.city ? new RegExp(r.city, "i") : null;
  });
  return defs;
}

// -------------------------------------------------------------------------
// 🔧 注入脚本使用的源码生成器
// 条目有 `_regTemplate` → new RegExp(`\${IN_PREFIX}...`, "i") 模板式
// 条目无 `_regTemplate` → /.../i 字面量式
// -------------------------------------------------------------------------

/** 把条目 reg 还原为可注入的 JS 源码字符串 */
function _regToSource(r) {
  if (r._regTemplate != null) {
    // 外层用单引号：`${IN_PREFIX}` 在单引号字符串里就是字面量字符，不会被当作模板插值
    return 'new RegExp(`${IN_PREFIX}' + r._regTemplate + '`, "i")';
  }
  const flags = r.reg.flags || "i";
  return "/" + r.reg.source + "/" + flags;
}

/** 把单个地区字典条目还原为一行对象源码字符串 */
function _defItemToSource(r, indent) {
  const pad = " ".repeat(indent || 4);
  const parts = [];
  if (r.id)    parts.push(`id: ${JSON.stringify(r.id)}`);
  if (r.group) parts.push(`group: ${JSON.stringify(r.group)}`);
  parts.push(`name: ${JSON.stringify(r.name)}`);
  parts.push(`icon: ${JSON.stringify(r.icon)}`);
  if (r.city)  parts.push(`city: ${JSON.stringify(r.city)}`);
  parts.push(`reg: ${_regToSource(r)}`);
  return `${pad}{ ${parts.join(", ")} }`;
}

// ---- 分节注释（与 REGION_DEFS_RAW 的 name 对应插入位置） ----
const _SECTION_COMMENTS = [
  { beforeName: "中国",   comment: "//--- 大中华区 ---" },
  { beforeName: "日本",   comment: "// --- 亚洲核心区 ---" },
  { beforeName: "美国",   comment: "// --- 北美大区 ---" },
  { beforeName: "英国",   comment: "// --- 欧洲大区 ---" },
  { beforeName: "印度",   comment: "// --- 南亚大区 ---" },
  { beforeName: "马来西亚", comment: "// --- 东南亚大区 ---" },
  { beforeName: "加拿大", comment: "// --- 美洲大区 --" },
  { beforeName: "阿联酋", comment: "// --- 中东大区 ---" },
  { beforeName: "南非",   comment: "// --- 非洲大区 ---" },
  { beforeName: "澳大利亚", comment: "// --- 其他零散地区 ---" },
];

/** 生成用于注入的 REGION_DEFS 完整源码 */
function generateRegionDefsSource(indent) {
  const pad = " ".repeat(indent || 4);
  const lines = [];
  const sectionMap = new Map(_SECTION_COMMENTS.map(s => [s.beforeName, s.comment]));

  REGION_DEFS_RAW.forEach((r, idx) => {
    const comment = sectionMap.get(r.name);
    if (comment) {
      if (idx > 0) lines.push("");
      lines.push(pad + comment);
    }
    lines.push(_defItemToSource(r, indent) + ",");
  });
  return lines.join("\n");
}

/** 生成 `const IN_PREFIX = ...` 的源码行 */
function generateInPrefixSource() {
  return `const IN_PREFIX = ${JSON.stringify(IN_PREFIX)};`;
}

/** 生成 REGION_DEFS.forEach(...) 的运行时增强代码源码 */
function generateEnhanceForEachSource(arrayName, indent) {
  const pad = " ".repeat(indent || 0);
  return [
    `${pad}${arrayName}.forEach(r => {`,
    `${pad}    const combinedSource = r.city ? \`\${r.reg.source}|\${r.city}\` : r.reg.source;`,
    `${pad}    r._cleanReg = new RegExp(combinedSource, "ig");`,
    `${pad}    r._matchReg = new RegExp(combinedSource, "i");`,
    `${pad}    r._cityReg = r.city ? new RegExp(r.city, "i") : null;`,
    `${pad}});`,
  ].join("\n");
}

// ---- Node 调试导出 & 自检 ----
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    IN_PREFIX,
    REGION_DEFS_RAW,
    enhanceRegionDefs,
    generateRegionDefsSource,
    generateInPrefixSource,
    generateEnhanceForEachSource,
    /**
     * 自检：确保使用了 _regTemplate 的条目，运行时 reg.source 与
     * 「IN_PREFIX + _regTemplate」拼接结果完全一致，避免修改一侧漏改另一侧
     */
    validateMapping() {
      const mismatches = [];
      for (const r of REGION_DEFS_RAW) {
        if (r._regTemplate != null) {
          const expectedSource = (IN_PREFIX + r._regTemplate);
          // 注意：用 new RegExp(expectedSource, "i").source 做对比更稳
          // 因为 IN_PREFIX + _regTemplate 拼好后的字符串需要是合法正则字面量
          const actualSource = r.reg.source;
          const rebuiltSource = new RegExp(expectedSource, "i").source;
          if (actualSource !== rebuiltSource) {
            mismatches.push(`${r.name}: reg.source 与 IN_PREFIX + _regTemplate 不一致`);
          }
        }
      }
      if (mismatches.length) {
        throw new Error("[region-defs] _regTemplate 校验失败:\n  " + mismatches.join("\n  "));
      }
      return true;
    },
  };
}
