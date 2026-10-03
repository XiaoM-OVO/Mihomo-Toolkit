/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 顶级统一门面入口 (Unified Facade)
 * -----------------------------------------------------------------------------
 * 汇集全链路工作流调度引擎、三态交付流水线及底层 I/O 解析器。
 * 保持对各类调用方式（CLI / Server / Worker / SDK）的统一调用契约。
 */

const { buildProfile, runPipelineEngine, normalizeOutputMode } = require('./pipeline/engine');
const { runConfigPipeline } = require('./pipeline/config');
const { safeFetchText } = require('./io/fetcher');
const { validateRequestLimits, DEFAULT_REQUEST_LIMITS } = require('./io/limits');
const { redactUrl, isAllowedUrl, validateUrlSsrf } = require('./io/ssrf');
const {
  parseContent,
  parseUri,
  parseUriList,
  registerParser,
  getParser,
  hasParser,
  getRegisteredSchemes,
  parseVlessUri,
  parseVmessUri,
  parseTrojanUri,
  parseSsUri,
  parseHysteria2Uri,
  parseTuicUri,
  parseSocksUri,
  parseHttpUri
} = require('./io/parsers');

const { runNodesPipeline } = require('./pipeline/nodes');
const { runStrategyPipeline } = require('./pipeline/strategy');
const { buildAuditReport } = require('./pipeline/report');
const { createLogger, Logger } = require('./core/logger');
const { hardenRemoteConfig, REMOTE_CONFIG_FORBIDDEN_KEYS } = require('./core/security/remote-config');

module.exports = {
  createLogger,
  Logger,
  buildProfile,
  runPipelineEngine,
  normalizeOutputMode,
  runConfigPipeline,
  runNodesPipeline,
  runStrategyPipeline,
  buildAuditReport,
  redactUrl,
  isAllowedUrl,
  safeFetchText,
  validateRequestLimits,
  DEFAULT_REQUEST_LIMITS,
  validateUrlSsrf,
  hardenRemoteConfig,
  REMOTE_CONFIG_FORBIDDEN_KEYS,
  parseContent,
  parseUri,
  parseUriList,
  registerParser,
  getParser,
  hasParser,
  getRegisteredSchemes,
  parseVlessUri,
  parseVmessUri,
  parseTrojanUri,
  parseSsUri,
  parseHysteria2Uri,
  parseTuicUri,
  parseSocksUri,
  parseHttpUri
};
