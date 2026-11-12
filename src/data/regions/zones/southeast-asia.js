/**
 * -----------------------------------------------------------------------------
 * Data: 东南亚大区 (Southeast Asia)
 * -----------------------------------------------------------------------------
 */

'use strict';

const { SINGLE_EXIT_LOOKAHEAD, SINGLE_EXIT_LOOKBEHIND } = require('../../cleaner-rules');

module.exports = {
  sg: {
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
    reg: new RegExp(`新加坡|${SINGLE_EXIT_LOOKBEHIND.新}新${SINGLE_EXIT_LOOKAHEAD.新}|(?<![a-zA-Z])SG(?![a-zA-Z])|Singapore|Singtel|StarHub|MyRepublic|ViewQwest`, "i")
  },
  my: {
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
  th: {
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
  id: {
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
  ph: {
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
  vn: {
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
  la: {
    id: "la",
    code: "LA",
    name: "老挝",
    groupName: "老挝节点",
    continent: "asia",
    subGroup: "sea",
    foldGroup: "sea",
    icon: "🇱🇦",
    iconFile: "LA.png",
    city: "万象",
    // 注意：严禁无前缀两字母 LA，洛杉矶在机场命名中普遍占据 LA/LAX
    reg: /老挝|寮国|Laos|Vientiane/i
  }
};
