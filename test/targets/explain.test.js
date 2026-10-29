/**
 * `--explain` 激活摘要：只读、不落盘，覆盖激活 / 跳过 / 剪枝 / 为空四态
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-explain-'));
}

// 内联直接节点作为订阅源，避免任何真实出网
function writeConfig(filePath) {
  fs.writeFileSync(filePath, yaml.stringify({
    subscriptions: [
      { name: 'HK-01', type: 'ss', server: '198.51.100.1', port: 443, cipher: 'aes-256-gcm', password: 'p' }
    ],
    // 隔离池开启后家宽 / 高倍率 / 实验池均无成员：走「已启用但暂无成员」的合法跳过路径
    enableIsolation: true,
    pools: [
      // 恒在自定义池：验证「有成员 → 建组」的正向状态与成员数
      { name: '恒在测试池', match: { region: ['hk'] }, group: 'always' }
    ],
    routing: [
      // 同一槽位的两条声明：前者被后者关闭，用来验证「跳过」原因可区分
      { service: 'chatgpt' },
      { service: 'chatgpt', disabled: true },
      { preset: 'final' }
    ]
  }));
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' }
  });
}

function findRecord(records, predicate) {
  return records.find(predicate);
}

describe('CLI --explain 激活摘要', () => {
  it('--explain --json：输出固定契约且绝不落盘', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      const outPath = path.join(tmpDir, 'out.yaml');
      writeConfig(cfgPath);

      const res = runCli(['--explain', '--json', '-c', cfgPath, '-o', outPath]);
      assert.equal(res.status, 0, `退出码应为 0，stderr=${res.stderr}`);
      assert.equal(fs.existsSync(outPath), false, '--explain 不得写入任何磁盘产物');

      // stdout 必须是纯 JSON（日志不得混入）
      const payload = JSON.parse(res.stdout);
      const { version, counts, records } = payload;
      assert.equal(version, 1);
      assert.ok(Array.isArray(records) && records.length > 0);
      assert.equal(counts.total, records.length);
      assert.equal(
        Object.values(counts.byStatus).reduce((sum, n) => sum + n, 0),
        records.length
      );
      for (const record of records) {
        assert.deepEqual(
          Object.keys(record).filter(key => !['id', 'kind', 'status', 'code', 'detail', 'members'].includes(key)),
          [],
          `记录出现未登记字段: ${JSON.stringify(record)}`
        );
        assert.ok(['group', 'rule', 'pool', 'provider'].includes(record.kind));
        assert.ok(['active', 'skipped', 'pruned', 'empty'].includes(record.status));
      }

      // 规则：同键槽位被关闭 → 跳过，原因码区分「disabled」与「superseded」
      const skippedRules = records.filter(r => r.kind === 'rule' && r.id === 'service:chatgpt');
      const codes = skippedRules.map(r => r.code).sort();
      assert.deepEqual(codes, ['disabled', 'superseded']);
      assert.ok(skippedRules.every(r => r.status === 'skipped'));

      // 池：已启用但暂无成员必须可见，不得静默
      const emptyPool = findRecord(records, r => r.kind === 'pool' && r.id === '家宽优选');
      assert.ok(emptyPool, '应记录家宽优选池状态');
      assert.equal(emptyPool.status, 'empty');
      assert.equal(emptyPool.code, 'no-members');
      assert.ok(emptyPool.detail.includes('已启用但暂无成员'));

      // 池：有成员的恒在池在建组后应带成员数
      const activePool = findRecord(records, r => r.kind === 'pool' && r.id === '恒在测试池');
      assert.ok(activePool, '应记录恒在测试池状态');
      assert.equal(activePool.status, 'active');
      assert.equal(activePool.code, 'materialized');
      assert.ok(activePool.members >= 1);

      // 剪枝：未被引用的规则集提供者应逐条可见
      const prunedProvider = findRecord(records, r => r.kind === 'provider' && r.status === 'pruned');
      assert.ok(prunedProvider, '应记录被清理的规则集提供者');
      assert.equal(prunedProvider.code, 'unused');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('--explain 人类可读摘要：分组呈现，且与 logLevel 解耦（--silent 下仍输出）', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      const outPath = path.join(tmpDir, 'out.yaml');
      writeConfig(cfgPath);

      const res = runCli(['--explain', '-c', cfgPath, '-o', outPath, '--silent']);
      assert.equal(res.status, 0, `退出码应为 0，stderr=${res.stderr}`);
      assert.equal(fs.existsSync(outPath), false, '--explain 不得写入任何磁盘产物');
      assert.ok(res.stdout.includes('激活摘要'), `stdout 缺少摘要标题：${res.stdout}`);
      assert.ok(res.stdout.includes('已启用但暂无成员'));
      assert.ok(res.stdout.includes('跳过'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('兼容性：--explain 仅支持 config 模式，--json 必须与 --explain 搭配', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      writeConfig(cfgPath);

      const wrongMode = runCli(['--explain', '-m', 'nodes', '-c', cfgPath]);
      assert.notEqual(wrongMode.status, 0);
      assert.ok(wrongMode.stderr.includes('仅支持 config'), `stderr=${wrongMode.stderr}`);

      const wrongJson = runCli(['--json', '-c', cfgPath]);
      assert.notEqual(wrongJson.status, 0);
      assert.ok(wrongJson.stderr.includes('--json 仅与 --explain'), `stderr=${wrongJson.stderr}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
