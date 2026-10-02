/**
 * -----------------------------------------------------------------------------
 * 🧪 只读数据层 / 字段注册表 / 安全基线回归
 * -----------------------------------------------------------------------------
 * 本套件是「默认值与安全基线」的防复发护栏，覆盖三类风险：
 *   1. 默认值被静默改动（默认值本身就是安全姿态，例如 dnsAllowNonLoopback=false）
 *   2. 只读基线被配置削减（受保护域名被 config.yaml 或 ?config= 摘掉）
 *   3. 新增安全字段却没有同步远程剥夺清单（旧实现靠人手维护四份清单，必然漂移）
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_CONFIG } = require('../src/config');
const { resolveConfig } = require('../src/config');
const {
  FIELDS,
  ADDITIVE_FIELDS,
  REMOTE_DENIED_FIELDS,
  PROTECTED_DOMAINS,
  SKELETON_EXEMPT_GROUPS,
  FAKEIP_FILTER_BASELINE,
  ENTRY_NORMALIZERS,
  normalizeDomainList,
  effectiveProtectedDomains,
  effectiveExemptGroups
} = require('../src/data');
const { REMOTE_CONFIG_FORBIDDEN_KEYS, hardenRemoteConfig } = require('../src/core/security/remote-config');
const { sanitizeHosts } = require('../src/core/security/dns-sanitizer');
const { applyDnsOverlay } = require('../src/strategy/dns');
const { pruneEmptyGroups } = require('../src/strategy/prune');
const { applySubscriptionGuards } = require('../src/io/sub-processor');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'default-config.golden.json');

/** 恢复 golden 中 RegExp 的序列化形态（注意 JSON.parse reviver 的首参是 key） */
function reviveGolden(key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.__regex) {
    return new RegExp(value.__regex, value.__flags || '');
  }
  return value;
}

const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'), reviveGolden);

/**
 * 重构前 `src/config/defaults.js` 中被远程配置剥夺的字段（冻结的旧清单）。
 * 派生实现必须**至少**覆盖这些字段，否则等于重构顺手削弱了防护。
 */
const LEGACY_REMOTE_DENIED = [
  'servicesConfigFile', 'servicesConfig', 'fetchProxyPort', 'fetchProxyStrategy',
  'dnsListen', 'dnsAllowNonLoopback', 'dnsDefault', 'dnsDirect', 'dnsProxy', 'dnsServer',
  'nameserverPolicy', 'allowPrivateDns', 'trustedPrivateCidrs',
  'hosts', 'trustedHostDomains', 'allowInternalHosts', 'fakeIpFilter', 'fakeIpFilterNodes'
];

test('📊 字段注册表 — 默认值 golden 基线与注册表一一对应', () => {
  // 1. 旧字段的默认值必须逐项一字不差（默认值即安全姿态，改动必须显式体现在 git diff 里）
  //    刻意移除的字段单独列出：撤回一个无效字段同样是必须显式承认的改动
  const REMOVED_BY_DESIGN = ['dnsMergeMode'];
  for (const [key, expected] of Object.entries(GOLDEN)) {
    if (REMOVED_BY_DESIGN.includes(key)) {
      assert.ok(!(key in DEFAULT_CONFIG), `${key} 应已被移除（无效字段撤回）`);
      continue;
    }
    assert.deepStrictEqual(DEFAULT_CONFIG[key], expected, `默认值 ${key} 与 golden 基线不一致`);
  }
  // 2. 除刻意新增的字段外，不得凭空多出字段
  const goldenKeys = new Set(Object.keys(GOLDEN));
  const added = Object.keys(DEFAULT_CONFIG).filter(k => !goldenKeys.has(k));
  assert.deepStrictEqual(
    added.sort(),
    [
      // 只读基线可追加的两个安全开关
      'exemptGroups', 'protectedDomains',
      // 规则集/服务来源、节点裂变与进程分流名单：
      // 原为「代码在读、任何地方都查不到」的隐形字段，P0 清账时登记
      'devServices', 'geoipRepo', 'geositeRepo',
      'enableFission', 'fissionStack', 'fissionMaxNodes', 'fissionExcludeKeywords',
      'processDirectLin', 'processDirectMac', 'processDirectWin',
      'processProxyLin', 'processProxyMac', 'processProxyWin',
      // 清洗层用户黑名单（自旧版恢复：节点名/服务器命中即拦截，优先于白名单）
      'blockKeywords', 'blockServers'
    ].sort(),
    '出现了未登记的默认字段：新增字段必须先在 field-registry.js 声明'
  );
});

