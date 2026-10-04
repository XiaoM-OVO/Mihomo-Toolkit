/**
 * -----------------------------------------------------------------------------
 * 📁 include 全链路一致性 (Include End-to-End)
 * -----------------------------------------------------------------------------
 * 复现并锁定一个真实缺陷：`resolveConfig` 只在 nodes / strategy 阶段被调用，
 * 晚于订阅抓取阶段；而 engine / cli 在 buildProfile 返回前后直接读取原始 userConfig
 * 的 subscriptions / output 等字段。于是「主文件只写 include、配置项放进片段」
 * 时，这些字段读不到，运行 `-t nodes` 会抛 `No URL or subscriptions provided.`。
 *
 * 本套件断言：include 片段提供的 `subscriptions` 能真正驱动全链路抓取与产出，
 * 且 CLI 自身读取的 `output` 也来自片段。全程零网络请求（订阅以内联 URI 提供）。
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { buildProfile } = require('../src/index.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'targets', 'cli.js');

/** 一个可内联解析、无需联网的合法订阅节点（域名服务器，避免触发假 IP 清洗） */
const INLINE_URI = 'vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01';

describe('📁 include 全链路一致性', () => {
  test('buildProfile 入口兜底展开 include：subscriptions 经由片段提供', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-inc-engine-'));
    try {
      const frag = path.join(dir, 'fragment.yaml');
      fs.writeFileSync(
        frag,
        `minorNodeThreshold: 1\nsubscriptions:\n  - uri: "${INLINE_URI}"\n    tag: FromFragment\n`
      );

      // 主配置对象只有 include，没有任何 subscriptions —— 修复前 engine 读不到订阅即抛错
      const { yamlStr } = await buildProfile({ include: [frag] }, { mode: 'nodes', noCache: true });
      assert.ok(yamlStr.includes('香港'), '片段中的 subscriptions 未被 engine 消费并产出节点');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('CLI 装载现场展开 include：subscriptions 与 output 均可来自片段（相对路径基准=配置文件目录）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-inc-cli-'));
    try {
      // 片段：真正的订阅与输出路径都在这里提供
      fs.writeFileSync(
        path.join(dir, 'fragment.yaml'),
        `minorNodeThreshold: 1\noutput: "custom-nodes.yaml"\nsubscriptions:\n  - uri: "${INLINE_URI}"\n    tag: FromFragment\n`
      );
      // 主文件：只有 include，且为相对路径（基准必须落在配置文件所在目录）
      const main = path.join(dir, 'config.yaml');
      fs.writeFileSync(main, 'include: ["./fragment.yaml"]\n');

      execFileSync(process.execPath, [CLI_PATH, '-c', main, '-m', 'nodes', '--silent'], {
        cwd: dir,
        encoding: 'utf-8'
      });

      // output 来自片段：产物写到 custom-nodes.yaml 而非默认 nodes.yaml
      const customOut = path.join(dir, 'custom-nodes.yaml');
      assert.ok(fs.existsSync(customOut), '片段提供的 output 未被 CLI 采纳');
      assert.ok(fs.readFileSync(customOut, 'utf-8').includes('香港'), '片段中的 subscriptions 未驱动产出节点');
      assert.ok(!fs.existsSync(path.join(dir, 'nodes.yaml')), '不应回落到默认输出路径');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
