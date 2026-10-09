/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 完整配置装配流水线 (Config Pipeline)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 专注完整 Mihomo 配置生成与序列化交付
 * 2. 交付契约铁律：产物顶层键只能由本工具生成（生成前重置 + 交付前白名单收口）
 * 3. 全新构建模式（双列网格状态看板、六维策略拓扑、分流规则组装）
 * 4. 简繁同步、私有属性擦除、YAML 序列化与订阅头注入
 */

const yaml = require('yaml');
const { runStrategyPipeline } = require('./strategy');
const { aggregateSubscriptions } = require('../strategy/dashboard');
const { syncChineseConvert } = require('../core/chinese-sync');
const { resetToolkitOutputKeys, enforceOutputContract } = require('../core/security/control-plane');

/**
 * 装配并序列化完整 Mihomo 配置文件
 * @param {object} params
 * @param {object} [params.sourceSkeleton={ proxies: [] }] 原始输入的基础配置骨架
 * @param {Array<object>} params.cleanProxies 已清洗打标的标准节点列表
 * @param {Array<object>} [params.classifiedNodes] 节点分类信息（直接复用，避免二次打标）
 * @param {Array<object>} [params.collectedSubInfos] 订阅流量与到期信息列表
 * @param {object} [params.userConfig={}] 用户配置对象
 * @param {object} [params.logger] 日志记录器
 * @returns {object} { yamlStr, outputData, userInfo }
 */
function runConfigPipeline({
  sourceSkeleton = { proxies: [] },
  cleanProxies = [],
  classifiedNodes = null,
  collectedSubInfos = [],
  userConfig = {},
  logger
}) {
  let outputData;

  const expireAggregation = userConfig.expireAggregation || 'min';
  const agg = aggregateSubscriptions(collectedSubInfos, { expireAggregation, logger });

  // 1. 控制面重置：清空输入骨架中一切工具自有键，确保覆盖式生成不残留源配置取值。
  //    治本点：config 模式的输出骨架可能来自外部输入（订阅 / --url 指定的配置文件），
  //    绝不允许其携带 dns / tun / hosts / rules 等控制面字段进入产物。
  const resetKeys = resetToolkitOutputKeys(sourceSkeleton);
  if (resetKeys.length > 0 && logger && logger.isLevelEnabled && logger.isLevelEnabled('debug')) {
    logger.debug(`🛡️ 控制面重置: 已清空输入骨架中的 ${resetKeys.length} 个工具自有键 (${resetKeys.join(', ')})`);
  }

  // 2. 全量组装模式：注入安全 DNS、TUN、策略组拓扑与分流规则
  sourceSkeleton.proxies = cleanProxies;
  outputData = sourceSkeleton;

  outputData = runStrategyPipeline(outputData, userConfig, { classifiedNodes, logger });

  const groups = outputData['proxy-groups'] || [];
  const proxies = outputData.proxies || [];
  const rules = outputData.rules || [];
  if (logger) {
    const realProxies = proxies.filter(p => !p.isSyntheticInfo);
    const isZeroNode = realProxies.length === 0;
    const synthCount = proxies.filter(p => p.isSyntheticInfo).length;
    const regionalGroups = groups.filter(g => g.name && /节点/.test(g.name));
    const serviceGroups = groups.filter(g => g.name && !/节点/.test(g.name));
    const lines = [`📐 拓扑策略装配完成:`];

    if (isZeroNode) {
      lines.push(`├── 🛡️ 纯分流拦截模式: 无代理节点，已清空区域组并保留拦截/直连规则`);
    } else {
      if (synthCount > 0) {
        lines.push(`├── 📊 状态看板: ${synthCount} 条目 (已合成全局总额与独立看板)`);
      }
      lines.push(`├── 🌏 地区拓扑: ${regionalGroups.length} 个区域组`);
    }
    lines.push(`└── 🎯 分流服务: ${serviceGroups.length} 个规则组 (${rules.length} 条分流规则)`);
    logger.info(lines.join('\n'));
  }

  // 3. 内核 DNS 不变式自检 (INV-1 ~ INV-9)：
  //    把「参考实现」升级为生产路径的实际校验，避免出现「文档承诺、实现不检查」。
  const { checkInvariants } = require('../core/security/resolver-plan');
  const fakeIpFilterMode = userConfig.fakeIpFilterNodes !== undefined ? userConfig.fakeIpFilterNodes : 'smart';
  const invariantViolations = checkInvariants(outputData.dns || {}, {
    proxies: outputData.proxies || [],
    fakeIpFilterNodes: fakeIpFilterMode,
    dnsAllowNonLoopback: userConfig.dnsAllowNonLoopback === true
  });
  if (invariantViolations.length > 0 && logger) {
    logger.warn(
      `⚠️ DNS 不变式自检发现 ${invariantViolations.length} 项违规: ` +
      invariantViolations.map(v => `${v.id}(${v.detail})`).join(' | ')
    );
  }

  // 4. 简繁中文四路同步
  outputData = syncChineseConvert(outputData, userConfig, logger);

  // 5. 清除内部私有字段（_ 前缀）
  if (Array.isArray(outputData.proxies)) {
    for (const p of outputData.proxies) {
      if (p && typeof p === 'object') {
        for (const key of Object.keys(p)) {
          if (key.startsWith('_')) delete p[key];
        }
      }
    }
  }
  for (const key of Object.keys(outputData)) {
    if (key.startsWith('_')) delete outputData[key];
  }

  // 5. 交付契约收口：仅放行工具自有顶层键 (fail-closed)
  //    即使上游某条路径遗漏了净化，产物也不允许出现任何非工具自有字段。
  const { stripped } = enforceOutputContract(outputData);
  if (stripped.length > 0 && logger) {
    const preview = stripped.slice(0, 8).join(', ');
    logger.warn(
      `🛡️ 交付契约: 已剥离 ${stripped.length} 个非工具自有顶层字段 (${preview}${stripped.length > 8 ? ', …' : ''})`
    );
  }

  // 6. YAML 序列化与标头注入
  let yamlStr = yaml.stringify(outputData);

  let pkgVersion = '2.0.0-dev';
  try {
    const pkg = require('../../package.json');
    if (pkg && pkg.version) pkgVersion = pkg.version;
  } catch {}

  let banner = `# =====================================================================\n` +
               `# Mihomo-Toolkit v${pkgVersion}\n` +
               `# https://github.com/XiaoM-OVO/Mihomo-Toolkit\n` +
               `# =====================================================================\n`;

  if (agg.globalTotal > 0 || agg.globalExpire > 0) {
    banner += `# subscription-userinfo: upload=${agg.globalUpload}; download=${agg.globalDownload}; total=${agg.globalTotal}; expire=${agg.globalExpire}\n` +
              `# profile-web-page-url: https://github.com/XiaoM-OVO/Mihomo-Toolkit\n` +
              `# upload=${agg.globalUpload}; download=${agg.globalDownload}; total=${agg.globalTotal}; expire=${agg.globalExpire}\n`;
  }
  yamlStr = banner + yamlStr;

  return {
    yamlStr,
    outputData,
    invariantViolations,
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
