/**
 * -----------------------------------------------------------------------------
 * Data: 欧洲大区 (Europe)
 * -----------------------------------------------------------------------------
 */

'use strict';

module.exports = {
  uk: {
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
  de: {
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
  fr: {
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
  ru: {
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
  ua: {
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
  es: {
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
  nl: {
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
  ch: {
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
  it: {
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
  se: {
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
  ie: {
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
  pl: {
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
  fi: {
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
  is: {
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
  }
};
