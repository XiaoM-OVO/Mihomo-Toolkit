/**
 * Subscription-Userinfo 响应头解析器
 *
 * 实现已下沉至 Core 层纯工具 `src/core/shared/sub-info.js`
 * （strategy 层需要该能力但不得反向依赖 io 层），此处 re-export 保持既有导入路径不变。
 */

'use strict';

module.exports = require('../../core/shared/sub-info');
