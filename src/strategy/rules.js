/**
 * 路由数据表与底层拼装原语
 *
 * 本模块只保留「可被数据驱动」的部分：规则集路由基线、BT/下载数据表、
 * Rule-Provider 构造器与进程规则展开。**规则顺序与目标由 `src/strategy/routing.js`
 * 按 `routing` 表决定**——这里不再有任何按开关拼接段的代码
 * （旧实现 `buildRoutingRules` 已于批次 3 删除，顺序表见 `src/data/default-routing.js`）。
 */

const { GROUP_KEYS, groupName } = require('../data/catalog/identity');

function dedupe(arr) {
  return [...new Set(arr)];
}

/**
 * 基础网络与常用下载规则集路由定义基线
 */
const BASE_PROVIDER_ROUTES = Object.freeze({
  'lan-domain': 'geosite/private',
  'lan-ip': 'geoip/private',
  'non-cn': 'geosite/geolocation-!cn',
  'cn-domain': 'geosite/cn',
  'cn-ip': 'geoip/cn',
  'bt-trackers-pt': 'geosite/category-pt',
  'bt-trackers-public': 'geosite/category-public-tracker',
  'download-android': 'geosite/category-android-app-download',
  'download-games': 'geosite/category-game-platforms-download',
  'download-games-cn': 'geosite/category-game-platforms-download@cn'
});

/**
 * BT / 下载类分流规则的数据表
 * -----------------------------------------------------------------------------
 * 规则集与目标都由数据表达：新增一个规则集只加一行，不再改组装代码。
 * 顺序即优先级（先到先得），因此表的顺序就是最终规则顺序。
 * 这段的语义是「BT 与下载软件直连」——写进 `routing` 表即启用。
 */
const BT_TRACKER_RULES = Object.freeze([
  { provider: 'bt-trackers-pt', target: 'DIRECT' },
  { provider: 'bt-trackers-public', target: 'DIRECT' },
  { keyword: 'tracker', target: 'DIRECT' },
  { keyword: 'announce', target: 'DIRECT' }
]);

const DOWNLOAD_RULESETS = Object.freeze([
  { provider: 'download-games-cn', target: 'DIRECT' },
  { provider: 'download-games', target: groupName(GROUP_KEYS.download) },
  { provider: 'download-android', target: groupName(GROUP_KEYS.download) }
]);

/**
 * 按数据表注入下载类规则
 * @param {string[]} routingRules 目标规则数组（原地追加）
 * @param {ReadonlyArray<object>} table 规则数据表
 * @param {string|null} [overrideTarget=null] 整段目标覆写（`to`），为空时沿用表内目标
 */
function pushDownloadRules(routingRules, table, overrideTarget = null) {
  for (const item of table) {
    const target = overrideTarget || item.target;
    routingRules.push(
      item.keyword
        ? `DOMAIN-KEYWORD,${item.keyword},${target}`
        : `RULE-SET,${item.provider},${target}`
    );
  }
}

/**
 * 根据规则集标识与路由定义生成标准 HTTP Rule-Provider 对象
 * @param {string} name 规则集标识
 * @param {string} route 相对路径 (如 geosite/cn) 或绝对 URL (如 https://...)
 * @param {object} [options={}]
 * @param {string} [options.repoBase=''] 远端 CDN 仓库基准地址
 * @param {string} [options.ruleFormat='yaml'] 规则集格式 ('mrs' | 'yaml')
 * @param {string} [options.proxy='DIRECT'] 规则集拉取代理策略
 * @param {number} [options.interval=86400] 规则集自动更新间隔 (秒)
 * @returns {object} Rule-Provider 对象
 */
function createHttpRuleProvider(name, route, options = {}) {
  const {
    repoBase = '',
    ruleFormat = 'yaml',
    proxy = 'DIRECT',
    interval = 86400
  } = options;

  const isExternal = /^https?:\/\//.test(route);
  const url = isExternal ? route : `${repoBase}/geo/${route}.${ruleFormat}`;
  const fmt = isExternal ? (/\.mrs$/i.test(route) ? 'mrs' : 'yaml') : ruleFormat;
  const behavior = isExternal ? 'domain' : (route.includes('geoip') ? 'ipcidr' : 'domain');

  return {
    type: 'http',
    behavior,
    url,
    path: `./ruleset/${name}.${fmt}`,
    interval,
    format: fmt,
    proxy
  };
}

/**
 * 展开基于 OS 类型的进程规则
 * @param {object} processLists
 * @param {string[]} processLists.win
 * @param {string[]} processLists.mac
 * @param {string[]} processLists.lin
 * @param {string} target 路由目标
 * @param {object} osInfo
 * @returns {string[]}
 */
function expandProcessRules(processLists, target, osInfo) {
  const { isWin, isMac, isLin } = osInfo;
  const rules = [];
  if (isWin && Array.isArray(processLists.win)) {
    rules.push(...processLists.win.map(p => {
      const exeName = p.toLowerCase().endsWith('.exe') ? p : `${p}.exe`;
      return `PROCESS-NAME,${exeName},${target}`;
    }));
  }
  if (isMac && Array.isArray(processLists.mac)) {
    rules.push(...processLists.mac.map(p => `PROCESS-NAME,${p},${target}`));
  }
  if (isLin && Array.isArray(processLists.lin)) {
    rules.push(...processLists.lin.map(p => `PROCESS-NAME,${p},${target}`));
  }
  return rules;
}

module.exports = {
  BASE_PROVIDER_ROUTES,
  BT_TRACKER_RULES,
  DOWNLOAD_RULESETS,
  createHttpRuleProvider,
  dedupe,
  expandProcessRules,
  pushDownloadRules
};
