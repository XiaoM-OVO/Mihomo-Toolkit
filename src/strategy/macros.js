/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 策略组引用宏符号单一真相源 (Macro Registry)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 集中登记全部 `@` 前缀动态拓扑宏的别名与求值口径（别名 → 求值器）；
 * 2. 同时服务消费方两端：拓扑引擎（运行期求值）与配方校验器（配置期白名单）。
 *
 * 之所以把别名与求值器放在同一张表里，是为了让「有哪些宏」与「宏怎么算」
 * 共用一份真相源：校验器据此 fail-closed 拒绝未知宏，引擎据此求值，
 * 两侧永远不会因为各自维护一份清单而漂移。
 */

const { filterRegionsByContinent } = require('../core/shared/regions');
const { GROUP_KEYS, groupName } = require('../data/catalog/identity');

/** 大洲 / 次大区宏：统一走 filterRegionsByContinent 口径 */
const CONTINENT_DEFS = [
  { id: 'asia', aliases: ['@asia', '@asiaregions', '@亚洲'] },
  { id: 'europe', aliases: ['@europe', '@eu', '@euregions', '@欧洲'] },
  { id: 'americas', aliases: ['@americas', '@america', '@am', '@美洲'] },
  { id: 'oceania', aliases: ['@oceania', '@oc', '@大洋洲'] },
  { id: 'africa', aliases: ['@africa', '@af', '@非洲'] },
  { id: 'sea', aliases: ['@sea', '@searegions', '@东南亚'] },
  { id: 'me', aliases: ['@me', '@中东'] },
  { id: 'sas', aliases: ['@sas', '@南亚'] },
  { id: 'na', aliases: ['@na', '@北美'] },
  { id: 'latam', aliases: ['@latam', '@拉美'] },
  { id: 'ea', aliases: ['@ea', '@东亚'] }
];

/**
 * 宏定义表：每条 = 一组别名 + 求值器（入参为宏求值上下文，返回 string[]）。
 */
const MACRO_DEFS = [
  { aliases: ['@matchednodes', '@matched', '@nodes'], resolve: ctx => ctx.matchedNodeNames || [] },
  { aliases: ['@residential', '@resi'], resolve: ctx => ctx.residential || [] },
  { aliases: ['@residentialgroup', '@resigroup'], resolve: ctx => ctx.residentialGroup || [] },
  { aliases: ['@allstandard', '@all'], resolve: ctx => ctx.allStandard || [] },
  { aliases: ['@highmulti'], resolve: ctx => ctx.highMulti || [] },
  { aliases: ['@special'], resolve: ctx => ctx.special || [] },
  { aliases: ['@activeregions', '@regions'], resolve: ctx => ctx.activeRegions || [] },
  { aliases: ['@defaultproxy', '@proxy'], resolve: ctx => [ctx.defaultProxy || groupName(GROUP_KEYS.auto)] },
  { aliases: ['@standardoptions', '@standard'], resolve: ctx => ctx.standardOptions || [] },
  { aliases: ['@domesticgroup', '@domestic'], resolve: ctx => ctx.domesticGroup || [] },
  { aliases: ['@cncoregroups', '@cncore'], resolve: ctx => ctx.cnCoreGroups || [] },
  { aliases: ['@downloadgroup'], resolve: ctx => ctx.downloadGroup || [] },
  { aliases: ['@noncnregions', '@noncn'], resolve: ctx => ctx.nonCnRegions || [] },
  { aliases: ['@preferredregions', '@preferred'], resolve: ctx => ctx.preferredRegions || [] },
  ...CONTINENT_DEFS.map(c => ({
    aliases: c.aliases,
    resolve: ctx => filterRegionsByContinent(ctx.activeRegions || [], c.id)
  }))
];

/** 别名（小写）→ 求值器 */
const MACRO_RESOLVERS = new Map();
for (const def of MACRO_DEFS) {
  for (const alias of def.aliases) {
    MACRO_RESOLVERS.set(alias, def.resolve);
  }
}

/** 全部合法宏别名（小写）。校验器据此判定「未知宏」并 fail-closed。 */
const MACRO_ALIASES = new Set(MACRO_RESOLVERS.keys());

/** 每个宏的规范写法（各定义组的首个别名），供错误提示内联「可用宏」清单 */
const MACRO_PRIMARY_ALIASES = Object.freeze(MACRO_DEFS.map(def => def.aliases[0]));

/**
 * 宏分组投影：规范写法 + 全部别名（含规范写法本身）。
 *
 * 供 `list macros` 一类只读展示复用同一份定义，避免消费方自行按集合顺序猜分组。
 */
const MACRO_GROUPS = Object.freeze(
  MACRO_DEFS.map(def => Object.freeze({
    macro: def.aliases[0],
    aliases: Object.freeze([...def.aliases])
  }))
);

/**
 * 可用宏清单文本（错误提示专用）
 *
 * 只列规范写法：别名与中文写法同样可用，全部列出会让报错淹没成一堵墙；
 * 完整别名与求值口径仍以 CONFIGURATION.md 的宏变量清单为准。
 * @returns {string}
 */
function formatMacroHints() {
  return MACRO_PRIMARY_ALIASES.join(' / ');
}

/**
 * 判定某个 token 是否为已登记宏。
 * @param {string} token
 * @returns {boolean}
 */
function isKnownMacro(token) {
  return typeof token === 'string' && MACRO_ALIASES.has(token.trim().toLowerCase());
}

/**
 * 求值单个宏 token。
 * @param {string} token 形如 `@matchedNodes`
 * @param {object} ctx 宏求值上下文
 * @returns {string[]|null} 未知宏返回 null（由调用方决定告警或跳过）
 */
function resolveMacro(token, ctx = {}) {
  const resolver = MACRO_RESOLVERS.get(String(token || '').trim().toLowerCase());
  if (!resolver) return null;
  const value = resolver(ctx);
  return Array.isArray(value) ? value : [];
}

module.exports = {
  MACRO_ALIASES,
  MACRO_PRIMARY_ALIASES,
  MACRO_GROUPS,
  isKnownMacro,
  resolveMacro,
  formatMacroHints
};
