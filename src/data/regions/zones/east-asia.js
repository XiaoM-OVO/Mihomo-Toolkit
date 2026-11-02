/**
 * -----------------------------------------------------------------------------
 * Data: 大中华区与东亚核心区 (East Asia)
 * -----------------------------------------------------------------------------
 */

'use strict';

const { SINGLE_EXIT_LOOKAHEAD } = require('../../cleaner-rules');

module.exports = {
  cn: {
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
  hk: {
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
  mo: {
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
  tw: {
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
  jp: {
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
  kr: {
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
  }
};
