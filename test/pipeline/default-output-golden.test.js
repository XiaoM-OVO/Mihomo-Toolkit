/**
 * 默认产物全量基线（golden）回归测试
 * -----------------------------------------------------------------------------
 * 目的：把「今天的默认输出」钉死，让任何重构都能被验证而非被口头保证。
 *
 * 判据：固定节点样本 + 固定配置 → 最终产物（proxies / proxy-groups / rules /
 * rule-providers / 内核覆写）逐字段一致。规则数组的顺序参与比较（顺序即优先级语义）。
 *
 * 失败时怎么办：
 *   - 若这是**有意的**行为变更：运行 `node scripts/gen-default-output-golden.js`
 *     更新基线，并在提交信息里写明「默认产物为什么变」；
 *   - 若不是有意变更：说明这次重构产生了漂移，属于缺陷，不要直接更新 golden 掩盖它。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { SCENARIOS, buildDefaultOutput } = require('../fixtures/default-output.scenario');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

describe('【Pipeline】默认产物全量基线 (default-output-golden)', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name} - 默认产物与 golden 基线逐字段一致`, () => {
      const goldenPath = path.join(FIXTURE_DIR, scenario.fixture);
      const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
      const actual = buildDefaultOutput(scenario.overrides);

      assert.deepStrictEqual(
        actual,
        golden,
        `默认产物发生漂移（场景 ${scenario.name}）。` +
          '若为有意的行为变更，请运行 node scripts/gen-default-output-golden.js 更新基线并在提交信息中说明；' +
          '否则说明本次重构破坏了向后兼容，需要修正代码而不是更新基线。'
      );
    });
  }

  it('golden 基线必须覆盖各关键产物段（防止基线在空产物上「假绿」）', () => {
    const golden = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, SCENARIOS[0].fixture), 'utf8')
    );
    for (const key of ['proxies', 'proxy-groups', 'rules', 'rule-providers', 'dns', 'tun', 'sniffer']) {
      assert.ok(Array.isArray(golden[key]) || (golden[key] && typeof golden[key] === 'object'), `基线缺少产物段「${key}」`);
    }
    assert.ok(golden.proxies.length > 0, '基线节点样本不得为空（否则清洗链路未被覆盖）');
    assert.ok(golden['proxy-groups'].length > 0, '基线策略组不得为空');
    assert.ok(golden.rules.length > 0, '基线分流规则不得为空');
    assert.ok(Object.keys(golden['rule-providers']).length > 0, '基线 Rule-Provider 不得为空');
  });
});
