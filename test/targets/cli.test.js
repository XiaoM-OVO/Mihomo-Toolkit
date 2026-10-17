/**
 * CLI 诊断模式：--dry-run / --validate 仅校验配置语法、订阅连通性与 DNS 不变式，绝不写入磁盘产物
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-cli-'));
}

// 用内联直接节点作为订阅源，避免任何真实出网
function writeInlineNodeConfig(filePath) {
  fs.writeFileSync(filePath, yaml.stringify({
    subscriptions: [
      { name: 'HK-01', type: 'ss', server: '198.51.100.1', port: 443, cipher: 'aes-256-gcm', password: 'p' }
    ]
  }));
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' }
  });
}

describe('CLI 诊断模式 (--dry-run / --validate)', () => {
  it('--dry-run 通过校验且绝不落盘；对照组（无该标志）正常写出产物', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      const dryOutPath = path.join(tmpDir, 'dry.out.yaml');
      const realOutPath = path.join(tmpDir, 'real.out.yaml');
      writeInlineNodeConfig(cfgPath);

      const dry = runCli(['--dry-run', '-c', cfgPath, '-o', dryOutPath, '--log-level', 'info']);
      assert.equal(dry.status, 0, `诊断模式退出码应为 0，stderr=${dry.stderr}`);
      assert.ok(dry.stdout.includes('诊断模式'), `stdout 缺少诊断输出：${dry.stdout}`);
      assert.equal(fs.existsSync(dryOutPath), false, '诊断模式不得写入输出文件');

      // 对照组：同参数去掉 --dry-run，应正常写出产物（证明“不落盘”确由该标志生效）
      const real = runCli(['-c', cfgPath, '-o', realOutPath, '--log-level', 'info']);
      assert.equal(real.status, 0, `常规构建退出码应为 0，stderr=${real.stderr}`);
      assert.equal(fs.existsSync(realOutPath), true, '常规构建应写出产物文件');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('--validate 与 --dry-run 等价，同样不落盘', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      const outPath = path.join(tmpDir, 'out.yaml');
      writeInlineNodeConfig(cfgPath);

      const res = runCli(['--validate', '-c', cfgPath, '-o', outPath, '--log-level', 'info']);
      assert.equal(res.status, 0, `退出码应为 0，stderr=${res.stderr}`);
      assert.ok(res.stdout.includes('诊断模式'));
      assert.equal(fs.existsSync(outPath), false, '--validate 不得写入输出文件');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
