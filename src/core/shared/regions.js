/**
 * -----------------------------------------------------------------------------
 * Core: 地区识别字典与大洲分组 (Region SSOT Projection & Runtime Engine)
 * -----------------------------------------------------------------------------
 * 静态数据已完全解耦下沉至 `src/data/regions/`。
 * 本文件负责：
 * 1. 运行时正则编译增强（`enhanceRegionDefs`）
 * 2. 内存单例缓存与快速反查映射（`REGION_METADATA_MAP`, `CONTINENT_ALIAS_MAP`）
 * 3. 动态大洲匹配与策略组过滤算法
 * 4. SSOT 契约自检（`validateMapping`）
 */

'use strict';

const {
  CONTINENT_DEFS,
  SUB_REGION_DEFS,
  REGION_DEFS_RAW,
  REGIONS_BY_ID,
  REGION_ZONES
} = require('../../data/regions');

/**
 * 运行时增强：预编译并装配每个地区的 matchReg / cityReg / codeReg
 */
const REGION_FLAG_LOOKUPS = new WeakMap();
let enhancedRegionDefsCache = null;
let defaultRegionFlagLookupCache = null;

function enhanceRegionDefs(defs) {
  defs.forEach(r => {
    const combinedSource = r.city ? `${r.reg.source}|${r.city}` : r.reg.source;
    r.matchReg = new RegExp(combinedSource, "i");
    r.cityReg = r.city ? new RegExp(r.city, "i") : null;
    r.codeReg = r.codeReg || null;
  });
  REGION_FLAG_LOOKUPS.set(defs, new Map(defs.filter(r => r.icon).map(r => [r.icon, r])));
  return defs;
}

function getRegionFlagLookup(defs) {
  if (defs === enhancedRegionDefsCache && defaultRegionFlagLookupCache) {
    return defaultRegionFlagLookupCache;
  }
  let lookup = REGION_FLAG_LOOKUPS.get(defs);
  if (!lookup) {
    lookup = new Map((Array.isArray(defs) ? defs : []).filter(r => r?.icon).map(r => [r.icon, r]));
    if (Array.isArray(defs)) REGION_FLAG_LOOKUPS.set(defs, lookup);
  }
  return lookup;
}

/**
 * 获取完整增强过的地区定义列表（模块级不可变单例缓存，零重复编译开销）
 */
function getEnhancedRegionDefs() {
  if (!enhancedRegionDefsCache) {
    const cloned = REGION_DEFS_RAW.map(r => ({ ...r }));
    enhanceRegionDefs(cloned);
    enhancedRegionDefsCache = Object.freeze(cloned);
    defaultRegionFlagLookupCache = new Map(enhancedRegionDefsCache.filter(r => r.icon).map(r => [r.icon, r]));
  }
  return enhancedRegionDefsCache;
}

/**
 * SSOT 自检函数：校验全量地区与大洲定义的完整性与唯一性，杜绝 ID 碰撞或字段漂移
 */
function validateMapping() {
  const mismatches = [];
  const seenIds = new Set();
  const REQUIRED_REGION_FIELDS = ['id', 'name', 'groupName', 'continent', 'icon', 'iconFile', 'reg'];

  for (const r of REGION_DEFS_RAW) {
    for (const field of REQUIRED_REGION_FIELDS) {
      if (!r[field]) {
        mismatches.push(`${r.id || r.name || '未知'}: 缺少合法的 ${field} 字段`);
      }
    }
    if (seenIds.has(r.id)) {
      mismatches.push(`${r.name}: 存在重复的地区 id "${r.id}"`);
    } else {
      seenIds.add(r.id);
    }

    if (r.reg && !(r.reg instanceof RegExp)) mismatches.push(`${r.id}: reg 必须为 RegExp 实例`);
    if (r.codeReg && !(r.codeReg instanceof RegExp)) mismatches.push(`${r.id}: codeReg 必须为 RegExp 实例`);
  }

  // 校验大洲/次大区定义不与国家地区 ID 冲突（如 sas vs sa）
  for (const c of CONTINENT_DEFS) {
    if (seenIds.has(c.id)) {
      mismatches.push(`大洲/次大区 id "${c.id}" (${c.name}) 与国家地区 id 冲突！`);
    }
  }

  if (mismatches.length) {
    throw new Error("[region-defs] SSOT 校验失败:\n  " + mismatches.join("\n  "));
  }
  return true;
}

/**
 * 权威地区元数据事实源 (单一事实源 SSOT，派生自 REGION_DEFS_RAW)
 * 映射标准地区名 -> { groupKey, countryCode, regionName, groupName, icon, continent, subGroup, foldGroup }
 */
