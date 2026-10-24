/**
 * -----------------------------------------------------------------------------
 * 默认产物基线场景（golden 生成器与回归测试共用的单一场景定义）
 * -----------------------------------------------------------------------------
 * 这里有且只有一份「固定节点样本 + 固定用户配置」：
 *   - 生成器 scripts/gen-default-output-golden.js 用它写出 baseline；
 *   - 回归测试 test/pipeline/default-output-golden.test.js 用它重建产物并比对。
 *
 * 之所以把场景单独抽成模块，而不是各自在脚本/测试里抄一份节点清单：
 * 两边一旦漂移，golden 就会「自己和自己对不上」，基线守卫直接失效。
 *
 * ⚠️ 修改本文件的节点样本或场景配置 = 修改基线语义。
 *    必须同时重新生成 golden，并在提交信息中说明「默认产物为何变化」。
 */

const { runStrategyPipeline } = require('../../src/pipeline/strategy');

/**
 * 固定节点样本：覆盖地区组、特征池（游戏 / 家宽）与重命名、打标路径。
 * 节点名刻意保留国旗与特征 Emoji，确保清洗、地区识别与特征打标链路都被基线覆盖。
 */
const NODES = Object.freeze([
  { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
  { name: '🇯🇵 日本 01', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' },
  { name: '🇺🇸 美国 01', type: 'ss', server: 'us1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p3' },
  { name: '🇸🇬 新加坡 01', type: 'ss', server: 'sg1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p4' },
  { name: '🎮 游戏专线 01', type: 'ss', server: 'game1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p5' },
  { name: '🏠 家宽 香港 01', type: 'ss', server: 'resi1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p6' }
]);

/**
 * 基线场景清单。
 * - `default`：出厂默认配置（不带任何用户覆盖），守卫「默认输出零漂移」；
 * - `social-enabled`：在默认表上插入社交整段，守卫「一服务一组」这条分叉路径。
 */
const SOCIAL_ROUTING = Object.freeze([
  { preset: 'subscription' },
  { service: 'ad-block' },
  { preset: 'ai' },
  { preset: 'streaming' },
  { preset: 'social' },
  { preset: 'game' },
  { preset: 'dev' },
  { service: 'telegram' },
  { preset: 'system' },
  { preset: 'bt' },
  { preset: 'download' },
  { preset: 'domestic' },
  { preset: 'final' }
]);

const SCENARIOS = Object.freeze([
  {
    name: 'default',
    fixture: 'default-output.golden.json',
    overrides: {}
  },
  {
    name: 'social-enabled',
    fixture: 'default-output.social-enabled.golden.json',
    overrides: { routing: SOCIAL_ROUTING }
  }
]);

/**
 * 递归排序对象键（数组保持原序：规则数组的顺序即优先级语义，不能被排序抹掉）。
 * @param {*} value
 * @returns {*}
 */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = stable(value[key]);
    return sorted;
  }
  return value;
}

/**
 * 用固定样本重建默认产物（已归一化为稳定键序，可直接与 golden 做深比较）。
 * @param {object} [overrides={}] 场景级的用户配置覆盖
 * @returns {object} 最终产物（proxies / proxy-groups / rules / rule-providers / 内核覆写等）
 */
function buildDefaultOutput(overrides = {}) {
  const rawConfig = { proxies: JSON.parse(JSON.stringify(NODES)), ...overrides };
  return stable(runStrategyPipeline(rawConfig, overrides));
}

module.exports = {
  NODES,
  SCENARIOS,
  buildDefaultOutput
};
