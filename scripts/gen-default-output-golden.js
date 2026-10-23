/**
 * 重新生成「默认产物」golden 基线
 * -----------------------------------------------------------------------------
 * 用法：node scripts/gen-default-output-golden.js
 *
 * ⚠️ 只在「确认默认输出的变化是有意的」时运行。
 *    golden 的变化必须与代码变更一起提交，并在提交信息里说明默认产物为什么变。
 *    如果只是想让测试变绿就重跑本脚本，等于把回归守卫关掉。
 */

const fs = require('node:fs');
const path = require('node:path');

const { SCENARIOS, buildDefaultOutput } = require('../test/fixtures/default-output.scenario');

const fixtureDir = path.join(__dirname, '..', 'test', 'fixtures');

for (const scenario of SCENARIOS) {
  const target = path.join(fixtureDir, scenario.fixture);
  const output = buildDefaultOutput(scenario.overrides);
  fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`✅ 已写入 ${path.relative(process.cwd(), target)}（场景 ${scenario.name}）`);
}
