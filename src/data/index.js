/**
 * -----------------------------------------------------------------------------
 * Data Layer: 只读运行基础数据 (Read-only Runtime Baselines)
 * -----------------------------------------------------------------------------
 * 本层是洋葱模型的最底层，回答「**程序里有什么**」：
 *   - `field-registry.js`      —— 有哪些配置字段，各自的默认值 / 合并语义 / 信任级
 *   - `security-baselines.js`  —— 哪些域名、策略组、过滤器属于不可协商的安全基线
 *
 * 分层契约（红线）：
 *   1. 本层**只读**：不得读取 `config.yaml`、不得包含任何 I/O 或环境探测；
 *   2. 本层**最底**：不得 require `core` / `strategy` / `io` / `pipeline` / `targets` / `config`；
 *   3. 本层**纯数据 + 纯函数**：相同输入必然得到相同输出，可直接被任何层引用。
 *
 * 与 `src/config/` 的分工：
 *   `data` 说「有什么、什么是危险的」，`config` 说「这次调用什么、改什么」。
 */

'use strict';

const {
  PROTECTED_DOMAINS,
  SKELETON_EXEMPT_GROUPS,
  FAKEIP_FILTER_BASELINE,
  ENTRY_NORMALIZERS,
  normalizeDomainEntry,
  normalizeDomainList,
  mergeBaseline,
  effectiveProtectedDomains,
  effectiveExemptGroups
} = require('./security-baselines');

const {
  FIELDS,
  FIELDS_BY_KEY,
  ADDITIVE_FIELDS,
  DEFAULTLESS_FIELDS,
  REMOTE_DENIED_FIELDS,
  REMOTE_ALLOWED_FIELDS,
  buildDefaultConfig
} = require('./field-registry');

module.exports = {
  // 字段注册表
  FIELDS,
  FIELDS_BY_KEY,
  ADDITIVE_FIELDS,
  DEFAULTLESS_FIELDS,
  REMOTE_DENIED_FIELDS,
  REMOTE_ALLOWED_FIELDS,
  buildDefaultConfig,
  // 只读安全基线
  PROTECTED_DOMAINS,
  SKELETON_EXEMPT_GROUPS,
  FAKEIP_FILTER_BASELINE,
  ENTRY_NORMALIZERS,
  normalizeDomainEntry,
  normalizeDomainList,
  mergeBaseline,
  effectiveProtectedDomains,
  effectiveExemptGroups
};
