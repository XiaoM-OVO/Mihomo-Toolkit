/**
 * -----------------------------------------------------------------------------
 * Data: 大洲与次大区静态元数据 (Continents & Sub-regions Definition)
 * -----------------------------------------------------------------------------
 * 定义策略组大区折叠桶与大洲次大区别名映射。
 */

'use strict';

// 七大洲与次大区折叠组定义 (作为策略组大区折叠桶存在)
const CONTINENT_DEFS = [
  { id: "eu",  target: "europe",   icon: "🇪🇺", name: "欧洲",   groupName: "欧洲节点",   iconFile: "EU.png",      continent: "europe",   subGroup: "eu",  foldGroup: "eu",  aliases: ["eu", "europe", "欧洲"] },
  { id: "sea", target: "sea",      icon: "🏝️", name: "东南亚", groupName: "东南亚节点", iconFile: "Global.png",  continent: "asia",     subGroup: "sea", foldGroup: "sea", aliases: ["sea", "southeast-asia", "southeastasia", "东南亚"] },
  // 说明：am 为美洲大区统一折叠组 (Americas)。具体国家按次大区细分为 na (北美) 与 latam (拉美)。
  { id: "am",  target: "americas", icon: "🌵", name: "美洲",   groupName: "美洲节点",   iconFile: "America.png", continent: "americas", subGroup: "am",  foldGroup: "am",  aliases: ["am", "america", "americas", "美洲"] },
  // 说明：南亚次大区代号统一采用 sas (South Asia Subregion)，与沙特国家代码 sa (Saudi Arabia) 解耦脱敏
  { id: "sas", target: "sas",      icon: "🍛", name: "南亚",   groupName: "南亚节点",   iconFile: "Global.png",  continent: "asia",     subGroup: "sas", foldGroup: "sas", aliases: ["sas", "south-asia", "southasia", "南亚"] },
  { id: "me",  target: "me",       icon: "🐪", name: "中东",   groupName: "中东节点",   iconFile: "Global.png",  continent: "asia",     subGroup: "me",  foldGroup: "me",  aliases: ["me", "middle-east", "middleeast", "中东", "西亚"] },
  { id: "af",  target: "africa",   icon: "🦁", name: "非洲",   groupName: "非洲节点",   iconFile: "Global.png",  continent: "africa",   subGroup: "af",  foldGroup: "af",  aliases: ["af", "africa", "非洲"] },
  { id: "oc",  target: "oceania",  icon: "🦘", name: "大洋洲", groupName: "大洋洲节点", iconFile: "AU.png",       continent: "oceania",  subGroup: "oc",  foldGroup: "oc",  aliases: ["oc", "oceania", "大洋洲", "澳洲"] }
];

// 次大区与基础大洲定义（未独立建折叠组的大区别名元数据）
const SUB_REGION_DEFS = [
  { id: "asia",  target: "asia",  aliases: ["asia", "亚洲"] },
  { id: "ea",    target: "ea",    aliases: ["ea", "east-asia", "eastasia", "东亚"] },
  { id: "na",    target: "na",    aliases: ["na", "north-america", "northamerica", "北美"] },
  { id: "latam", target: "latam", aliases: ["latam", "south-america", "southamerica", "南美", "拉美"] }
];

module.exports = {
  CONTINENT_DEFS,
  SUB_REGION_DEFS
};
