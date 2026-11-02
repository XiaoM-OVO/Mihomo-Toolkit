/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 交付层叠加 (Delivery Overlay)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 把「请求 Host 派生的直连规则 / fake-ip-filter」在渲染期叠加到 Host 无关的缓存产物上
 * 2. 在服务旧缓存、而最近一次回源异常时，叠加一条降级提示节点
 * 3. 严格只读缓存产物：所有修改都发生在克隆副本上，绝不污染 L2 缓存条目
 *
 * 设计边界：
 * - 构建与缓存键只承载「内容输入」，请求 Host 不进入构建，也不进入缓存键；
 * - 本模块是唯一的交付期视图叠加点，规则格式复用 strategy 层的生成器，避免两处漂移。
 */

'use strict';

const yaml = require('yaml');
const { GROUP_KEYS, groupName } = require('../data/catalog/identity');
const { buildSubDomainDirectRules } = require('./routing');
const { buildSubDomainFakeIpFilters } = require('./dns');
const { markTrustedSynthetic } = require('../core/node-trust');
const { normalizeSubDomains } = require('../infra/ip');
const { ICONS } = require('../core/log-copy');

const LAN_IP_RULE = 'RULE-SET,lan-ip,DIRECT,no-resolve';
/** expandSubscription 在 LAN 规则后紧跟的可选 IPv6 直连段（叠加点必须越过它们） */
const IPV6_DIRECT_RULES = new Set([
  'IP-CIDR6,::1/128,DIRECT,no-resolve',
  'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
  'IP-CIDR6,fe80::/10,DIRECT,no-resolve'
]);

/**
 * 计算请求 Host 直连规则的插入位置。
 *
 * 构建期该段固定在「LAN 规则之后、广告/分流规则之前」；渲染期叠加必须落在同一段，
 * 否则会被后续代理规则抢先匹配。锚点缺失时前置插入，优先保证订阅服务域名可直连。
 *
 * @param {string[]} rules
 * @returns {number}
 */
function findSubDomainInsertIndex(rules) {
  const lanIdx = rules.indexOf(LAN_IP_RULE);
  if (lanIdx < 0) return 0;
  let idx = lanIdx + 1;
  while (idx < rules.length && IPV6_DIRECT_RULES.has(rules[idx])) idx++;
  return idx;
}

function cloneDeliveryData(outputData) {
  const data = {
    ...outputData,
    rules: Array.isArray(outputData.rules) ? [...outputData.rules] : outputData.rules,
    proxies: Array.isArray(outputData.proxies) ? [...outputData.proxies] : outputData.proxies,
    'proxy-groups': Array.isArray(outputData['proxy-groups'])
      ? outputData['proxy-groups'].map(group => (
        group && Array.isArray(group.proxies)
          ? { ...group, proxies: [...group.proxies] }
          : group
      ))
      : outputData['proxy-groups'],
    dns: outputData.dns && typeof outputData.dns === 'object'
      ? {
        ...outputData.dns,
        ...(Array.isArray(outputData.dns['fake-ip-filter'])
          ? { 'fake-ip-filter': [...outputData.dns['fake-ip-filter']] }
          : {})
      }
      : outputData.dns
  };
  return data;
}

/**
 * 渲染交付产物（Host 叠加 + 降级提示），不传任何叠加项时原样返回缓存字符串。
 *
 * @param {object} result 构建产物（需含 outputData / banner / yamlStr）
 * @param {object} [options={}]
 * @param {string|string[]} [options.hosts] 本次请求可信 Host 派生的 subDomain
 * @param {string[]} [options.noticeTags] 最近一次回源异常的订阅标识（仅标签，不含 URL）
 * @param {boolean} [options.enableDashboard=true] 是否允许合成看板提示节点
 * @param {function} [options.convertText] 可选简繁转换函数（仅作用于新生成的提示文案）
 * @returns {string}
 */
function renderDelivery(result, options = {}) {
  if (!result || typeof result !== 'object') return '';
  const hosts = normalizeSubDomains(options.hosts);
  const noticeTags = Array.isArray(options.noticeTags)
    ? Array.from(new Set(options.noticeTags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim())))
    : [];
  const enableDashboard = options.enableDashboard !== false;
  const convertText = typeof options.convertText === 'function' ? options.convertText : null;

  if (hosts.length === 0 && (!enableDashboard || noticeTags.length === 0)) {
    return typeof result.yamlStr === 'string' ? result.yamlStr : '';
  }
  if (!result.outputData || typeof result.outputData !== 'object') {
    return typeof result.yamlStr === 'string' ? result.yamlStr : '';
  }

  const data = cloneDeliveryData(result.outputData);
  let changed = false;

  // 1. 请求 Host → 订阅服务域名直连规则（与构建期静态 subDomain 同一段、同一格式）
  if (hosts.length > 0) {
    const existing = new Set(data.rules || []);
    const additions = buildSubDomainDirectRules(hosts).filter(rule => !existing.has(rule));
    if (additions.length > 0 && Array.isArray(data.rules)) {
      const idx = findSubDomainInsertIndex(data.rules);
      data.rules.splice(idx, 0, ...additions);
      changed = true;
    }

    // 2. 请求 Host → fake-ip-filter（仅域名/通配，顺序无语义）
    const filters = buildSubDomainFakeIpFilters(hosts);
    if (filters.length > 0 && data.dns && typeof data.dns === 'object') {
      const current = Array.isArray(data.dns['fake-ip-filter']) ? data.dns['fake-ip-filter'] : [];
      const existingFilters = new Set(current);
      const additionsList = filters.filter(item => !existingFilters.has(item));
      if (additionsList.length > 0) {
        data.dns['fake-ip-filter'] = [...current, ...additionsList];
        changed = true;
      }
    }
  }

  // 3. 最近一次回源异常 → 旧缓存降级提示节点（受 enableDashboard 控制）
  if (enableDashboard && noticeTags.length > 0 && Array.isArray(data.proxies)) {
    const dashboardName = groupName(GROUP_KEYS.dashboard);
    const dashboardGroup = Array.isArray(data['proxy-groups'])
      ? data['proxy-groups'].find(g => g && g.name === dashboardName)
      : null;

    if (dashboardGroup && Array.isArray(dashboardGroup.proxies)) {
      const existingNames = new Set(data.proxies.map(p => p && p.name).filter(Boolean));
      const newNames = [];
      for (const tag of noticeTags) {
        const rawName = `${ICONS.DEGRADED} [${tag}] 最近一次回源异常 · 当前为旧缓存`;
        const name = convertText ? convertText(rawName) : rawName;
        if (existingNames.has(name)) continue;
        existingNames.add(name);
        data.proxies.push(markTrustedSynthetic({
          name,
          type: 'direct',
          server: '1.0.0.1',
          port: 80,
          isSyntheticInfo: true
        }));
        newNames.push(name);
      }
      if (newNames.length > 0) {
        const directIdx = dashboardGroup.proxies.indexOf('DIRECT');
        if (directIdx >= 0) {
          dashboardGroup.proxies.splice(directIdx, 0, ...newNames);
        } else {
          dashboardGroup.proxies.push(...newNames);
        }
        changed = true;
      }
    }
  }

  if (!changed) return typeof result.yamlStr === 'string' ? result.yamlStr : '';
  return `${typeof result.banner === 'string' ? result.banner : ''}${yaml.stringify(data)}`;
}

module.exports = {
  renderDelivery,
  _internals: {
    findSubDomainInsertIndex,
    cloneDeliveryData
  }
};