test('📊 字段注册表 — 声明与默认配置双向无孤儿', () => {
  const registryKeys = FIELDS.map(f => f.key);
  assert.deepStrictEqual(
    [...new Set(registryKeys)].length,
    registryKeys.length,
    '注册表存在重复 key'
  );
  for (const field of FIELDS) {
    if (field.default === undefined) {
      // 无出厂默认值的已登记字段：代码内有兜底，不得混入 DEFAULT_CONFIG
      assert.ok(
        !(field.key in DEFAULT_CONFIG),
        `无默认值字段 ${field.key} 不应出现在 DEFAULT_CONFIG`
      );
    } else {
      assert.ok(field.key in DEFAULT_CONFIG, `注册表字段 ${field.key} 未派生进 DEFAULT_CONFIG`);
    }
  }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(registryKeys.includes(key), `DEFAULT_CONFIG 字段 ${key} 未在注册表登记`);
  }
  // 每个字段都必须声明完整元数据，避免出现「半登记」字段
  for (const field of FIELDS) {
    assert.ok(field.type, `${field.key} 缺少 type`);
    assert.ok(field.group, `${field.key} 缺少 group`);
    assert.ok(field.doc, `${field.key} 缺少 doc`);
    assert.ok(['override', 'additive'].includes(field.merge), `${field.key} merge 非法`);
    assert.ok(['any', 'local'].includes(field.trust), `${field.key} trust 非法`);
    if (field.merge === 'additive') {
      assert.ok(Array.isArray(field.baseline) && field.baseline.length > 0, `${field.key} additive 但缺少基线`);
      assert.ok(ENTRY_NORMALIZERS[field.normalize], `${field.key} 的 normalize 标签无效`);
    }
  }
});

test('🛡️ 远程剥夺清单 — 由信任级派生且不弱于历史清单', () => {
  // 1. 旧清单全量覆盖（重构不得丢失任何一条剥夺）
  for (const key of LEGACY_REMOTE_DENIED) {
    assert.ok(
      REMOTE_CONFIG_FORBIDDEN_KEYS.includes(key),
      `远程剥夺清单丢失 ${key}（重构引入的防护回退）`
    );
  }
  // 2. 注册表中所有 trust:'local' 字段自动进入清单（消灭双清单漂移）
  for (const field of FIELDS.filter(f => f.trust === 'local')) {
    assert.ok(
      REMOTE_CONFIG_FORBIDDEN_KEYS.includes(field.key),
      `${field.key} 声明为 local 但未被远程剥夺`
    );
  }
  assert.deepStrictEqual([...REMOTE_CONFIG_FORBIDDEN_KEYS].sort(), [...REMOTE_DENIED_FIELDS].sort());
  // 3. 本次新增的两个安全开关同样远程不可写
  assert.ok(REMOTE_CONFIG_FORBIDDEN_KEYS.includes('protectedDomains'));
  assert.ok(REMOTE_CONFIG_FORBIDDEN_KEYS.includes('exemptGroups'));
});

test('🛡️ 远程配置 — 无法通过 ?config= 摘掉受保护域名或注入豁免组', () => {
  const r = hardenRemoteConfig({
    subscriptions: [{ url: 'https://example.com/sub.yaml' }],
    protectedDomains: [],
    exemptGroups: ['🗑️ 未知识别'],
    dnsServer: ['1.2.3.4']
  });
  assert.equal(r.ok, true);
  assert.equal(r.config.protectedDomains, undefined);
  assert.equal(r.config.exemptGroups, undefined);
  assert.equal(r.config.dnsServer, undefined);
  assert.ok(r.strippedKeys.includes('protectedDomains'));
  assert.ok(r.strippedKeys.includes('exemptGroups'));
});

test('🔒 只读基线 — 受保护域名只能追加，不能被配置清空或替换', () => {
  // 空数组：不得退化成「无受保护域名」
  const cleared = resolveConfig({ protectedDomains: [] });
  assert.equal(cleared.protectedDomains.length, PROTECTED_DOMAINS.length);
  for (const d of PROTECTED_DOMAINS) {
    assert.ok(cleared.protectedDomains.includes(d), `基线域名 ${d} 被配置清空`);
  }
  // 追加：用户条目并入且去重（含大小写 / +. 前缀 / 尾随点等写法归一）
  const extended = resolveConfig({ protectedDomains: ['MyBank.example', '+.pay.example.', 'mybank.example'] });
  assert.ok(extended.protectedDomains.includes('mybank.example'));
  assert.ok(extended.protectedDomains.includes('pay.example'));
  assert.equal(
    extended.protectedDomains.length,
    PROTECTED_DOMAINS.length + 2,
    '用户追加条目未按域名规则去重归一'
  );
  assert.ok(extended.protectedDomains.includes('github.com'), '追加用户条目时丢掉了基线');
  // 非法条目：丢弃并告警（fail-open 不可静默），基线不受影响
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  let invalid;
  try {
    invalid = resolveConfig({ protectedDomains: ['https://evil.example/x', 'not a domain'] });
  } finally {
    console.warn = origWarn;
  }
  assert.equal(invalid.protectedDomains.length, PROTECTED_DOMAINS.length);
  assert.equal(warnings.length, 1, '非法条目必须显式告警，不能静默忽略');
  assert.match(warnings[0], /protectedDomains/);
});

