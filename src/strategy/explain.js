/**
 * -----------------------------------------------------------------------------
 * 激活摘要收集器 (Explain Trace)
 * -----------------------------------------------------------------------------
 * 中间态决策（组 / 规则 / 池的激活、跳过、剪枝、为空）原本只以日志碎片形式散落
 * 在 routing → topology → prune 三层，`--explain` 无法可靠还原。这里提供一条
 * 「结构化通道」：三层在决策点显式写入记录，不解析日志、不依赖 logLevel。
 *
 * 未启用时返回 null，调用方以 `trace?.add(...)` 使用，零成本、不改变产物。
 *
 * 记录契约（对外稳定）：
 *   { kind: 'group' | 'rule' | 'pool' | 'provider',
 *     id,            // 对象标识：组名 / 规则条目 / 池名 / Provider 名
 *     status: 'active' | 'skipped' | 'pruned' | 'empty',
 *     code,          // 机器可读原因码（回归基线断言用）
 *     detail?,       // 用户可读说明
 *     members?       // 组 / 池的成员数量（可选）
 *   }
 */

'use strict';

const EXPLAIN_KINDS = Object.freeze(['group', 'rule', 'pool', 'provider']);
const EXPLAIN_STATUSES = Object.freeze(['active', 'skipped', 'pruned', 'empty']);
// 组记录的「最终态」优先级：剪枝淘汰 > 骨架兜底 > 破环保留 > 建组快照。
// 同一组会在 topology 与 prune 两层各写一次，必须让更接近最终产物的结论覆盖过程快照。
const GROUP_RECORD_WEIGHT = Object.freeze({
  snapshot: 1,
  cycleBroken: 2,
  rescued: 3,
  pruned: 4
});

function groupRecordWeight(record) {
  if (record.code === 'unreachable' || record.code === 'post-cycle') return GROUP_RECORD_WEIGHT.pruned;
  if (record.code === 'rescue-direct') return GROUP_RECORD_WEIGHT.rescued;
  if (record.code === 'cycle-broken') return GROUP_RECORD_WEIGHT.cycleBroken;
  return GROUP_RECORD_WEIGHT.snapshot;
}

/**
 * 创建激活摘要收集器
 * @param {boolean} [enabled=false] 未启用时返回 null（调用方零成本短路）
 * @returns {{records: Array<object>, add: Function, size: number}|null}
 */
function createExplainTrace(enabled = false) {
  if (!enabled) return null;
  const records = [];

  return {
    records,
    get size() {
      return records.length;
    },
    /**
     * 写入一条决策记录
     * @param {object} record
     */
    add(record) {
      if (!record || typeof record !== 'object') return;
      const { kind, id, status, code, detail, members } = record;
      // 内部写入点拼错时立即暴露，避免摘要静默丢字段
      if (!EXPLAIN_KINDS.includes(kind)) {
        throw new Error(`[explain] 未知记录类型「${kind}」，可用: ${EXPLAIN_KINDS.join(' / ')}`);
      }
      if (!EXPLAIN_STATUSES.includes(status)) {
        throw new Error(`[explain] 未知记录状态「${status}」，可用: ${EXPLAIN_STATUSES.join(' / ')}`);
      }
      if (id === undefined || id === null || id === '') {
        throw new Error('[explain] 记录缺少 id');
      }
      const entry = { kind, id: String(id), status, code: String(code || 'unspecified') };
      if (typeof members === 'number' && Number.isFinite(members)) entry.members = members;
      if (detail !== undefined && detail !== null && detail !== '') entry.detail = String(detail);
      // 组摘要只保留最终态：同一组被剪枝后，先前的「激活」快照必须被覆盖，
      // 否则摘要会同时给出两条相反结论，读者无法判断最终产物里到底有没有这个组。
      if (kind === 'group') {
        const index = records.findIndex(item => item.kind === 'group' && item.id === entry.id);
        if (index !== -1) {
          if (groupRecordWeight(entry) > groupRecordWeight(records[index])) {
            records[index] = entry;
          }
          return;
        }
      }
      records.push(entry);
    }
  };
}

module.exports = {
  createExplainTrace,
  EXPLAIN_KINDS,
  EXPLAIN_STATUSES
};
