/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 单调递增代际序号与异步时序守卫原语
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 提供全局严格单调递增的代际序号源 (GenerationSource)
 * 2. 提供跨异步边界的时序守卫判定 (isSuperseded)：判断任务起点捕获的代际号
 *    是否已被更新的写入/删除操作超越
 *
 * 设计取舍：
 * - 序号严格递增且不回绕：回绕会重发历史号码，令「条目引用 + 版本号」快照守卫
 *   在极端情况下失效，故统一采用超限即时抛错策略，杜绝版本号重用；
 * - 本模块仅收敛「序号分配」与「代际超越判定」这两处重复的时序机制，
 *   不合并 ProfileCache (构建结果 LRU + SWR) 与 SubStaleCacheMap (订阅容灾) 的
 *   存储结构与淘汰语义 —— 二者本质不同，强行合并属过度设计。
 */

'use strict';

/**
 * 单调递增代际序号源：全进程内严格递增，达到安全上限时即时抛错而非回绕。
 */
class GenerationSource {
  /**
   * @param {string} [label='generation'] 用于溢出异常信息定位
   */
  constructor(label = 'generation') {
    this._label = label;
    this._counter = 0;
  }

  /**
   * 分配下一个严格单调递增的代际号
   * @returns {number}
   */
  next() {
    if (this._counter >= Number.MAX_SAFE_INTEGER) {
      throw new Error(`${this._label}: generation counter exceeded Number.MAX_SAFE_INTEGER`);
    }
    this._counter += 1;
    return this._counter;
  }

  /**
   * 当前已分配的最大代际号（读取不推进计数）
   * @returns {number}
   */
  get current() {
    return this._counter;
  }
}

/**
 * 异步时序守卫判定：捕获代际是否已被更新的写入/删除超越。
 * - 仅当两侧均为有效正整数且 stored > captured 时判定为「已被超越」；
 * - 任务未持有代际号 (captured <= 0) 或条目无代际号 (stored <= 0) 时不做拦截。
 * @param {number} storedGeneration 当前条目持有的代际号
 * @param {number} capturedGeneration 任务起点捕获的代际号
 * @returns {boolean} 是否已被超越（true = 落后方必须放弃该操作）
 */
function isSuperseded(storedGeneration, capturedGeneration) {
  return storedGeneration > 0 && capturedGeneration > 0 && storedGeneration > capturedGeneration;
}

module.exports = {
  GenerationSource,
  isSuperseded
};
