/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 订阅状态与虚拟信息节点合成 (已归纳至 Strategy 层)
 * -----------------------------------------------------------------------------
 * @deprecated 核心看板计算逻辑已收敛至 src/strategy/dashboard.js
 * 本文件保留作为向前兼容导出，防止外部或旧测试引用中断。
 */

const {
  formatBytes,
  calcResetDays,
  generateInfoNodes
} = require('../strategy/dashboard');

const {
  parseSubscriptionInfo,
  isExpiredNow
} = require('./parsers/sub-info');

module.exports = {
  formatBytes,
  calcResetDays,
  generateInfoNodes,
  parseSubscriptionInfo,
  isExpiredNow
};
