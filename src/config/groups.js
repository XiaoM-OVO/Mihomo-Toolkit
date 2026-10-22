/**
 * -----------------------------------------------------------------------------
 * 声明式策略组清单解析器 (`groups` 统一入口)
 * -----------------------------------------------------------------------------
 * 用户面只需要认一张清单：`groups`。清单里的每一条要么引用内置组目录
 * (`{ ref: <键> }`)，要么是一条完整的自定义组声明；两者结构完全同构。
 *
 * 本模块负责把这批「原始声明」归一化为引擎可直接消费的「完整组声明」：
 *   1. `{ ref: <键> }` → 从内置目录取出完整声明，并允许条目内覆写任意字段；
 *   2. `disabled: true` → 显式关闭（跨 include 片段时唯一的关闭手段，因为 include 的数组语义是并集去重）；
 *   3. 未知 ref 键 / 结构非法 → fail-closed 并报出配置字段路径（禁止静默跳过）。
 */

/**
 * 将原始 `groups` 清单归一化为完整组声明列表
 *
 * `disabled` 与 `ref` 都是声明层的元信息，这里一次性结算成**显式返回值**：
 * 关闭状态不再写回目录对象（避免隐式通道与跨 include 的顺序残留），调用方
 * 通过 `disabledRefs` 判断引用是否已关闭。同一条目多次出现时**位置靠后者胜**，
 * 与 include 的「主文件优先」语义一致。
 *
 * @param {Array} rawGroups 原始清单（用户配置 `groups` 字段）
 * @param {object} [options]
 * @param {Record<string, object>} [options.directory] 内置组目录（`registries.groups`）
 * @param {Record<string, string>} [options.memberHints] 聚合组成员键 → 所属聚合组 ref 键（报错时给出改引指引）
 * @param {string} [options.fieldPath='groups'] 报错时使用的字段路径前缀
 * @returns {{declarations: Array<object>, refKeys: Array<string|null>, disabledRefs: string[]}}
 *   `refKeys[i]` 与 `declarations[i]` 一一对应（自写声明为 null）
 */
function resolveGroupDeclarations(rawGroups, { directory = {}, memberHints = {}, fieldPath = 'groups' } = {}) {
  if (rawGroups === undefined || rawGroups === null) {
    return { declarations: [], refKeys: [], disabledRefs: [] };
  }
  if (!Array.isArray(rawGroups)) {
    throw new TypeError(`${fieldPath}: 期望策略组声明数组 (Array)，实际为 ${typeof rawGroups}`);
  }

  // 1. 结构校验，并结算每个 ref 键的最终状态（最后一次出现为准）
  const entries = [];
  const finalState = new Map();
  rawGroups.forEach((entry, index) => {
    const path = `${fieldPath}[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`${path}: 策略组声明必须为普通对象`);
    }
    if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') {
      throw new TypeError(`${path}.disabled: 期望 boolean`);
    }
    if (entry.ref !== undefined && (typeof entry.ref !== 'string' || !entry.ref.trim())) {
      throw new TypeError(`${path}.ref: 期望非空字符串引用键`);
    }

    const refKey = entry.ref === undefined ? null : entry.ref.trim();
    if (refKey) {
      if (!directory[refKey]) {
        const available = Object.keys(directory).sort().join(', ');
        const aggregateRef = memberHints[refKey];
        // 聚合组成员（如 steam / epic / facebook）不单独成组：其规则目标指向聚合组，
        // 单独引用它只会得到空壳组。此处给出「应当改引哪个聚合组」的指引，而不是只报未知键。
        const hint = aggregateRef
          ? `；「${refKey}」是聚合组「${directory[aggregateRef]?.name || aggregateRef}」的成员条目，不单独成组，请改为 { ref: ${aggregateRef} }`
          : '';
        throw new Error(
          `${path}.ref: 未知内置组引用键「${refKey}」` + hint +
          (available ? `，可用键: ${available}` : '（当前无可引用的内置组）')
        );
      }
      // 关闭条目同样要校验引用键：拼错却因 disabled 被静默吞掉，属于 fail-open
      finalState.set(refKey, { disabled: entry.disabled === true, index });
    }
    entries.push({ path, entry, refKey, disabled: entry.disabled === true, index });
  });

  // 2. 按清单顺序产出；ref 条目只在「该键最后一次出现且未关闭」时进入声明清单
  const declarations = [];
  const refKeys = [];
  for (const { path, entry, refKey, disabled, index } of entries) {
    if (refKey) {
      const state = finalState.get(refKey);
      if (state.disabled || state.index !== index) continue;
    } else if (disabled) {
      continue;
    }

    const overrides = { ...entry };
    delete overrides.ref;
    delete overrides.disabled;

    // 自写声明原样进入引擎校验；ref 条目做浅合并（顶层字段整体覆写，语义直观可预测）
    const declaration = refKey ? { ...directory[refKey], ...overrides } : overrides;

    if (typeof declaration.name !== 'string' || !declaration.name.trim()) {
      throw new Error(`${path}: 策略组声明缺少 name`);
    }

    declarations.push(declaration);
    refKeys.push(refKey);
  }

  const disabledRefs = [...finalState.entries()]
    .filter(([, state]) => state.disabled)
    .map(([key]) => key);

  return { declarations, refKeys, disabledRefs };
}

/**
 * 按流量方向筛选组声明
 *
 * 方向只是「声明生效条件」，不是第二个真相源：同名组可以各写一个方向，
 * 过滤后只会剩下当前方向的那一条，不引入同名仲裁语义。
 * 缺省 `direction` 的声明双向生效；非法取值原样放行，交给 `validateGroups` fail-closed。
 *
 * @param {Array<object>} groups 归一化后的组声明
 * @param {string} direction 当前方向（split / return）
 * @returns {Array<object>} 当前方向生效的声明
 */
function filterGroupsByDirection(groups, direction) {
  if (!Array.isArray(groups)) return [];
  const active = direction === 'return' ? 'return' : 'split';
  return groups.filter(group => {
    if (!group || typeof group !== 'object') return true;
    if (group.direction === undefined) return true;
    if (group.direction !== 'split' && group.direction !== 'return') return true;
    return group.direction === active;
  });
}

module.exports = { resolveGroupDeclarations, filterGroupsByDirection };
