/**
 * -----------------------------------------------------------------------------
 * 交付契约与控制面净化回归测试 (Delivery Contract & Control-Plane Regression)
 * -----------------------------------------------------------------------------
 * 覆盖历史缺陷：
 *   C-1  单 URL / 本地文件路径曾完全绕过控制面净化，订阅的控制面字段原样随产物下发
 *   H-2  受保护域名可经 nameserver-policy 通道被订阅劫持
 *   M-1  enablePipeline=false 曾等价于「零净化透传」
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildProfile } = require('../src/index.js');
const {
  TOOLKIT_OUTPUT_KEYS,
  enforceOutputContract,
  resetToolkitOutputKeys
} = require('../src/core/security/control-plane');

/** 模拟不可信订阅：数据面节点 + 全量控制面攻击载荷 */
const EVIL_SUBSCRIPTION = `
external-controller: "0.0.0.0:9090"
secret: attacker-controlled-secret
external-ui: /tmp/evil-ui
allow-lan: true
mixed-port: 7890
port: 7891
tunnels:
  - tcp,127.0.0.1:3389,1.2.3.4:3389
listeners:
  - name: evil-inbound
    type: socks
    port: 1080
    listen: 0.0.0.0
geox-url:
  geoip: "https://evil.example.com/geoip.dat"
geo-auto-update: true
script:
  code: |
    module.exports = { main: (config) => config }
brand-new-control-field: should-be-stripped
mode: global
log-level: debug
ntp:
  enable: true
hosts:
  "github.com": "6.6.6.6"
  "paypal.com": "6.6.6.6"
  "node.airport.com": "104.16.1.1"
dns:
  enable: true
  listen: "0.0.0.0:53"
  nameserver:
    - "https://evil.example.com/dns-query#skip-cert-verify=true"
  nameserver-policy:
    "+.airport.com": "https://doh.airport.com/dns-query"
    "paypal.com": "https://evil.example.com/dns-query"
proxy-groups:
  - name: "EVIL-GLOBAL"
    type: select
    proxies: ["DIRECT"]
rules:
  - "MATCH,EVIL-GLOBAL"
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: node.airport.com
    port: 443
    cipher: aes-128-gcm
    password: pass
  - name: "🇺🇸 美国 01"
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: pass
`;

/** 控制面攻击载荷：绝不允许出现在产物顶层 */
const FORBIDDEN_TOP_LEVEL = [
  'external-controller', 'secret', 'external-ui', 'allow-lan',
  'mixed-port', 'port', 'socks-port', 'redir-port', 'tproxy-port',
  'lan-allowed-ips', 'authentication', 'bind-address',
  'tunnels', 'listeners', 'geox-url', 'geo-auto-update', 'script',
  'brand-new-control-field', 'mode', 'log-level', 'ntp'
];

function writeFixture(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-sec-'));
  const file = path.join(dir, 'evil-sub.yaml');
  fs.writeFileSync(file, content, 'utf-8');
  return { dir, file };
}

