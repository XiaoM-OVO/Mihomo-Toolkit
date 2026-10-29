/**
 * -----------------------------------------------------------------------------
 * Data: 策略组身份键 (Group Identity)
 * -----------------------------------------------------------------------------
 * 内部逻辑只使用稳定的身份键判定“是哪一个组”，中文组名只是展示标签：
 *   - 键 → 规范名（`groupName`）是单一真相源，data / strategy 层共用同一份表；
 *   - 名字只允许出现在用户配置边界与最终交付产物中；
 *   - 未知键 fail-closed，新增组时漏登记会立即报错，而不是静默退化为名字匹配。
 *
 * 用户面的 `ref` 键（catalog 目录键）不登记在此：目录键由 ServiceCatalog 投影产生，
 * 且允许用户覆写组名；内部身份键不暴露给配置面，二者语义不同、不得混用。
 */

'use strict';

const { POOL_NAMES } = require('../default-pools');

/** 内部身份键（稳定、非用户面） */
const GROUP_KEYS = Object.freeze({
  auto: 'auto',
  manual: 'manual',
  fallback: 'fallback',
  download: 'download',
  roundRobin: 'round-robin',
  final: 'final',
  residential: 'residential',
  lowMulti: 'low-multi',
  domestic: 'domestic',
  ipv6: 'ipv6',
  highMulti: 'high-multi',
  experimental: 'experimental',
  dashboard: 'dashboard',
  other: 'other',
  unknown: 'unknown',
  adBlock: 'ad-block',
  antiAd: 'anti-ad'
});

/**
 * 骨架常驻组的身份键声明顺序 = 目标注册表的判定优先级。
 * 池由池表单独登记，不在此列；`poolDependent` 仅描述“池为空时可缺席”的语义。
 */
const SKELETON_GROUP_KEYS = Object.freeze([
  GROUP_KEYS.auto,
  GROUP_KEYS.manual,
  GROUP_KEYS.fallback,
  GROUP_KEYS.roundRobin,
  GROUP_KEYS.final,
  GROUP_KEYS.residential,
  GROUP_KEYS.domestic,
  GROUP_KEYS.ipv6,
  GROUP_KEYS.highMulti,
  GROUP_KEYS.experimental,
  GROUP_KEYS.dashboard,
  GROUP_KEYS.other,
  GROUP_KEYS.unknown
]);

/**
 * 身份键 → 规范名与属性
 *
 * `skeleton` 表示拓扑无条件/条件产出的内置骨架组；`poolDependent` 表示成员来自节点池，
 * 池为空或未启用时不建组（引用它的规则按设计跳过）。
 */
const GROUP_IDENTITIES = Object.freeze({
  [GROUP_KEYS.auto]: Object.freeze({ name: '自动选择', skeleton: true, poolDependent: false }),
  [GROUP_KEYS.manual]: Object.freeze({ name: '手动选择', skeleton: true, poolDependent: false }),
  [GROUP_KEYS.fallback]: Object.freeze({ name: '故障转移', skeleton: true, poolDependent: false }),
  [GROUP_KEYS.download]: Object.freeze({ name: '下载策略', skeleton: false, poolDependent: false }),
  [GROUP_KEYS.roundRobin]: Object.freeze({ name: '负载均衡-轮询', skeleton: true, poolDependent: true }),
  [GROUP_KEYS.final]: Object.freeze({ name: '漏网之鱼', skeleton: true, poolDependent: false }),
  [GROUP_KEYS.residential]: Object.freeze({ name: POOL_NAMES.residential, skeleton: true, poolDependent: true }),
  [GROUP_KEYS.domestic]: Object.freeze({ name: '中国分流', skeleton: true, poolDependent: false }),
  [GROUP_KEYS.ipv6]: Object.freeze({ name: 'IPv6控制台', skeleton: true, poolDependent: false }),
  [GROUP_KEYS.highMulti]: Object.freeze({ name: POOL_NAMES.highMulti, skeleton: true, poolDependent: true }),
  [GROUP_KEYS.experimental]: Object.freeze({ name: POOL_NAMES.experimental, skeleton: true, poolDependent: true }),
  [GROUP_KEYS.dashboard]: Object.freeze({ name: '订阅与状态看板', skeleton: true, poolDependent: false }),
  [GROUP_KEYS.other]: Object.freeze({ name: '其他节点', skeleton: true, poolDependent: false }),
  [GROUP_KEYS.unknown]: Object.freeze({ name: '未知识别', skeleton: true, poolDependent: false }),
  [GROUP_KEYS.lowMulti]: Object.freeze({ name: POOL_NAMES.lowMulti, skeleton: false, poolDependent: true }),
  // 两个广告规则来源共用同一个组名，展示层只认第一个登记项（`ad-block`）
  [GROUP_KEYS.adBlock]: Object.freeze({ name: '广告拦截', skeleton: false, poolDependent: false }),
  [GROUP_KEYS.antiAd]: Object.freeze({ name: '广告拦截', skeleton: false, poolDependent: false })
});

/** 组名前缀装饰（Emoji / 符号）剥离规则：展示层与身份匹配共用同一实现 */
const GROUP_DECORATION_PREFIX = /^[^\p{L}\p{N}]+/u;

function stripGroupDecoration(rawName) {
  const stripped = String(rawName || '').replace(GROUP_DECORATION_PREFIX, '').trim();
  return stripped || String(rawName || '').trim();
}

/** 规范名 → 身份键（同名键按登记顺序取第一个） */
const KEY_BY_NAME = new Map(
  Object.entries(GROUP_IDENTITIES).map(([key, def]) => [def.name, key])
);

/**
 * 取身份键对应的规范组名
 * @param {string} key 身份键
 * @returns {string}
 */
function groupName(key) {
  const def = GROUP_IDENTITIES[key];
  if (!def) {
    throw new Error(`未知策略组身份键「${key}」，请在 data/catalog/identity.js 登记`);
  }
  return def.name;
}

/**
 * 取身份键对应的完整声明
 * @param {string} key 身份键
 * @returns {{name: string, skeleton: boolean, poolDependent: boolean}}
 */
function groupIdentity(key) {
  const def = GROUP_IDENTITIES[key];
  if (!def) {
    throw new Error(`未知策略组身份键「${key}」，请在 data/catalog/identity.js 登记`);
  }
  return def;
}

/**
 * 规范组名（允许带 Emoji/图标前缀）→ 身份键
 * @param {string} rawName 组名
 * @returns {string|null} 未登记的名字返回 null（用户自写组、服务组、地区组等）
 */
function groupKeyOfName(rawName) {
  if (typeof rawName !== 'string' || !rawName.trim()) return null;
  const value = rawName.trim();
  return KEY_BY_NAME.get(value) || KEY_BY_NAME.get(stripGroupDecoration(value)) || null;
}

/**
 * 骨架常驻组规范名（按判定优先级排序）
 * @returns {string[]}
 */
function skeletonGroupNames() {
  return SKELETON_GROUP_KEYS.map(groupName);
}

/**
 * 池依赖组的规范名（池为空 / 未启用时允许缺席）
 * @returns {string[]}
 */
function poolDependentGroupNames() {
  return Object.entries(GROUP_IDENTITIES)
    .filter(([, def]) => def.poolDependent)
    .map(([, def]) => def.name);
}

module.exports = {
  GROUP_KEYS,
  GROUP_IDENTITIES,
  SKELETON_GROUP_KEYS,
  GROUP_DECORATION_PREFIX,
  stripGroupDecoration,
  groupName,
  groupIdentity,
  groupKeyOfName,
  skeletonGroupNames,
  poolDependentGroupNames
};
