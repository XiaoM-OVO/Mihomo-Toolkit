/**
 * 真实内核契约测试（默认跳过）。
 *
 * 背景：#RULES 出口标记是 v1.19.13 的内部实现细节（tunnel/dns_dialer.go 的
 * `DnsRespectRules = "RULES"`），且「respect-rules=true + proxy-server-nameserver 为空」
 * 会被 config/config.go 直接拒绝。本测试用真实二进制校验 legacy 映射模式的三种产物：
 *   1. 正常映射（respect-rules=false + #RULES 标记）
 *   2. 部分冲突（有效域名映射 + 冲突域名回退）
 *   3. 特殊条目回退（system → 非映射模式）
 *
 * 启用方式：
 *   MIHOMO_BIN=/path/to/mihomo node --test test/kernel/mihomo-kernel-contract.test.js
 * 可选：MIHOMO_EXPECT_VERSION=v1.19.13 用于校验内核版本。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildProfile } = require('../../src/index.js');

const MIHOMO_BIN = process.env.MIHOMO_BIN;
const EXPECT_VERSION = process.env.MIHOMO_EXPECT_VERSION;

function subWithResolver({ proxyName, server, resolver }) {
  return Buffer.from(`
dns:
  proxy-server-nameserver:
    - ${resolver}
proxies:
  - name: "${proxyName}"
    type: ss
    server: ${server}
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');
}

function writeConfig(yamlStr) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-kernel-'));
  const file = path.join(dir, 'config.yaml');
  fs.writeFileSync(file, yamlStr, 'utf8');
  return { dir, file };
}

function kernelTest(yamlStr) {
  const { dir, file } = writeConfig(yamlStr);
  try {
    const r = spawnSync(MIHOMO_BIN, ['-t', '-f', file, '-d', dir], { encoding: 'utf8' });
    const output = `${r.stdout || ''}\n${r.stderr || ''}`;
    assert.equal(r.status, 0, `mihomo -t 必须通过：\n${output}`);
    assert.ok(output.includes('test is successful'), `内核应返回 test is successful：\n${output}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const originalFetch = globalThis.fetch;

test('内核契约：映射模式产物可通过 v1.19.13 -t', { skip: !MIHOMO_BIN }, async () => {
  if (EXPECT_VERSION) {
    const v = spawnSync(MIHOMO_BIN, ['-v'], { encoding: 'utf8' });
    assert.ok(`${v.stdout || ''}${v.stderr || ''}`.includes(EXPECT_VERSION), `内核版本必须为 ${EXPECT_VERSION}`);
  }
  globalThis.fetch = async () => new Response(subWithResolver({
    proxyName: '🇭🇰 香港 01', server: 'hk.domain.com',
    resolver: 'https://dns.airport-a.com/dns-query/token-a'
  }), { status: 200 });
  try {
    const { yamlStr } = await buildProfile(
      { subscriptions: [{ url: 'http://93.184.216.34/kernel-mapping', tag: 'A', retry: 0 }], minorNodeThreshold: 1 },
      { mode: 'config', production: true, noCache: true }
    );
    kernelTest(yamlStr);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('内核契约：部分冲突（映射 + 回退）可通过 -t', { skip: !MIHOMO_BIN }, async () => {
  const byUrl = {
    'http://93.184.216.34/kernel-ok': subWithResolver({
      proxyName: '🇭🇰 香港 01', server: 'hk.domain.com',
      resolver: 'https://dns.airport-a.com/dns-query/token-a'
    }),
    'http://93.184.216.34/kernel-c1': subWithResolver({
      proxyName: '🇯🇵 日本 01', server: 'shared.domain.com',
      resolver: 'https://dns.airport-b.com/dns-query/token-b'
    }),
    'http://93.184.216.34/kernel-c2': subWithResolver({
      proxyName: '🇸🇬 新加坡 01', server: 'shared.domain.com',
      resolver: 'https://dns.airport-c.com/dns-query/token-c'
    })
  };
  globalThis.fetch = async (input) => {
    const target = typeof input === 'string' ? input : input.url;
    return new Response(byUrl[target] || '', { status: 200 });
  };
  try {
    const { yamlStr } = await buildProfile({
      subscriptions: [
        { url: 'http://93.184.216.34/kernel-ok', tag: 'OK', retry: 0 },
        { url: 'http://93.184.216.34/kernel-c1', tag: 'C1', retry: 0 },
        { url: 'http://93.184.216.34/kernel-c2', tag: 'C2', retry: 0 }
      ],
      minorNodeThreshold: 1
    }, { mode: 'config', production: true, noCache: true });
    kernelTest(yamlStr);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('内核契约：特殊条目回退后的非映射产物可通过 -t', { skip: !MIHOMO_BIN }, async () => {
  globalThis.fetch = async () => new Response(subWithResolver({
    proxyName: '🇭🇰 香港 01', server: 'hk.domain.com',
    resolver: 'https://dns.airport-a.com/dns-query/token-a'
  }), { status: 200 });
  try {
    const { yamlStr } = await buildProfile(
      {
        subscriptions: [{ url: 'http://93.184.216.34/kernel-special', tag: 'A', retry: 0 }],
        minorNodeThreshold: 1,
        dnsProxy: ['system']
      },
      { mode: 'config', production: true, noCache: true }
    );
    kernelTest(yamlStr);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
