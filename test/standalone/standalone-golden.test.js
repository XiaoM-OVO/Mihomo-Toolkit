/**
 * standalone 单文件脚本全量基线（golden）回归测试
 * -----------------------------------------------------------------------------
 * 目的：standalone/src/mihomo-toolkit.js 是用户直接粘贴进客户端的交付物，
 * 不接入 src/ 的分层校验，本测试把「固定订阅样本 + 固定配置 → 最终产物」钉死，
 * 让单脚本的任何整理 / 重构都能被断言验证而非被口头保证。
 *
 * 判据：固定订阅 + 固定配置 → 最终产物逐字段一致。规则数组顺序参与比较。
 *
 * 失败时怎么办：
 *   - 若这是**有意的**行为变更：运行 `node scripts/gen-standalone-golden.js`
 *     更新基线，并在提交信息里写明「单脚本产物为什么变」；
 *   - 若不是有意变更：说明这次改动产生了漂移，属于缺陷，不要直接更新 golden 掩盖它。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { SCENARIOS, buildStandaloneOutput } = require('../fixtures/standalone-scenario');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

describe('【Standalone】单文件脚本全量基线 (standalone-golden)', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name} - 单脚本产物与 golden 基线逐字段一致`, () => {
      const goldenPath = path.join(FIXTURE_DIR, scenario.fixture);
      const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
      const actual = buildStandaloneOutput(scenario.overrides);

      assert.deepStrictEqual(
        actual,
        golden,
        `单脚本产物发生漂移（场景 ${scenario.name}）。` +
          '若为有意的行为变更，请运行 node scripts/gen-standalone-golden.js 更新基线并在提交信息中说明；' +
          '否则说明本次改动破坏了行为兼容，需要修正代码而不是更新基线。'
      );
    });
  }

  it('golden 基线必须覆盖各关键产物段（防止基线在空产物上「假绿」）', () => {
    const golden = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, SCENARIOS[0].fixture), 'utf8')
    );
    for (const key of ['proxies', 'proxy-groups', 'rules', 'rule-providers', 'tun', 'dns', 'sniffer']) {
      assert.ok(Array.isArray(golden[key]) || (golden[key] && typeof golden[key] === 'object'), `基线缺少产物段「${key}」`);
    }
    assert.ok(golden.proxies.length > 0, '基线节点样本不得为空（否则清洗链路未被覆盖）');
    assert.ok(golden['proxy-groups'].length > 0, '基线策略组不得为空');
    assert.ok(golden.rules.length > 0, '基线分流规则不得为空');
    assert.ok(Object.keys(golden['rule-providers']).length > 0, '基线 Rule-Provider 不得为空');
    for (const key of ['ipv6', 'profile', 'unified-delay', 'tcp-concurrent', 'keep-alive-interval', 'find-process-mode']) {
      assert.ok(golden[key] !== undefined, `基线缺少内核覆写字段「${key}」`);
    }
  });
});
