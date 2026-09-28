/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 顶级统一门面入口 (Unified Facade)
 * -----------------------------------------------------------------------------
 * 汇集全链路构建、节点算子 (Operator)、客户端主函数 (Verge Main) 及底层解析器。
 * 保持对各类调用方式（CLI / Server / Worker / SDK / Tests）的完全向下兼容。
 */

const { buildProfile, runConfigPipeline } = require('./pipeline/config');
const { safeFetchText } = require('./io/fetcher');
const { validateRequestLimits, DEFAULT_REQUEST_LIMITS } = require('./io/limits');
const { redactUrl, isAllowedUrl, validateUrlSsrf } = require('./io/ssrf');
const {
  parseContent,
  parseVlessUri,
  parseVmessUri,
  parseTrojanUri,
  parseSsUri
} = require('./io/parsers');
const { operator } = require('./targets/operator');
const { main } = require('./targets/verge');

const { runNodesPipeline } = require('./pipeline/nodes');
const { buildAuditReport } = require('./pipeline/report');

module.exports = {
  buildProfile,
  runConfigPipeline,
  runNodesPipeline,
  buildAuditReport,
  operator,
  main,
  redactUrl,
  isAllowedUrl,
  safeFetchText,
  validateRequestLimits,
  DEFAULT_REQUEST_LIMITS,
  validateUrlSsrf,
  parseContent,
  parseVlessUri,
  parseVmessUri,
  parseTrojanUri,
  parseSsUri
};
