/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 简繁中文全链路四路同步器 (Chinese Converter Sync)
 * -----------------------------------------------------------------------------
 * 职责：
 * 保证节点名、策略组名、组内引用（proxies/use）与路由规则（rules）中的组名引用四路严格一致。
 */

let chineseConvert = {
  toSimplified: (t) => t,
  toTraditional: (t) => t,
  deepConvertStrings: (o) => o,
  isAvailable: () => false
};
try {
  chineseConvert = require('./chinese-convert');
} catch {}

/**
 * 执行全链路四路同步转换
 * @param {object} outputData 包含 proxies, proxy-groups, rules 的完整配置
 * @param {object} userConfig 用户配置
 * @param {object} [logger]
 * @returns {object} 同步后的配置对象
 */
function syncChineseConvert(outputData, userConfig = {}, logger) {
  const isOpenccReady = !!(chineseConvert.isAvailable && chineseConvert.isAvailable());
  const canConvert = !!(userConfig.enableChineseConvert && isOpenccReady);
  if (!canConvert || !outputData) return outputData;

  const modeLabel = userConfig.chineseConvertMode === 's2t' ? '繁体' : '简体';
  if (logger) logger.info(`🔤 简繁转换: 输出 ${modeLabel}`);

  const convertFn = userConfig.chineseConvertMode === 's2t'
    ? chineseConvert.toTraditional
    : chineseConvert.toSimplified;

  const nodeRenameMap = {};
  const groupRenameMap = {};

  // 1. 转换节点名
  if (Array.isArray(outputData.proxies)) {
    for (const proxy of outputData.proxies) {
      if (!proxy || !proxy.name) continue;
      const oldName = proxy.name;
      proxy.name = convertFn(proxy.name);
      if (oldName !== proxy.name) nodeRenameMap[oldName] = proxy.name;
    }
  }

  // 2. 转换策略组名 + 组内 proxies / use 引用
  if (Array.isArray(outputData['proxy-groups'])) {
    for (const group of outputData['proxy-groups']) {
      if (!group || !group.name) continue;
      const oldName = group.name;
      group.name = convertFn(group.name);
      if (oldName !== group.name) groupRenameMap[oldName] = group.name;
      if (Array.isArray(group.proxies)) {
        group.proxies = group.proxies.map(p => nodeRenameMap[p] || groupRenameMap[p] || convertFn(p));
      }
      if (Array.isArray(group.use)) {
        group.use = group.use.map(u => groupRenameMap[u] || convertFn(u));
      }
    }
  }

  // 3. 转换 rules 中的策略组名引用（精准限定在 TARGET 字段，杜绝误伤规则类型、参数或域名关键字）
  if (Array.isArray(outputData.rules) && Object.keys(groupRenameMap).length > 0) {
    outputData.rules = outputData.rules.map(rule => replaceRuleTarget(rule, groupRenameMap));
  }

  // 4. 转换 rule-providers 中的代理组引用
  if (outputData['rule-providers'] && typeof outputData['rule-providers'] === 'object' && Object.keys(groupRenameMap).length > 0) {
    Object.values(outputData['rule-providers']).forEach(rp => {
      if (rp && rp.proxy && groupRenameMap[rp.proxy]) {
        rp.proxy = groupRenameMap[rp.proxy];
      }
    });
  }

  return outputData;
}

/**
 * 括号感知的分词器：按逗号切分规则字段，但忽略括号内部逗号（如 AND/OR 条件嵌套）
 * @param {string} rule
 * @returns {string[]}
 */
function splitRuleTokens(rule) {
  const tokens = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < rule.length; i++) {
    const ch = rule[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  tokens.push(current);
  return tokens;
}

/**
 * 路由规则 TARGET 字段精准替换：
 * - MATCH,TARGET: TARGET 位于第 2 字段（索引 1）
 * - TYPE,PAYLOAD,TARGET[,OPTIONS...]: TARGET 位于第 3 字段（索引 2）
 * 严格杜绝盲目切分逗号全量替换导致的规则类型、参数或域名关键字误伤。
 * @param {string} rule 规则字符串
 * @param {Record<string, string>} renameMap 旧名 -> 新名 映射表
 * @returns {string} 替换后的规则
 */
function replaceRuleTarget(rule, renameMap) {
  if (typeof rule !== 'string' || !renameMap) return rule;
  const tokens = splitRuleTokens(rule);
  if (tokens.length < 2) return rule;

  const type = tokens[0].trim().toUpperCase();
  const targetIndex = type === 'MATCH' ? 1 : (tokens.length >= 3 ? 2 : -1);
  if (targetIndex === -1 || targetIndex >= tokens.length) return rule;

  const rawToken = tokens[targetIndex];
  const trimmed = rawToken.trim();
  if (renameMap[trimmed] && renameMap[trimmed] !== trimmed) {
    tokens[targetIndex] = rawToken.replace(trimmed, renameMap[trimmed]);
    return tokens.join(',');
  }
  return rule;
}

module.exports = {
  chineseConvert,
  syncChineseConvert,
  splitRuleTokens,
  replaceRuleTarget
};

