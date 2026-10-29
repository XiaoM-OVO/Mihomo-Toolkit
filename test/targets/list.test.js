/**
 * `list` 子命令：只读反射可引用对象，人类可读 + `--json` 双输出契约
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('node:child_process');
const yaml = require('yaml');

const CLI_PATH = path.join(__dirname, '..', '..', 'src', 'targets', 'cli.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-list-'));
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' }
  });
}

function runJson(args) {
  const res = runCli(args);
  assert.equal(res.status, 0, `list 退出码应为 0，stderr=${res.stderr}`);
  return JSON.parse(res.stdout);
}

function findItem(items, field, value) {
  return items.find(item => item[field] === value);
}

describe('list 子命令', () => {
  it('refs：区分聚合组与可独立引用，且只输出用户语义字段', () => {
    const data = runJson(['list', 'refs', '--json']);
    assert.equal(data.domain, 'refs');
    assert.ok(data.count > 0);
    assert.equal(data.items.length, data.count);

    const aggregate = findItem(data.items, 'ref', 'game-service');
    assert.ok(aggregate, '应列出游戏聚合组');
    assert.equal(aggregate.kind, 'aggregate');

    const standalone = findItem(data.items, 'ref', 'chatgpt');
    assert.ok(standalone, '应列出可独立引用的服务组');
    assert.equal(standalone.kind, 'standalone');

    // 内部字段名不得暴露成用户 API
    for (const item of data.items) {
      assert.deepEqual(
        Object.keys(item).sort(),
        ['hidden', 'kind', 'name', 'ref', 'status', 'type']
      );
    }
  });

  it('pools：未启用 / 隐藏 / 恒在三种状态可区分', () => {
    const data = runJson(['list', 'pools', '--json']);
    const inactive = findItem(data.items, 'pool', '家宽优选');
    assert.equal(inactive.status, 'inactive');
    assert.equal(inactive.gate, 'enableIsolation');
    assert.equal(inactive.match, null);

    const alwaysHidden = findItem(data.items, 'pool', '低倍率节点');
    assert.equal(alwaysHidden.status, 'active');
    assert.equal(alwaysHidden.activation, 'always');
    assert.equal(alwaysHidden.hidden, true);
    assert.equal(alwaysHidden.gate, null);
  });

  it('pools / refs：按 -c 配置投影（enableIsolation、自定义池、disabled）', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(cfgPath, yaml.stringify({
        enableIsolation: true,
        pools: [{ name: '低延迟节点', match: { region: ['hk', 'jp'] } }],
        groups: [{ ref: 'chatgpt', disabled: true }]
      }));

      const pools = runJson(['list', 'pools', '--json', '-c', cfgPath]);
      assert.equal(pools.configLoaded, true);
      assert.equal(findItem(pools.items, 'pool', '家宽优选').status, 'active');

      const custom = findItem(pools.items, 'pool', '低延迟节点');
      assert.ok(custom, '应列出用户自定义池');
      assert.equal(custom.builtin, false);
      assert.equal(custom.activation, 'onDemand');

      const refs = runJson(['list', 'refs', '--json', '-c', cfgPath]);
      assert.equal(findItem(refs.items, 'ref', 'chatgpt').status, 'disabled');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('services：聚合成员标注不可单独 ref，并给出应改引的聚合组', () => {
    const data = runJson(['list', 'services', '--json']);
    const steam = findItem(data.items, 'service', 'steam');
    assert.equal(steam.refStatus, 'aggregate-member');
    assert.equal(steam.ref, 'game-service');
    assert.equal(steam.memberOf, '游戏服务');

    const chatgpt = findItem(data.items, 'service', 'chatgpt');
    assert.equal(chatgpt.refStatus, 'direct');
    assert.equal(chatgpt.ref, 'chatgpt');
    assert.equal(chatgpt.memberOf, null);
  });

  it('macros / presets：静态域无需配置文件，人类可读输出正常', () => {
    const macros = runJson(['list', 'macros', '--json']);
    assert.equal(macros.configLoaded, false);
    const matched = findItem(macros.items, 'macro', '@matchednodes');
    assert.ok(matched.aliases.includes('@matched'));
    assert.ok(matched.aliases.includes('@nodes'));

    const presets = runJson(['list', 'presets', '--json']);
    assert.ok(findItem(presets.items, 'preset', 'final'));

    const human = runCli(['list', 'macros']);
    assert.equal(human.status, 0);
    assert.ok(human.stdout.includes('动态拓扑宏'));
    assert.ok(human.stdout.includes('@matchednodes'));
  });

  it('缺少或未知域时给出可选域清单并非零退出', () => {
    const missing = runCli(['list']);
    assert.equal(missing.status, 1);
    assert.ok(missing.stderr.includes('refs / presets / macros / pools / services'));

    const unknown = runCli(['list', 'nope']);
    assert.equal(unknown.status, 1);
    assert.ok(unknown.stderr.includes('未知 list 域「nope」'));
  });
});
