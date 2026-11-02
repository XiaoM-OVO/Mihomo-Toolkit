/**
 * -----------------------------------------------------------------------------
 * Data: 南亚大区 (South Asia)
 * -----------------------------------------------------------------------------
 */

'use strict';

module.exports = {
  in: {
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
  }
};
