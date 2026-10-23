/**
 * include 全链路一致性 (Include End-to-End)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { buildProfile } = require('../../src/index.js');
const { expandIncludes } = require('../../src/config/include.js');
const { resolveConfig } = require('../../src/config');

const CLI_PATH = path.join(__dirname, '..', '..', 'src', 'targets', 'cli.js');

/** 一个可内联解析、无需联网的合法订阅节点 */
const INLINE_URI = 'vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01';

describe('【Pipeline】配置片段展开与链路一致性 (include-pipeline)', () => {
  it('buildProfile - 入口兜底展开 include：subscriptions 经由片段提供', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-inc-engine-'));
    try {
      const frag = path.join(dir, 'fragment.yaml');
      fs.writeFileSync(
        frag,
        `minorNodeThreshold: 1\nsubscriptions:\n  - uri: "${INLINE_URI}"\n    tag: FromFragment\n`
      );

      const { yamlStr } = await buildProfile({ include: [frag] }, { mode: 'nodes', noCache: true });
      assert.ok(yamlStr.includes('香港'), '片段中的 subscriptions 未被 engine 消费并产出节点');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cli - CLI 装载现场展开 include：subscriptions 与 output 均可来自片段', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-inc-cli-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'fragment.yaml'),
        `minorNodeThreshold: 1\noutput: "custom-nodes.yaml"\nsubscriptions:\n  - uri: "${INLINE_URI}"\n    tag: FromFragment\n`
      );
      const main = path.join(dir, 'config.yaml');
      fs.writeFileSync(main, 'include: ["./fragment.yaml"]\n');

      execFileSync(process.execPath, [CLI_PATH, '-c', main, '-m', 'nodes', '--silent'], {
        cwd: dir,
        encoding: 'utf-8'
      });

      const customOut = path.join(dir, 'custom-nodes.yaml');
      assert.ok(fs.existsSync(customOut), '片段提供的 output 未被 CLI 采纳');
      assert.ok(fs.readFileSync(customOut, 'utf-8').includes('香港'), '片段中的 subscriptions 未驱动产出节点');
      assert.ok(!fs.existsSync(path.join(dir, 'nodes.yaml')), '不应回落到默认输出路径');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('expandIncludes - 展开幂等性：二次展开不重复读盘，即使原片段文件已被删除', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-inc-idempotent-'));
    try {
      const frag = path.join(dir, 'temp.yaml');
      fs.writeFileSync(frag, 'logLevel: "debug"\n');
      const expanded1 = expandIncludes({ include: [frag] }, dir);
      assert.equal(expanded1.logLevel, 'debug');

      // 模拟片段文件已被删除
      fs.unlinkSync(frag);

      // 二次展开不应抛出 ENOENT，应直接返回已展开的配置
      const expanded2 = expandIncludes(expanded1, process.cwd());
      assert.equal(expanded2.logLevel, 'debug');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('expandIncludes - 原始对象二次传参不穿透：同一字面量重复调用不二次读盘', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-inc-raw-'));
    try {
      const frag = path.join(dir, 'raw.yaml');
      fs.writeFileSync(frag, 'logLevel: "debug"\n');

      const raw = { include: [frag] };
      const expanded1 = expandIncludes(raw, dir);
      assert.equal(expanded1.logLevel, 'debug');

      // 模拟片段文件已被删除
      fs.unlinkSync(frag);

      // 同一个原始对象（而非上一次的展开结果）二次传入，同样不应重复读盘
      const expanded2 = expandIncludes(raw, dir);
      assert.equal(expanded2.logLevel, 'debug');
      assert.equal(expanded2, expanded1, '原始对象二次传参应命中缓存并返回同一展开结果实例');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('expandIncludes - 数组对象并集去重：对对象属性键顺序不敏感', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-inc-token-'));
    try {
      const frag = path.join(dir, 'sub.yaml');
      // 键顺序为 url, tag
      fs.writeFileSync(frag, 'subscriptions:\n  - url: "https://a.com"\n    tag: "A"\n');

      // 主配置键顺序为 tag, url
      const res = expandIncludes(
        {
          include: [frag],
          subscriptions: [{ tag: 'A', url: 'https://a.com' }]
        },
        dir
      );

      // 去重后应只有 1 项，而不是 2 项
      assert.equal(res.subscriptions.length, 1, '不同键顺序的对象项未被成功去重');
      assert.equal(res.subscriptions[0].tag, 'A');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('buildProfile - SDK 显式 baseDir：跨目录相对 include 不再依赖 cwd', async () => {
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-inc-sdk-'));
    try {
      fs.writeFileSync(
        path.join(cfgDir, 'fragment.yaml'),
        `minorNodeThreshold: 1\nsubscriptions:\n  - uri: "${INLINE_URI}"\n    tag: FromFragment\n`
      );

      // 片段位于 cfgDir，而进程 cwd 是仓库根目录：只有显式传入 baseDir 才能正确解析
      const { yamlStr } = await buildProfile({ include: ['./fragment.yaml'] }, {
        mode: 'nodes',
        noCache: true,
        baseDir: cfgDir
      });
      assert.ok(yamlStr.includes('香港'), 'baseDir 指定的相对片段未被展开消费');
    } finally {
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  it('resolveConfig - options.baseDir 决定相对挂载路径的解析基准', () => {
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-inc-resolve-'));
    try {
      fs.writeFileSync(path.join(cfgDir, 'fragment.yaml'), 'minorNodeThreshold: 1\n');
      const cfg = resolveConfig({ include: ['./fragment.yaml'] }, { baseDir: cfgDir });
      assert.equal(cfg.minorNodeThreshold, 1, 'resolveConfig 未按 options.baseDir 解析相对 include');
    } finally {
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});