test('🔒 只读基线 — 骨架豁免组同样只增不减', () => {
  const merged = resolveConfig({ exemptGroups: ['🧪 实验节点'] });
  for (const g of SKELETON_EXEMPT_GROUPS) {
    assert.ok(merged.exemptGroups.includes(g), `骨架豁免组 ${g} 被配置覆盖`);
  }
  assert.ok(merged.exemptGroups.includes('🧪 实验节点'));
  // 判定点自持基线：即便调用方传空数组（未经过 resolveConfig），骨架组也不会被误斩首
  const { proxyGroups } = pruneEmptyGroups({
    proxyGroups: [{ name: '手动选择', proxies: [] }, { name: '临时空组', proxies: [] }],
    exemptGroups: []
  });
  assert.deepStrictEqual(proxyGroups.map(g => g.name), ['手动选择']);
});

test('🔒 判定点自持基线 — 传入空受保护域名清单也不会 fail-open', () => {
  // dns.js 用户 hosts 通道：受保护域被丢弃，非受保护域照常保留（证明沙箱确实执行了）
  const config = { proxies: [] };
  applyDnsOverlay(config, {
    ...DEFAULT_CONFIG,
    protectedDomains: [],
    hosts: { 'github.com': '6.6.6.6', 'keep.example': '1.2.3.4' }
  });
  assert.equal((config.hosts || {})['github.com'], undefined, '空清单不得绕过受保护域名');
  assert.equal(config.hosts['keep.example'], '1.2.3.4');

  // sub-processor 节点资产闭包通道（与上面是两条独立路径，必须都生效）
  const target = {};
  applySubscriptionGuards(target, { hosts: { 'evil.example': '6.6.6.6' } }, {
    proxies: [{ name: 'A', server: 'evil.example' }],
    subUrl: 'https://evil.example/sub',
    assetClosureMode: 'standard',
    protectedDomains: ['evil.example']
  });
  assert.deepStrictEqual(target._assetHosts, undefined, '资产闭包通道绕过了用户追加的受保护域名');

  // 对照：不在受保护清单内的资产域，闭包继承应正常发生
  const control = {};
  applySubscriptionGuards(control, { hosts: { 'good.example': '6.6.6.6' } }, {
    proxies: [{ name: 'A', server: 'good.example' }],
    subUrl: 'https://good.example/sub',
    assetClosureMode: 'standard',
    protectedDomains: ['evil.example']
  });
  assert.deepStrictEqual(control._assetHosts, { 'good.example': '6.6.6.6' });
});

test('🔒 受保护域名 — 用户追加后立即生效（含子域后缀匹配）', () => {
  const { hosts, findings } = sanitizeHosts(
    { 'api.mybank.example': '6.6.6.6' },
    { protectedDomains: effectiveProtectedDomains(['mybank.example']) }
  );
  assert.deepStrictEqual(hosts, {});
  assert.ok(findings.some(f => f.id === 'HOSTS-PROTECTED-DOMAIN'));
  // 幂等：对已合并结果再次合并不改变内容
  const once = effectiveProtectedDomains(['mybank.example']);
  assert.deepStrictEqual(effectiveProtectedDomains(once), once);
});

test('🧩 基线完整性 — 词表归一化不得丢失任何条目', () => {
  // 受保护域名与 fake-ip-filter 基线未来若加入含下划线等非法字符的条目，必须在此暴露
  assert.deepStrictEqual(normalizeDomainList(PROTECTED_DOMAINS), [...PROTECTED_DOMAINS]);
  assert.equal(effectiveProtectedDomains([]).length, PROTECTED_DOMAINS.length);
  assert.equal(effectiveExemptGroups([]).length, SKELETON_EXEMPT_GROUPS.length);
  assert.ok(FAKEIP_FILTER_BASELINE.length > 0);
  assert.ok(PROTECTED_DOMAINS.includes('github.com'));
  assert.ok(PROTECTED_DOMAINS.includes('paypal.com'));
});

test('🏛️ 分层红线 — data 层保持只读、纯数据、不反向依赖', () => {
  const dataDir = path.join(__dirname, '..', 'src', 'data');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 2, 'data 层模块缺失');
  const forbidden = [
    /require\(\s*['"](?:node:)?(fs|http|https|net|dns|child_process|os)['"]\s*\)/,
    /require\(\s*['"][^'"]*\/(?:io|pipeline|targets|core|strategy|config)\//,
    /\bfetch\s*\(/,
    /\bprocess\.env\b/
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(dataDir, file), 'utf8');
    for (const re of forbidden) {
      assert.ok(!re.test(src), `src/data/${file} 命中分层红线: ${re}`);
    }
  }
});
