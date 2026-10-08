/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 简繁中文全链路四路同步器 (Chinese Converter Sync)
 * -----------------------------------------------------------------------------
 * 职责：
 * 保证节点名、策略组名、组内引用（proxies/use）与路由规则（rules）中的组名引用四路严格一致。
 */

let chineseConvert = {
  toSimplified: (t) => t,
  toTraditional: (t) => t,
  deepConvertStrings: (o) => o,
  isAvailable: () => false
};
try {
  chineseConvert = require('./chinese-convert');
} catch (e) {}

/**
 * 执行全链路四路同步转换
 * @param {object} outputData 包含 proxies, proxy-groups, rules 的完整配置
 * @param {object} userConfig 用户配置
 * @param {object} [logger]
 * @returns {object} 同步后的配置对象
 */
function syncChineseConvert(outputData, userConfig = {}, logger) {
  const isOpenccReady = !!(chineseConvert.isAvailable && chineseConvert.isAvailable());
  const canConvert = !!(userConfig.enableChineseConvert && isOpenccReady);
  if (!canConvert || !outputData) return outputData;

  const modeLabel = userConfig.chineseConvertMode === 's2t' ? '繁体' : '简体';
  if (logger) logger.info(`🔤 简繁转换: 输出 ${modeLabel}`);

  const convertFn = userConfig.chineseConvertMode === 's2t'
    ? chineseConvert.toTraditional
    : chineseConvert.toSimplified;

  const nodeRenameMap = {};
  const groupRenameMap = {};

  // 1. 转换节点名
  if (Array.isArray(outputData.proxies)) {
    for (const proxy of outputData.proxies) {
      if (!proxy || !proxy.name) continue;
      const oldName = proxy.name;
      proxy.name = convertFn(proxy.name);
      if (oldName !== proxy.name) nodeRenameMap[oldName] = proxy.name;
    }
  }

  // 2. 转换策略组名 + 组内 proxies / use 引用
  if (Array.isArray(outputData['proxy-groups'])) {
    for (const group of outputData['proxy-groups']) {
      if (!group || !group.name) continue;
      const oldName = group.name;
      group.name = convertFn(group.name);
      if (oldName !== group.name) groupRenameMap[oldName] = group.name;
      if (Array.isArray(group.proxies)) {
        group.proxies = group.proxies.map(p => nodeRenameMap[p] || groupRenameMap[p] || convertFn(p));
      }
      if (Array.isArray(group.use)) {
        group.use = group.use.map(u => groupRenameMap[u] || convertFn(u));
      }
    }
  }

  // 3. 转换 rules 中的策略组名引用（精确按逗号分隔符匹配，杜绝误伤域名或规则类型）
  if (Array.isArray(outputData.rules) && Object.keys(groupRenameMap).length > 0) {
    outputData.rules = outputData.rules.map(rule => {
      if (typeof rule !== 'string') return rule;
      return rule.split(',').map(token => groupRenameMap[token.trim()] || token).join(',');
    });
  }

  // 4. 转换 rule-providers 中的代理组引用
  if (outputData['rule-providers'] && typeof outputData['rule-providers'] === 'object' && Object.keys(groupRenameMap).length > 0) {
    Object.values(outputData['rule-providers']).forEach(rp => {
      if (rp && rp.proxy && groupRenameMap[rp.proxy]) {
        rp.proxy = groupRenameMap[rp.proxy];
      }
    });
  }

  return outputData;
}

module.exports = {
  chineseConvert,
  syncChineseConvert
};
