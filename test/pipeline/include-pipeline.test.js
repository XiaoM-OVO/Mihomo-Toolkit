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
});
