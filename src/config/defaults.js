/**
 * Mihomo-Toolkit 全局默认配置
 *
 * ⚠️ 本文件不再是「默认值的手写清单」，而是**只读数据层的投影**：
 *    字段的默认值 / 类型 / 合并语义 / 信任级统一声明在 `src/data/field-registry.js`。
 *    需要新增或修改字段默认值，请改注册表，不要在此处追加字面量——
 *    默认值本身就是安全姿态的一部分（例如 `dnsAllowNonLoopback: false`），
 *    由 `test/data-baseline.test.js` 的 golden 基线锁定，任何改动都必须显式体现为测试差异。
 */

'use strict';

const { buildDefaultConfig } = require('../data/field-registry');

/** 出厂默认配置（由字段注册表派生，键序与注册表声明顺序一致） */
const DEFAULT_CONFIG = buildDefaultConfig();

module.exports = {
  DEFAULT_CONFIG
};
