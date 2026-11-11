/**
 * CLI 诊断模式：--dry-run 仅校验配置语法、订阅连通性与 DNS 不变式，绝不写入磁盘产物
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

describe('CLI 一次性构建（不参与退避）', () => {
  it('订阅失败只报失败原因，不出现退避 / 剩余 / 第 N 次失败等明细', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      const outPath = path.join(tmpDir, 'out.yaml');
      // 私网地址由 SSRF 预检同步拒绝，不产生任何真实网络 IO
      fs.writeFileSync(cfgPath, yaml.stringify({
        subscriptions: [{ url: 'http://10.0.0.1/sub', tag: 'A', retry: 0 }],
        minorNodeThreshold: 1
      }));

      const res = runCli(['-c', cfgPath, '-o', outPath, '--log-level', 'info']);
      assert.equal(res.status, 0, `stderr=${res.stderr}`);
      const output = res.stdout;
      assert.ok(output.includes('拉取失败'), `应如实报告拉取失败：${output}`);
      assert.equal(output.includes('退避'), false, `一次性构建不得展示退避：${output}`);
      assert.equal(output.includes('第 1 次失败'), false, `一次性构建不得展示失败次数：${output}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('-r 另存的审计报告与 -m report 使用同一标准结构', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      const outPath = path.join(tmpDir, 'out.yaml');
      const extraPath = path.join(tmpDir, 'extra.json');
      const modePath = path.join(tmpDir, 'mode.json');
      writeInlineNodeConfig(cfgPath);

      const cfgBuild = runCli(['-c', cfgPath, '-o', outPath, '-r', extraPath]);
      assert.equal(cfgBuild.status, 0, `stderr=${cfgBuild.stderr}`);
      const extra = JSON.parse(fs.readFileSync(extraPath, 'utf-8'));
      assert.equal(extra.service, 'mihomo-toolkit');
      assert.equal(extra.summary.totalInput, 1);
      assert.ok(Array.isArray(extra.invariantViolations));

      const reportBuild = runCli(['-c', cfgPath, '-m', 'report', '-o', modePath]);
      assert.equal(reportBuild.status, 0, `stderr=${reportBuild.stderr}`);
      const modeReport = JSON.parse(fs.readFileSync(modePath, 'utf-8'));
      assert.deepEqual(
        Object.keys(extra).sort(),
        ['invariantViolations', 'service', 'stats', 'summary', 'timestamp', 'version']
      );
      assert.deepEqual(Object.keys(extra).sort(), Object.keys(modeReport).sort());
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('-m report 同时 -r 时两份报告都会落盘', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      const mainPath = path.join(tmpDir, 'main.json');
      const extraPath = path.join(tmpDir, 'extra.json');
      writeInlineNodeConfig(cfgPath);

      const r = runCli(['-c', cfgPath, '-m', 'report', '-o', mainPath, '-r', extraPath]);
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      const main = JSON.parse(fs.readFileSync(mainPath, 'utf-8'));
      const extra = JSON.parse(fs.readFileSync(extraPath, 'utf-8'));
      assert.equal(extra.summary.totalInput, 1);
      assert.deepEqual(Object.keys(extra).sort(), Object.keys(main).sort());
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('非法 YAML 配置的报错包含文件名与解析失败前缀', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'bad.yaml');
      fs.writeFileSync(cfgPath, 'subscriptions: [\n  - name: x\n');
      const r = runCli(['-c', cfgPath]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr + r.stdout, /配置文件加载失败/);
      assert.match(r.stderr + r.stdout, /bad\.yaml/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('CLI 诊断模式 (--dry-run)', () => {
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

  it('--dry-run：订阅全部不可用时以退出码 1 失败关闭', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      const outPath = path.join(tmpDir, 'out.yaml');
      // 私网地址由 SSRF 预检同步拒绝，可用订阅数为 0
      fs.writeFileSync(cfgPath, yaml.stringify({
        subscriptions: [{ url: 'http://10.0.0.1/sub', tag: 'A', retry: 0 }]
      }));

      const res = runCli(['--dry-run', '-c', cfgPath, '-o', outPath, '--log-level', 'info']);
      assert.equal(res.status, 1, `全部订阅不可用应失败关闭，stdout=${res.stdout}`);
      assert.ok(res.stdout.includes('全部订阅不可用'), `stdout=${res.stdout}`);
      assert.equal(res.stdout.includes('诊断通过'), false, `不得同时输出成功结论：${res.stdout}`);
      assert.ok(res.stderr.includes('诊断未通过'), `stderr=${res.stderr}`);
      assert.equal(fs.existsSync(outPath), false, '诊断模式不得写入输出文件');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('--explain：订阅全部不可用只提示不失败关闭', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(cfgPath, yaml.stringify({
        subscriptions: [{ url: 'http://10.0.0.1/sub', tag: 'A', retry: 0 }]
      }));

      const res = runCli(['--explain', '-c', cfgPath, '--log-level', 'info']);
      assert.equal(res.status, 0, `--explain 不应失败关闭，stderr=${res.stderr}`);
      assert.ok(res.stdout.includes('全部订阅不可用'), `stdout=${res.stdout}`);
      assert.equal(res.stderr.includes('诊断未通过'), false, `stderr=${res.stderr}`);
      assert.equal(res.stdout.includes('诊断通过'), false, `不得输出成功结论：${res.stdout}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

});

describe('CLI 零订阅构建契约', () => {
  it('零订阅等价于零节点：产出无节点分流配置，诊断模式结论一致', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'empty.yaml');
      const outPath = path.join(tmpDir, 'out.yaml');
      fs.writeFileSync(cfgPath, yaml.stringify({ subscriptions: [] }));

      // --explain 只输出摘要，不因「全部订阅不可用」失败关闭
      const explain = runCli(['--explain', '-c', cfgPath, '--log-level', 'info']);
      assert.equal(explain.status, 0, `--explain 不应失败关闭，stderr=${explain.stderr}`);
      assert.ok(explain.stdout.includes('全部订阅不可用'), `stdout=${explain.stdout}`);

      // --dry-run 同属诊断模式，但维持失败关闭语义
      const dry = runCli(['--dry-run', '-c', cfgPath, '-o', outPath, '--log-level', 'info']);
      assert.equal(dry.status, 1, `零订阅应失败关闭，stdout=${dry.stdout}`);
      assert.equal(fs.existsSync(outPath), false, '诊断模式不得写入输出文件');

      // 常规构建与「有订阅但 0 节点」保持一致：产出无节点分流配置
      const build = runCli(['-c', cfgPath, '-o', outPath, '--log-level', 'info']);
      assert.equal(build.status, 0, `零订阅应正常产出无节点分流配置，stderr=${build.stderr}`);
      assert.ok(build.stdout.includes('无节点分流模式'), `stdout=${build.stdout}`);
      assert.equal(fs.existsSync(outPath), true, '常规构建应写出产物文件');
      assert.match(fs.readFileSync(outPath, 'utf8'), /^proxies: \[\]$/m, '产物应为空代理列表');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('CLI 参数收窄', () => {
  it('已移除的 --validate / -q / --quiet 按未知选项拒绝', () => {
    for (const flag of ['--validate', '-q', '--quiet']) {
      const res = runCli([flag]);
      assert.equal(res.status, 1, `${flag} 应被拒绝，stderr=${res.stderr}`);
      assert.ok(res.stderr.includes('unknown option'), `${flag} 应报未知选项：${res.stderr}`);
    }
  });

  it('-s 关闭全部日志输出，但不影响产物落盘', () => {
    const tmpDir = makeTmpDir();
    try {
      const cfgPath = path.join(tmpDir, 'config.yaml');
      const outPath = path.join(tmpDir, 'out.yaml');
      writeInlineNodeConfig(cfgPath);

      const res = runCli(['-s', '-c', cfgPath, '-o', outPath]);
      assert.equal(res.status, 0, `stderr=${res.stderr}`);
      assert.equal(res.stdout.trim(), '', `-s 不应输出日志：${res.stdout}`);
      assert.equal(fs.existsSync(outPath), true, '-s 仅静音日志，产物仍应落盘');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
