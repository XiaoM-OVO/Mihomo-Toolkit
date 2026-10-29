/**
 * -----------------------------------------------------------------------------
 * Target: `--explain` 激活摘要渲染（人类可读 / JSON 双输出）
 * -----------------------------------------------------------------------------
 * 只消费 strategy 层收集器产出的记录，不重新推导任何决策：
 *   - 人类可读：按「组 / 规则 / 池 / 规则集」分节，逐条标注状态与原因；
 *   - `--json`：{ version, counts, records }，记录字段即对外契约，可直接做回归基线。
 *
 * 记录字段：{ kind, id, status, code, detail?, members? }
 */

'use strict';

/** 输出契约版本：记录字段或语义发生不兼容变化时递增 */
const EXPLAIN_PAYLOAD_VERSION = 1;

const KIND_ORDER = ['group', 'rule', 'pool', 'provider'];

const KIND_LABELS = {
  group: '组',
  rule: '规则',
  pool: '池',
  provider: '规则集'
};

const STATUS_LABELS = {
  active: '激活',
  skipped: '跳过',
  pruned: '剪枝',
  empty: '为空'
};

const STATUS_MARKS = {
  active: '✅',
  skipped: '⏭️',
  pruned: '🍂',
  empty: '🫙'
};

/**
 * 汇总记录数量
 * @param {Array<object>} records
 * @returns {{total: number, byStatus: Record<string, number>, byKind: Record<string, number>}}
 */
function countRecords(records = []) {
  const byStatus = { active: 0, skipped: 0, pruned: 0, empty: 0 };
  const byKind = { group: 0, rule: 0, pool: 0, provider: 0 };
  for (const record of records) {
    if (byStatus[record.status] !== undefined) byStatus[record.status] += 1;
    if (byKind[record.kind] !== undefined) byKind[record.kind] += 1;
  }
  return { total: records.length, byStatus, byKind };
}

/**
 * 构建 `--explain --json` 输出载荷
 * @param {Array<object>} records 收集器记录
 * @returns {{version: number, counts: object, records: Array<object>}}
 */
function buildExplainPayload(records = []) {
  const list = Array.isArray(records) ? records : [];
  return {
    version: EXPLAIN_PAYLOAD_VERSION,
    counts: countRecords(list),
    records: list.map(record => ({ ...record }))
  };
}

/** 单条记录 → 一行文本 */
function renderRecord(record) {
  const parts = [
    STATUS_MARKS[record.status] || '•',
    record.id,
    `· ${STATUS_LABELS[record.status] || record.status}`
  ];
  if (typeof record.members === 'number') parts.push(`· 成员 ${record.members}`);
  if (record.detail) parts.push(`· ${record.detail}`);
  return parts.join(' ');
}

/**
 * 渲染人类可读摘要
 * @param {Array<object>} records 收集器记录
 * @returns {string}
 */
function renderExplainReport(records = []) {
  const list = Array.isArray(records) ? records : [];
  const counts = countRecords(list);
  const statusText = ['active', 'skipped', 'pruned', 'empty']
    .map(status => `${STATUS_LABELS[status]} ${counts.byStatus[status]}`)
    .join(' · ');
  const head = `🧪 激活摘要 (--explain)：共 ${counts.total} 条记录（${statusText}）`;
  if (counts.total === 0) {
    return [head, '└── （无记录）'].join('\n');
  }

  const sections = KIND_ORDER
    .filter(kind => counts.byKind[kind] > 0)
    .map(kind => {
      const sectionRecords = list.filter(record => record.kind === kind);
      const lines = [`${KIND_LABELS[kind]} (${sectionRecords.length})`];
      sectionRecords.forEach((record, index) => {
        const branch = index === sectionRecords.length - 1 ? '└──' : '├──';
        lines.push(`${branch} ${renderRecord(record)}`);
      });
      return lines;
    });

  const out = [head];
  sections.forEach((lines, index) => {
    const isLast = index === sections.length - 1;
    out.push(`${isLast ? '└──' : '├──'} ${lines[0]}`);
    for (let i = 1; i < lines.length; i++) {
      out.push(`${isLast ? '    ' : '│   '}${lines[i]}`);
    }
  });
  return out.join('\n');
}

module.exports = {
  EXPLAIN_PAYLOAD_VERSION,
  countRecords,
  buildExplainPayload,
  renderExplainReport
};
