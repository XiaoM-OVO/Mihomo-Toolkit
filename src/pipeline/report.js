/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 节点健康度与清洗审计报告流水线 (Report Pipeline)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 结构化汇总节点清洗、物理去重、广告拦截、分身裂变等统计数据
 * 2. 导出开箱即用的 JSON 审计报告，便于 CI/CD、自动化质检与监控集成
 */

let VERSION = '2.0.0-dev';
try {
  const pkg = require('../../package.json');
  if (pkg && pkg.version) VERSION = pkg.version;
} catch (e) {}

/**
 * 组装标准化审计与质检报告
 * @param {object} meta 核心清洗阶段吐出的元数据对象
 * @param {Array<object>} proxies 最终留存的代理节点列表
 * @param {object} [options={}]
 * @returns {object} 结构化报告对象
 */
function buildAuditReport(meta = {}, proxies = [], options = {}) {
  const stats = meta?.stats || {
    total: proxies.length,
    outputCount: proxies.length,
    dedupeCount: 0,
    discardedCount: 0,
    infoCount: 0,
    unknownCount: 0,
    fissionCount: 0
  };

  const invariantViolations = options.invariantViolations || meta?.invariantViolations || [];

  return {
    service: 'mihomo-toolkit',
    version: VERSION,
    timestamp: new Date().toISOString(),
    stats,
    summary: {
      totalInput: stats.total,
      cleanOutput: stats.outputCount,
      intercepted: stats.discardedCount,
      deduped: stats.dedupeCount,
      fissionCreated: stats.fissionCount,
      invariantViolations: invariantViolations.length
    },
    invariantViolations,
    meta: meta || null
  };
}

module.exports = {
  buildAuditReport
};
