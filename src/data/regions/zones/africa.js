/**
 * -----------------------------------------------------------------------------
 * Data: 非洲大区 (Africa)
 * -----------------------------------------------------------------------------
 */

'use strict';

module.exports = {
  za: {
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
  ng: {
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
  eg: {
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
  sc: {
    id: "sc",
    code: "SC",
    name: "塞舌尔",
    groupName: "塞舌尔节点",
    continent: "africa",
    subGroup: "af",
    foldGroup: "af",
    icon: "🇸🇨",
    iconFile: "SC.png",
    city: "维多利亚",
    reg: /塞舌[尔爾]|Seychelles/i,
    codeReg: /(?<![a-zA-Z])SC(?![a-zA-Z])/
  },
  ne: {
    id: "ne",
    code: "NE",
    name: "尼日尔",
    groupName: "尼日尔节点",
    continent: "africa",
    subGroup: "af",
    foldGroup: "af",
    icon: "🇳🇪",
    iconFile: "NE.png",
    city: "尼亚美",
    reg: /尼日尔|尼日爾|(?<![a-zA-Z])Niger(?![a-zA-Z])/i,
    codeReg: /(?<![a-zA-Z])NE(?![a-zA-Z])/
  },
  ly: {
    id: "ly",
    code: "LY",
    name: "利比亚",
    groupName: "利比亚节点",
    continent: "africa",
    subGroup: "af",
    foldGroup: "af",
    icon: "🇱🇾",
    iconFile: "LY.png",
    city: "的黎波里",
    reg: /利比亚|利比亞|Libya/i,
    codeReg: /(?<![a-zA-Z])LY(?![a-zA-Z])/
  }
};
