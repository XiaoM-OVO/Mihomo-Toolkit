/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 完整配置装配流水线 (Config Pipeline)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 专注完整 Mihomo 配置生成与序列化交付
 * 2. 支持 passthrough 透传模式（保留原订阅顶层规则，替换 proxies）
 * 3. 支持全新构建模式（双列网格状态看板、六维策略拓扑、分流规则组装）
 * 4. 简繁同步、私有属性擦除、YAML 序列化与订阅头注入
 */

const yaml = require('yaml');
const { runStrategyPipeline } = require('./strategy');
const { aggregateSubscriptions, buildGlobalDashboardNodes } = require('../strategy/dashboard');
const { syncChineseConvert } = require('../core/chinese-sync');

/**
 * 装配并序列化完整 Mihomo 配置文件
 * @param {object} params
 * @param {object} params.configData 原始输入的基础配置对象
 * @param {Array<object>} params.cleanProxies 已清洗打标的标准节点列表
 * @param {Array<object>} [params.classifiedNodes] 节点分类信息（直接复用，避免二次打标）
 * @param {Array<object>} [params.collectedSubInfos] 订阅流量与到期信息列表
 * @param {object} [params.userConfig={}] 用户配置对象
 * @param {object} [params.logger] 日志记录器
 * @returns {object} { yamlStr, outputData, userInfo }
 */
function runConfigPipeline({
  configData = { proxies: [] },
  cleanProxies = [],
  classifiedNodes = null,
  collectedSubInfos = [],
  userConfig = {},
  logger
}) {
  const isPassthrough = !!(userConfig.passthrough || userConfig.preserveRawConfig);
  let outputData;

  const expireAggregation = userConfig.expireAggregation || 'min';
  const agg = aggregateSubscriptions(collectedSubInfos, { expireAggregation, logger });

  if (isPassthrough) {
    // 1. 透传模式：仅将 proxies 替换为干净节点，原订阅外围规则完好保留
    outputData = { ...configData, proxies: cleanProxies };
    if (logger) logger.log(`✅ 透传完成: 继承原配置并替换为 ${cleanProxies.length} 个干净节点`);
  } else {
    // 2. 全量组装模式：合成双列看板，注入策略组拓扑与分流规则
    const activeSubsWithTraffic = collectedSubInfos.filter(s => !s.expired && s.total > 0);
    if (userConfig.enableDashboard !== false && activeSubsWithTraffic.length > 1 && agg.globalTotal > 0) {
      const topNodes = buildGlobalDashboardNodes({
        globalUpload: agg.globalUpload,
        globalDownload: agg.globalDownload,
        globalTotal: agg.globalTotal,
        globalExpire: agg.globalExpire,
        expireAggregation
      });
      cleanProxies.unshift(...topNodes);
    }

    configData.proxies = cleanProxies;
    outputData = configData;

    if (logger) logger.log('🔄 阶段: strategy 策略组构建');
    outputData = runStrategyPipeline(outputData, userConfig, { classifiedNodes });

    const groups = outputData['proxy-groups'] || [];
    const proxies = outputData.proxies || [];
    const featureSwitches = [
      userConfig.enableAI && 'AI', userConfig.enableStreaming && '流媒体',
      userConfig.enableGame && '游戏', userConfig.enableTelegram && 'TG',
      userConfig.enableGitHub && 'GitHub', userConfig.enableScholar && 'Scholar',
      userConfig.enableSystemServices && '系统', userConfig.enableDomesticGroup && '中国分流',
      userConfig.enableAdBlock && '广告拦截'
    ].filter(Boolean);
    if (logger) {
      logger.log(`✅ 构建完成: ${proxies.length} 个节点, ${groups.length} 个策略组` +
        (featureSwitches.length > 0 ? ` | ${featureSwitches.join(' ')}` : ''));
    }
  }

  // 3. 简繁中文四路同步
  outputData = syncChineseConvert(outputData, userConfig, logger);

  // 4. 清除内部私有字段（_ 前缀）
  if (Array.isArray(outputData.proxies)) {
    for (const p of outputData.proxies) {
      if (p && typeof p === 'object') {
        for (const key of Object.keys(p)) {
          if (key.startsWith('_')) delete p[key];
        }
      }
    }
  }

  // 5. YAML 序列化与订阅头注入
  let yamlStr = yaml.stringify(outputData);
  if (agg.globalTotal > 0 || agg.globalExpire > 0) {
    yamlStr = `# subscription-userinfo: upload=${agg.globalUpload}; download=${agg.globalDownload}; total=${agg.globalTotal}; expire=${agg.globalExpire}\n` +
              `# profile-web-page-url: https://github.com/mihomo-toolkit\n` +
              `# upload=${agg.globalUpload}; download=${agg.globalDownload}; total=${agg.globalTotal}; expire=${agg.globalExpire}\n` +
              yamlStr;
  }

  return {
    yamlStr,
    outputData,
    userInfo: {
      upload: agg.globalUpload,
      download: agg.globalDownload,
      total: agg.globalTotal,
      expire: agg.globalExpire
    }
  };
}

module.exports = {
  runConfigPipeline
};
