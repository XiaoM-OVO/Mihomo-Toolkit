/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 单一配置 schema 校验层 (Pipeline Level)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 把散落在三处的 groups / routing 校验收敛到**单一逻辑入口**，
 *    全部在「装载后 / 装配前」执行（fail-closed，尽早失败）；
 * 2. 拓扑引擎（装配期）只消费已通过校验的对象，不再重复做类型和存在性判断；
 * 3. 延续分层契约：config 层不依赖 strategy，因此校验入口挂在 pipeline 层。
 *
 * 已收敛的校验：
 * - groups：字段白名单、类型、配方、宏合法性 → `strategy/matcher.validateGroups`；
 * - routing：结构校验、预设/服务/目标存在性、方向与 disabled 取值 → `strategy/routing.validateRouting`；
 * - 装配期不再重复调用 `validateGroups`（`topology.js` 已移除）；
 * - `topology-engine.js` 的「未知宏 / 非法类型 / 构建异常」warn + skip 已改为 fail-closed。
 */

'use strict';

const { validateGroups } = require('../strategy/matcher');
const { validateRouting } = require('../strategy/routing');

/**
 * 全量校验合并后的配置 schema（groups + routing）
 *
 * 调用时机：`resolveConfig` 之后、清洗节点与装配之前。所有非法配置在此尽早失败，
 * 用户看到的阶段与消息风格统一（`groups[i]` / `routing[i]` 字段路径）。
 *
 * @param {object} userConfig 合并后的完整配置（resolveConfig 输出）
 * @param {object} registries ServiceCatalog#toRegistries() 输出
 * @param {object} [options={}] 展开选项（disabledRefs / direction）
 */
function validateConfigSchema(userConfig, registries, options = {}) {
  // 1. groups：ref / disabled 结构已在 config/groups.js 装载期结算，此处只校验配方与字段
  validateGroups(userConfig.groups);

  // 2. routing：非数组 / 空表 / 未知字段 / 目标不存在等全部 fail-closed
  const routing = userConfig.routing;
  if (!Array.isArray(routing)) {
    throw new TypeError('[Config] routing: 期望条目对象数组（数组顺序即匹配优先级）');
  }
  validateRouting(routing, userConfig, registries, options);
}

module.exports = {
  validateConfigSchema
};
