/**
 * standalone 单文件脚本 golden 基线生成器
 * -----------------------------------------------------------------------------
 * 仅在「有意的行为变更」时运行：
 *   node scripts/gen-standalone-golden.js
 * 生成后请在提交信息里写明产物为什么变化；若不属于有意变更，说明这是漂移缺陷。
 */

const fs = require('node:fs');
const path = require('node:path');

const { SCENARIOS, buildStandaloneOutput } = require('../test/fixtures/standalone-scenario');

const FIXTURE_DIR = path.join(__dirname, '..', 'test', 'fixtures');

for (const scenario of SCENARIOS) {
  const target = path.join(FIXTURE_DIR, scenario.fixture);
  const output = buildStandaloneOutput(scenario.overrides);
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(
    `✅ ${scenario.name} -> test/fixtures/${scenario.fixture}` +
      `（策略组 ${output['proxy-groups'].length} / 规则 ${output.rules.length} / 节点 ${output.proxies.length}）`
  );
}
