/**
 * -----------------------------------------------------------------------------
 * Data: 中东大区 (Middle East)
 * -----------------------------------------------------------------------------
 */

'use strict';

module.exports = {
  ae: {
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
  tr: {
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
  sa: {
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
  il: {
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
  iq: {
    id: "iq",
    code: "IQ",
    name: "伊拉克",
    groupName: "伊拉克节点",
    continent: "asia",
    subGroup: "me",
    foldGroup: "me",
    icon: "🇮🇶",
    iconFile: "IQ.png",
    city: "巴格达",
    reg: /伊拉克|Iraq/i,
    codeReg: /(?<![a-zA-Z])IQ(?![a-zA-Z])/
  },
  ir: {
    id: "ir",
    code: "IR",
    name: "伊朗",
    groupName: "伊朗节点",
    continent: "asia",
    subGroup: "me",
    foldGroup: "me",
    icon: "🇮🇷",
    iconFile: "IR.png",
    city: "德黑兰",
    reg: /伊朗|Iran/i,
    codeReg: /(?<![a-zA-Z])IR(?![a-zA-Z])/
  },
  qa: {
    id: "qa",
    code: "QA",
    name: "卡塔尔",
    groupName: "卡塔尔节点",
    continent: "asia",
    subGroup: "me",
    foldGroup: "me",
    icon: "🇶🇦",
    iconFile: "QA.png",
    city: "多哈",
    reg: /卡塔尔|卡塔爾|Qatar/i,
    codeReg: /(?<![a-zA-Z])QA(?![a-zA-Z])/
  },
  kz: {
    id: "kz",
    code: "KZ",
    name: "哈萨克斯坦",
    groupName: "哈萨克斯坦节点",
    continent: "asia",
    subGroup: "me",
    foldGroup: "me",
    icon: "🇰🇿",
    iconFile: "KZ.png",
    city: "阿拉木图",
    reg: /哈萨克斯坦|哈薩克|Kazakhstan/i,
    codeReg: /(?<![a-zA-Z])KZ(?![a-zA-Z])/
  },
  uz: {
    id: "uz",
    code: "UZ",
    name: "乌兹别克斯坦",
    groupName: "乌兹别克斯坦节点",
    continent: "asia",
    subGroup: "me",
    foldGroup: "me",
    icon: "🇺🇿",
    iconFile: "UZ.png",
    city: "塔什干",
    reg: /乌兹别克斯坦|烏茲別克|Uzbekistan/i,
    codeReg: /(?<![a-zA-Z])UZ(?![a-zA-Z])/
  }
};