const REGION_METADATA_MAP = Object.freeze(
  REGION_DEFS_RAW.reduce((acc, r) => {
    acc[r.name] = Object.freeze({
      groupKey: r.id,
      countryCode: r.code,
      regionName: r.name,
      groupName: r.groupName,
      icon: r.icon,
      continent: r.continent,
      subGroup: r.subGroup,
      foldGroup: r.foldGroup
    });
    return acc;
  }, {})
);

/**
 * 洲级与次大区标准代号映射 (单一事实源自派生，杜绝手动维护漂移)
 */
const CONTINENT_ALIAS_MAP = Object.freeze(
  [...CONTINENT_DEFS, ...SUB_REGION_DEFS].reduce((map, item) => {
    const target = item.target || item.id;
    for (const alias of (item.aliases || [])) {
      map[alias.toLowerCase()] = target;
    }
    return map;
  }, {})
);

/**
 * 判断指定地区元数据是否属于特定大洲/次大区
 * @param {object} regionDef 地区元数据对象 (来自 REGION_DEFS_RAW、CONTINENT_DEFS 或节点 regionInfo)
 * @param {string} continentToken 大洲或次大区代号 (如 'asia', '欧洲', 'sea', 'sas')
 * @returns {boolean}
 */
function isRegionInContinent(regionDef, continentToken) {
  if (!regionDef || !continentToken) return false;
  const target = CONTINENT_ALIAS_MAP[String(continentToken).trim().toLowerCase()];
  if (!target) return false;

  const rContinent = (regionDef.continent || '').toLowerCase();
  const rSubGroup = (regionDef.subGroup || '').toLowerCase();
  const rFoldGroup = (regionDef.foldGroup || regionDef.group || '').toLowerCase();
  const rId = (regionDef.id || '').toLowerCase();

  // 1. 大洲级全量匹配 (asia, europe, americas, oceania, africa)
  if (rContinent === target) return true;

  // 2. 次大区 / 折叠大区代码匹配 (ea, sea, sas, me, na, latam, eu, af, oc)
  if (rSubGroup === target || rFoldGroup === target || rId === target) return true;

  return false;
}

/**
 * 从策略组名称列表中筛选出属于特定大洲/次大区的策略组名
 * @param {Array<string>} groupNames 策略组名称数组
 * @param {string} continentToken 大洲或次大区代号
 * @returns {Array<string>}
 */
function filterRegionsByContinent(groupNames = [], continentToken) {
  if (!Array.isArray(groupNames) || !continentToken) return [];
  const target = CONTINENT_ALIAS_MAP[String(continentToken).trim().toLowerCase()];
  if (!target) return [];

  const defs = getEnhancedRegionDefs();
  return groupNames.filter(name => {
    if (!name || typeof name !== 'string') return false;
    const clean = name.replace(/节点$/, '').trim();

    // 1. 匹配 CONTINENT_DEFS (如 '欧洲', '东南亚', '美洲', '南亚', '中东', '非洲', '大洋洲')
    const contMatch = CONTINENT_DEFS.find(c => c.name === clean || c.groupName === name || c.id === clean.toLowerCase());
    if (contMatch) {
      return isRegionInContinent(contMatch, target);
    }

    // 2. 匹配具体地区 REGION_DEFS (如 '香港', '日本', '大陆', '美国', '德国' 等)
    const rMatch = defs.find(r => r.name === clean || r.groupName === name || r.id === clean.toLowerCase());
    if (rMatch) {
      return isRegionInContinent(rMatch, target);
    }

    return false;
  });
}

/**
 * 「负载均衡-哈希 (地区)」派生组名全集
 *
 * 后缀与展示层的地区/大洲徽标同源（地区用 `name`，大洲用 `name`），
 * 拓扑建组、routing 目标白名单与展示层登记共用这一份派生规则，避免各自枚举漂移。
 *
 * @returns {string[]} 形如 `负载均衡-哈希 (香港)` 的组名列表
 */
function getHashLbGroupNames() {
  const suffixes = new Set(['大陆']);
  for (const r of getEnhancedRegionDefs()) {
    if (r.id !== 'cn' && r.name !== '中国' && r.name) suffixes.add(r.name);
  }
  for (const c of CONTINENT_DEFS) {
    if (c.name) suffixes.add(c.name);
  }
  return [...suffixes].map(suffix => `负载均衡-哈希 (${suffix})`);
}

module.exports = {
  CONTINENT_DEFS,
  SUB_REGION_DEFS,
  CONTINENT_ALIAS_MAP,
  REGION_METADATA_MAP,
  isRegionInContinent,
  filterRegionsByContinent,
  getEnhancedRegionDefs,
  getRegionFlagLookup,
  getHashLbGroupNames,
  validateMapping,
  REGION_DEFS_RAW,
  REGIONS_BY_ID,
  REGION_ZONES
};
