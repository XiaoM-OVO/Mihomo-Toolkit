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
  }
};
