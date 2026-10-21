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
 * @param {Array} rawGroups 原始清单（用户配置 `groups` 字段）
 * @param {object} [options]
 * @param {Record<string, object>} [options.directory] 内置组目录（`registries.groups`）
 * @param {Record<string, string>} [options.memberHints] 聚合组成员键 → 所属聚合组 ref 键（报错时给出改引指引）
 * @param {string} [options.fieldPath='groups'] 报错时使用的字段路径前缀
 * @returns {Array<object>} 完整组声明列表（已剥离 `ref` / `disabled` 元键）
 */
function resolveGroupDeclarations(rawGroups, { directory = {}, memberHints = {}, fieldPath = 'groups' } = {}) {
  if (rawGroups === undefined || rawGroups === null) return [];
  if (!Array.isArray(rawGroups)) {
    throw new TypeError(`${fieldPath}: 期望策略组声明数组 (Array)，实际为 ${typeof rawGroups}`);
  }

  const resolved = [];
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

    // 显式关闭：连带落在其上的覆写一起忽略（声明即激活，关闭靠 disabled）
    if (entry.disabled === true) {
      if (entry.ref) {
        const refKey = entry.ref.trim();
        if (directory[refKey]) directory[refKey]._disabled = true;
      }
      return;
    }

    const overrides = { ...entry };
    delete overrides.ref;
    delete overrides.disabled;

    let declaration;
    if (entry.ref === undefined) {
      // 目录之外的完整自写声明：字段与目录条目同构，原样进入引擎校验
      declaration = overrides;
    } else {
      const refKey = entry.ref.trim();
      const base = directory[refKey];
      if (!base) {
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
      // 浅合并：每个顶层字段整体被覆写值替换（match / proxies / rules 等按整字段替换，语义直观可预测）
      declaration = { ...base, ...overrides };
      Object.defineProperty(declaration, '_ref', {
        value: refKey,
        enumerable: false,
        writable: true,
        configurable: true
      });
    }

    if (typeof declaration.name !== 'string' || !declaration.name.trim()) {
      throw new Error(`${path}: 策略组声明缺少 name`);
    }

    // 规则与组彻底分家：组只声明成员与呈现。
    // 目录条目里的 rules / providers / process 是「该组对应的分流规则」的历史载体，
    // 批次 3 起规则一律由 routing 表生成（见 README / CONFIGURATION 第 4 节），此处剥离，
    // 保证 { ref } 展开结果与手写声明都不再夹带规则字段。
    delete declaration.rules;
    delete declaration.providers;
    delete declaration.process;

    resolved.push(declaration);
  });

  return resolved;
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
