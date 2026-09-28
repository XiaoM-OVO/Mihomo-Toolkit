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
  if (logger) logger.log(`🔤 简繁转换: 输出 ${modeLabel}`);

  const convertFn = userConfig.chineseConvertMode === 's2t'
    ? chineseConvert.toTraditional
    : chineseConvert.toSimplified;

  const nameMap = {};

  // 1. 转换节点名
  if (Array.isArray(outputData.proxies)) {
    for (const proxy of outputData.proxies) {
      if (!proxy || !proxy.name) continue;
      const oldName = proxy.name;
      proxy.name = convertFn(proxy.name);
      if (oldName !== proxy.name) nameMap[oldName] = proxy.name;
    }
  }

  // 2. 转换策略组名 + 组内 proxies / use 引用
  if (Array.isArray(outputData['proxy-groups'])) {
    for (const group of outputData['proxy-groups']) {
      if (!group || !group.name) continue;
      const oldName = group.name;
      group.name = convertFn(group.name);
      if (oldName !== group.name) nameMap[oldName] = group.name;
      if (Array.isArray(group.proxies)) {
        group.proxies = group.proxies.map(p => convertFn(p));
      }
      if (Array.isArray(group.use)) {
        group.use = group.use.map(u => convertFn(u));
      }
    }
  }

  // 3. 转换 rules 中的策略组名引用（如 RULE-SET,ads,🚫 广告拦截 -> 🚫 廣告攔截）
  if (Array.isArray(outputData.rules) && Object.keys(nameMap).length > 0) {
    outputData.rules = outputData.rules.map(rule => {
      for (const [oldName, newName] of Object.entries(nameMap)) {
        if (rule.includes(oldName)) {
          rule = rule.replace(oldName, newName);
        }
      }
      return rule;
    });
  }

  return outputData;
}

module.exports = {
  chineseConvert,
  syncChineseConvert
};