describe('🔒 交付契约与控制面净化 (Delivery Contract)', () => {
  test('C-1 单 URL/本地文件路径：控制面字段一律不得进入产物，且保留节点资产闭包', async () => {
    const { dir, file } = writeFixture(EVIL_SUBSCRIPTION);
    try {
      const res = await buildProfile({}, { mode: 'config', url: file, production: true, noCache: true });
      const d = res.outputData;

      // 1. 控制面攻击载荷 0 残留
      const leaked = FORBIDDEN_TOP_LEVEL.filter(k => Object.prototype.hasOwnProperty.call(d, k));
      assert.deepEqual(leaked, [], `控制面字段泄漏: ${leaked.join(', ')}`);

      // 2. 产物顶层键必须全部落在工具自有白名单内
      const illegal = Object.keys(d).filter(k => !TOOLKIT_OUTPUT_KEYS.has(k));
      assert.deepEqual(illegal, [], `出现非白名单顶层键: ${illegal.join(', ')}`);

      // 3. 正常交付能力不受影响：策略组/规则/DNS/TUN 仍由本工具生成
      assert.ok((d['proxy-groups'] || []).length > 0, '策略组未生成');
      assert.ok((d.rules || []).length > 0, '分流规则未生成');
      assert.equal(d.dns.enable, true);
      assert.ok(d.tun, 'TUN 覆写丢失');
      assert.ok(d.proxies.length >= 1, '节点丢失');

      // 4. 节点资产闭包保留（节点确实需要它才能连通）
      assert.equal(d.hosts['node.airport.com'], '104.16.1.1');
      assert.equal(d.dns['nameserver-policy']['+.airport.com'], 'https://doh.airport.com/dns-query');

      // 5. 高危公共域名劫持被拦截（hosts 与 policy 两条通道都要拦）
      assert.equal(d.hosts['github.com'], undefined, 'hosts 劫持 github.com 未被拦截');
      assert.equal(d.hosts['paypal.com'], undefined, 'hosts 劫持 paypal.com 未被拦截');
      assert.equal(d.dns['nameserver-policy']['paypal.com'], undefined, 'DNS 通道劫持 paypal.com 未被拦截');

      // 6. 保留键不得被订阅覆盖
      const cnPolicy = d.dns['nameserver-policy']['rule-set:cn-domain'];
      assert.ok(cnPolicy, '保留键 rule-set:cn-domain 丢失');
      assert.ok(!JSON.stringify(cnPolicy).includes('evil.example.com'), '保留键被订阅覆盖');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('M-1 enablePipeline=false 不再等价于零净化透传', async () => {
    const { dir, file } = writeFixture(EVIL_SUBSCRIPTION);
    try {
      const res = await buildProfile({ enablePipeline: false }, { mode: 'config', url: file, production: true, noCache: true });
      const d = res.outputData;
      const leaked = FORBIDDEN_TOP_LEVEL.filter(k => Object.prototype.hasOwnProperty.call(d, k));
      assert.deepEqual(leaked, [], `enablePipeline=false 时控制面字段泄漏: ${leaked.join(', ')}`);
      // 跳过策略编排时只应交付清洗后的节点
      assert.ok(Array.isArray(d.proxies));
      assert.equal(d['proxy-groups'], undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('输出契约：非白名单顶层键一律剥离（fail-closed）', () => {
    const cfg = {
      proxies: [],
      dns: { enable: true },
      'external-controller': '0.0.0.0:9090',
      secret: 'x',
      __weird__: 1
    };
    const { stripped, kept } = enforceOutputContract(cfg);
    assert.deepEqual(stripped.sort(), ['__weird__', 'external-controller', 'secret']);
    assert.deepEqual(kept.sort(), ['dns', 'proxies']);
    assert.equal(cfg['external-controller'], undefined);
  });

  test('生成前重置：清空输入骨架中的工具自有键（proxies 除外）', () => {
    const cfg = { proxies: [{ name: 'a' }], dns: { enable: false }, hosts: { 'x.com': '1.1.1.1' }, tun: {}, 'log-level': 'debug' };
    const removed = resetToolkitOutputKeys(cfg);
    assert.deepEqual(removed.sort(), ['dns', 'hosts', 'tun']);
    assert.deepEqual(cfg.proxies, [{ name: 'a' }]);
    assert.equal(cfg.dns, undefined);
    assert.equal(cfg['log-level'], 'debug', '非工具自有键应由交付契约收口，不在此处处理');
  });

  test('Clash Verge 独立脚本路径（runStrategyPipeline）不得剥离用户自有顶层键', () => {
    // 该路径的入参是「用户本机可信配置」，与不可信的订阅骨架完全不同：
    // 交付契约只能作用于 runConfigPipeline（订阅骨架），绝不能下沉到 runStrategyPipeline。
    const { runStrategyPipeline } = require('../src/index.js');
    const input = {
      port: 7890,
      mode: 'rule',
      'log-level': 'info',
      'allow-lan': false,
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
        { name: '🇺🇸 美国 01', type: 'ss', server: 'us1.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' }
      ]
    };
    const out = runStrategyPipeline(input, { enablePipeline: true });
    assert.equal(out.port, 7890, '用户自有 port 被误删');
    assert.equal(out.mode, 'rule', '用户自有 mode 被误删');
    assert.equal(out['log-level'], 'info', '用户自有 log-level 被误删');
    assert.ok(out['proxy-groups'].length > 0, '策略组未生成');
    assert.ok(out.rules.length > 0, '分流规则未生成');
    assert.ok(out.dns && out.dns.enable, 'DNS 覆写未生效');
  });
});

/** 两个不同机场的订阅：各自声明 hosts 与私有 DoH */
const TWO_AIRPORTS = `
hosts:
  "node.airport-a.com": "104.16.1.1"
  "cdn.airport-b.com": "1.1.1.1"
dns:
  nameserver-policy:
    "+.airport-a.com": "https://doh.airport-a.com/dns-query"
    "+.airport-b.com": "https://doh.airport-b.com/dns-query"
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: node.airport-a.com
    port: 443
    cipher: aes-128-gcm
    password: p
  - name: "🇺🇸 美国 01"
    type: ss
    server: cdn.airport-b.com
    port: 443
    cipher: aes-128-gcm
    password: p
`;

describe('🔗 节点资产闭包强度 (Asset Closure)', () => {
  async function build(mode, allowlist) {
    const { dir, file } = writeFixture(TWO_AIRPORTS);
    try {
      const res = await buildProfile(
        { assetClosure: mode, assetDomainAllowlist: allowlist || [] },
        { mode: 'config', url: file, production: true, noCache: true }
      );
      return res.outputData;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('standard（默认）：订阅声明的节点资产依赖全部继承', async () => {
    const d = await build('standard');
    assert.equal(d.hosts['node.airport-a.com'], '104.16.1.1');
    assert.equal(d.hosts['cdn.airport-b.com'], '1.1.1.1');
    assert.equal(d.dns['nameserver-policy']['+.airport-a.com'], 'https://doh.airport-a.com/dns-query');
    assert.equal(d.dns['nameserver-policy']['+.airport-b.com'], 'https://doh.airport-b.com/dns-query');
  });

  test('strict：仅继承显式白名单内的域名', async () => {
    const d = await build('strict', ['airport-a.com']);
    assert.equal(d.hosts['node.airport-a.com'], '104.16.1.1', '白名单内域名应继承');
    assert.equal(d.hosts['cdn.airport-b.com'], undefined, '白名单外域名不得继承');
    assert.equal(d.dns['nameserver-policy']['+.airport-a.com'], 'https://doh.airport-a.com/dns-query');
    assert.equal(d.dns['nameserver-policy']['+.airport-b.com'], undefined);
  });

  test('off：完全不继承订阅声明的 DNS 依赖', async () => {
    const d = await build('off');
    assert.deepEqual(d.hosts, undefined);
    assert.equal(d.dns['nameserver-policy']['+.airport-a.com'], undefined);
    assert.equal(d.dns['nameserver-policy']['+.airport-b.com'], undefined);
    // 工具自建的解析链必须依然存在
    assert.ok(d.dns.nameserver.length > 0);
    assert.ok(d.dns['nameserver-policy']['rule-set:cn-domain']);
  });
});

describe('📊 资源配额 (Quota Enforcement)', () => {
  const MANY_NODES = 'proxies:\n' + Array.from({ length: 5 }, (_, i) =>
    `  - name: "🇭🇰 香港 0${i}"\n    type: ss\n    server: hk${i}.airport-a.com\n    port: 443\n    cipher: aes-128-gcm\n    password: p`
  ).join('\n');

  test('总节点数超限时拒绝构建', async () => {
    await assert.rejects(
      () => buildProfile({ security: { maxTotalNodes: 3 }, subscriptions: [{ uri: MANY_NODES }] },
        { mode: 'nodes', noCache: true }),
      /Too many total nodes/
    );
  });

  test('单订阅节点数超限时拒绝构建', async () => {
    await assert.rejects(
      () => buildProfile({ security: { perSubscriptionMaxNodes: 2 }, subscriptions: [{ uri: MANY_NODES }] },
        { mode: 'nodes', noCache: true }),
      /too many nodes/i
    );
  });

  test('配额充足时正常构建', async () => {
    const res = await buildProfile({ security: { maxTotalNodes: 50, perSubscriptionMaxNodes: 50 }, subscriptions: [{ uri: MANY_NODES }] },
      { mode: 'nodes', noCache: true });
    assert.ok(res.yamlStr);
  });
});
