/**
 * -----------------------------------------------------------------------------
 * Data: 美洲大区 (Americas: North & Latin America)
 * -----------------------------------------------------------------------------
 */

'use strict';

const { SINGLE_EXIT_LOOKAHEAD } = require('../../cleaner-rules');

module.exports = {
  // --- 北美次大区 (na) ---
  us: {
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
  ca: {
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
  mx: {
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

  // --- 拉美次大区 (latam) ---
  ar: {
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
  br: {
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
  cl: {
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
  }
};
