/**
 * 节点重命名与模板渲染
 *
 * 处理变量替换、模板字符串渲染、多余标点与空括号清洗。
 */

const DEFAULT_SEPARATORS = ["|", "·", "-", "/", "\\", "_", "•", "—", ":", "："];

/**
 * 构建用于清理多余/连续分隔符的正则表达式
 * @param {Array<string>} [separators]
 */
function createSeparatorCleaners(separators = DEFAULT_SEPARATORS) {
  const charSeps = [];
  const wordSeps = [];

  separators.forEach(s => {
    const esc = String(s).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    if (s.length === 1) charSeps.push(esc);
    else wordSeps.push(esc);
  });

  const charClass = charSeps.length > 0 ? `[${charSeps.join('')}]` : '';
  const wordStr = wordSeps.join('|');
  const combined = wordSeps.length > 0
    ? (charClass ? `(?:${charClass}|${wordStr})` : `(?:${wordStr})`)
    : charClass;

  const regAdjacent = combined ? new RegExp(`${combined}(?=\\s*${combined})`, 'g') : null;
  const regEdge = combined ? new RegExp(`^(?:\\s|${combined})+|(?:\\s|${combined})+$`, 'g') : null;

  return { regAdjacent, regEdge };
}

/**
 * 渲染节点名称模板
 * @param {string|Function} template 字符串模板或自定义函数 (vars, proxy) => string
 * @param {object} vars 模板变量
 * @param {object} proxy 原始节点对象
 * @param {object} [cleaners] 正则清理器
 * @returns {string} 渲染并清理后的新节点名称
 */
function renderTemplate(template, vars, proxy, cleaners) {
  if (typeof template === 'function') {
    return template(vars, proxy);
  }

  if (typeof template !== 'string') {
    return proxy?.name || '';
  }

  let finalName = template.replace(
    /{(airport|icon|region|index|features|protocol|city|line|in|multi|transport|ip_stack)}/g,
    (match, key) => vars[key] || ''
  );

  const { regAdjacent, regEdge } = cleaners || createSeparatorCleaners();

  if (regAdjacent) {
    finalName = finalName.replace(regAdjacent, '');
  }
  if (regEdge) {
    finalName = finalName.replace(regEdge, '');
  }

  // 清除空方括号、空圆括号与多余连续空格
  finalName = finalName.replace(/\[\s*\]|\(\s*\)/g, '');
  finalName = finalName.replace(/\s{2,}/g, ' ').trim();

  return finalName;
}

module.exports = {
  DEFAULT_SEPARATORS,
  createSeparatorCleaners,
  renderTemplate
};
