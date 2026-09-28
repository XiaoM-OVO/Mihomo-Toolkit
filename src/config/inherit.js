/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 运行模式与分层配置协调器 (Config Inherit Coordinator)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 规范化交付输出模式 (config / nodes / report)
 * 2. 协调 cleaner 与 strategy 双端配置覆盖 (cleanerConfig / profileConfig)
 * 3. 根级白名单与特殊规则自动并集合并
 */

function coordinateConfigs(userConfig = {}, options = {}, { hasInjectedTag = false } = {}) {
  let cleanerConfig = { ...userConfig, ...(userConfig.cleanerConfig || userConfig.pureConfig || {}) };
  let strategyConfig = { ...userConfig, ...(userConfig.profileConfig || userConfig.toolkitConfig || {}) };

  // 模式归一化
  let targetType = (options.type || userConfig.outputMode || userConfig.type || 'config').toLowerCase();
  if (targetType === 'full') targetType = 'config';
  if (targetType === 'cleaner' || targetType === 'pure') targetType = 'nodes';
  if (targetType === 'meta' || targetType === 'audit') targetType = 'report';

  const isPassthrough = !!(userConfig.passthrough || userConfig.preserveRawConfig);

  // 多订阅时强制双端启用机场来源标签读取
  if (hasInjectedTag) {
    cleanerConfig.enableAirportTag = true;
    strategyConfig.enableAirportTag = true;
  }

  // 完整模式协调
  if (targetType === 'config' && !isPassthrough) {
    strategyConfig.enableNodeRename = (userConfig.enableNodeRename !== undefined)
      ? userConfig.enableNodeRename
      : false;
    cleanerConfig.showFeatureIcon = false;
    cleanerConfig.removeInfoNodes = userConfig.removeInfoNodes ?? true;
  }

  // 根级白名单与自定义规则自动同步并集合并
  const whitelist = userConfig.whitelistKeywords || [];
  const specialRules = userConfig.specialNodeRules || [];
  if (whitelist.length > 0) {
    cleanerConfig.whitelistKeywords = [...new Set([...(cleanerConfig.whitelistKeywords || []), ...whitelist])];
    strategyConfig.whitelistKeywords = [...new Set([...(strategyConfig.whitelistKeywords || []), ...whitelist])];
  }
  if (specialRules.length > 0) {
    cleanerConfig.specialNodeRules = [...new Set([...(cleanerConfig.specialNodeRules || []), ...specialRules])];
    strategyConfig.specialNodeRules = [...new Set([...(strategyConfig.specialNodeRules || []), ...specialRules])];
  }

  return {
    cleanerConfig,
    strategyConfig,
    targetType,
    isPassthrough
  };
}

module.exports = {
  coordinateConfigs
};
