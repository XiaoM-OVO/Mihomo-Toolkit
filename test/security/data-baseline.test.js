/**
 * 只读数据层 / 字段注册表 / 安全基线回归
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_CONFIG, resolveConfig } = require('../../src/config');
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
} = require('../../src/data');
const { REMOTE_CONFIG_FORBIDDEN_KEYS, hardenRemoteConfig } = require('../../src/core/security/remote-config');
const { sanitizeHosts } = require('../../src/core/security/dns-sanitizer');
const { applyDnsOverlay } = require('../../src/strategy/dns');
const { pruneEmptyGroups } = require('../../src/strategy/prune');
const { applySubscriptionGuards } = require('../../src/io/sub-processor');

const GOLDEN_PATH = path.join(__dirname, '..', 'fixtures', 'default-config.golden.json');

/** 恢复 golden 中 RegExp 的序列化形态 */
function reviveGolden(key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.__regex) {
    return new RegExp(value.__regex, value.__flags || '');
  }
  return value;
}

const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'), reviveGolden);

const LEGACY_REMOTE_DENIED = [
  'servicesConfigFile', 'fetchProxyPort', 'fetchProxyStrategy',
  'dnsListen', 'dnsAllowNonLoopback', 'dnsDefault', 'dnsDirect', 'dnsProxy', 'dnsServer',
  'nameserverPolicy', 'allowPrivateDns', 'trustedPrivateCidrs',
  'hosts', 'trustedHostDomains', 'allowInternalHosts', 'fakeIpFilter', 'fakeIpFilterNodes'
];

describe('【Security】数据层基线与字段注册表防漂移 (data-baseline)', () => {
  describe('field-registry - 字段注册表与默认配置自洽', () => {
    it('registry - 默认值 golden 基线与注册表一一对应', () => {
      const REMOVED_BY_DESIGN = ['dnsMergeMode', 'airportTagReg'];
      for (const [key, expected] of Object.entries(GOLDEN)) {
        if (REMOVED_BY_DESIGN.includes(key)) {
          assert.ok(!(key in DEFAULT_CONFIG), `${key} 应已被移除（无效字段撤回）`);
          continue;
        }
        assert.deepStrictEqual(DEFAULT_CONFIG[key], expected, `默认值 ${key} 与 golden 基线不一致`);
      }

      const goldenKeys = new Set(Object.keys(GOLDEN));
      const added = Object.keys(DEFAULT_CONFIG).filter(k => !goldenKeys.has(k));
      assert.deepStrictEqual(
        added.sort(),
        [
          'exemptGroups', 'protectedDomains',
          'devServices', 'geoipRepo', 'geositeRepo',
          'enableFission', 'fissionStack', 'fissionMaxNodes', 'fissionExcludeKeywords',
          'enableNodeSort',
          'processDirectLin', 'processDirectMac', 'processDirectWin',
          'processProxyLin', 'processProxyMac', 'processProxyWin',
          'blockKeywords', 'blockServers',
          'nodeIpVersion'
        ].sort(),
        '出现了未登记的默认字段：新增字段必须先在 field-registry.js 声明'
      );
    });

    it('registry - 声明与默认配置双向无孤儿', () => {
      const registryKeys = FIELDS.map(f => f.key);
      assert.deepStrictEqual(
        [...new Set(registryKeys)].length,
        registryKeys.length,
        '注册表存在重复 key'
      );
      for (const field of FIELDS) {
        if (field.default === undefined) {
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
  });

  describe('remote-config - 远程配置剥夺与不可篡改边界', () => {
    it('remote-denied - 远程剥夺清单由信任级派生且不弱于历史清单', () => {
      for (const key of LEGACY_REMOTE_DENIED) {
        assert.ok(
          REMOTE_CONFIG_FORBIDDEN_KEYS.includes(key),
          `远程剥夺清单丢失 ${key}（重构引入的防护回退）`
        );
      }
      for (const field of FIELDS.filter(f => f.trust === 'local')) {
        assert.ok(
          REMOTE_CONFIG_FORBIDDEN_KEYS.includes(field.key),
          `${field.key} 声明为 local 但未被远程剥夺`
        );
      }
      assert.deepStrictEqual([...REMOTE_CONFIG_FORBIDDEN_KEYS].sort(), [...REMOTE_DENIED_FIELDS].sort());
      assert.ok(REMOTE_CONFIG_FORBIDDEN_KEYS.includes('protectedDomains'));
      assert.ok(REMOTE_CONFIG_FORBIDDEN_KEYS.includes('exemptGroups'));
      assert.ok(REMOTE_CONFIG_FORBIDDEN_KEYS.includes('output'), 'output 必须是远程剥夺字段');
    });

    it('hardenRemoteConfig - 无法通过 ?config= 摘掉受保护域名或注入豁免组', () => {
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

    it('hardenRemoteConfig - 白名单收敛拦截未知字段与本地资源 [Fail-Closed]', () => {
      const r = hardenRemoteConfig({
        subscriptions: [{ url: 'https://example.com/sub.yaml' }],
        enableAI: true,
        output: '/etc/cron.d/evil',
        unknownAttackerField: 'danger-payload'
      });
      assert.equal(r.ok, true);
      assert.equal(r.config.enableAI, true);
      assert.equal(r.config.output, undefined);
      assert.equal(r.config.unknownAttackerField, undefined);
      assert.ok(r.strippedKeys.includes('output'));
      assert.ok(r.strippedKeys.includes('unknownAttackerField'));
    });

    it('hardenRemoteConfig - 严格纯函数，不得原地修改入参对象', () => {
      const raw = {
        subscriptions: [{ url: 'https://example.com/sub.yaml' }],
        enableAI: true,
        output: '/etc/cron.d/evil',
        unknownKey: 123
      };
      const originalKeys = Object.keys(raw).sort();
      const r = hardenRemoteConfig(raw);
      assert.equal(r.ok, true);
      assert.deepStrictEqual(Object.keys(raw).sort(), originalKeys, '入参对象键被原地修改');
      assert.equal(raw.output, '/etc/cron.d/evil', '入参对象属性被删除');
      assert.notStrictEqual(r.config, raw, '返回值应为新构建对象');
    });
  });

  describe('baseline-immutability - 只读基线与自持安全防线', () => {
    it('protectedDomains - 受保护域名只能追加，不能被配置清空或替换', () => {
      const cleared = resolveConfig({ protectedDomains: [] });
      assert.equal(cleared.protectedDomains.length, PROTECTED_DOMAINS.length);
      for (const d of PROTECTED_DOMAINS) {
        assert.ok(cleared.protectedDomains.includes(d), `基线域名 ${d} 被配置清空`);
      }
      const extended = resolveConfig({ protectedDomains: ['MyBank.example', '+.pay.example.', 'mybank.example'] });
      assert.ok(extended.protectedDomains.includes('mybank.example'));
      assert.ok(extended.protectedDomains.includes('pay.example'));
      assert.equal(
        extended.protectedDomains.length,
        PROTECTED_DOMAINS.length + 2,
        '用户追加条目未按域名规则去重归一'
      );
      assert.ok(extended.protectedDomains.includes('github.com'), '追加用户条目时丢掉了基线');

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

    it('exemptGroups - 骨架豁免组只增不减', () => {
      const merged = resolveConfig({ exemptGroups: ['🧪 实验节点'] });
      for (const g of SKELETON_EXEMPT_GROUPS) {
        assert.ok(merged.exemptGroups.includes(g), `骨架豁免组 ${g} 被配置覆盖`);
      }
      assert.ok(merged.exemptGroups.includes('🧪 实验节点'));

      const { proxyGroups } = pruneEmptyGroups({
        proxyGroups: [{ name: '手动选择', proxies: [] }, { name: '临时空组', proxies: [] }],
        exemptGroups: []
      });
      assert.deepStrictEqual(proxyGroups.map(g => g.name), ['手动选择']);
    });

    it('protectedDomains - 判定点自持基线：传入空受保护域名清单也不会 fail-open', () => {
      const config = { proxies: [] };
      applyDnsOverlay(config, {
        ...DEFAULT_CONFIG,
        protectedDomains: [],
        hosts: { 'github.com': '6.6.6.6', 'keep.example': '1.2.3.4' }
      });
      assert.equal((config.hosts || {})['github.com'], undefined, '空清单不得绕过受保护域名');
      assert.equal(config.hosts['keep.example'], '1.2.3.4');

      const target = {};
      applySubscriptionGuards(target, { hosts: { 'evil.example': '6.6.6.6' } }, {
        proxies: [{ name: 'A', server: 'evil.example' }],
        subUrl: 'https://evil.example/sub',
        assetClosureMode: 'standard',
        protectedDomains: ['evil.example']
      });
      assert.deepStrictEqual(target._assetHosts, undefined, '资产闭包通道绕过了用户追加的受保护域名');

      const control = {};
      applySubscriptionGuards(control, { hosts: { 'good.example': '6.6.6.6' } }, {
        proxies: [{ name: 'A', server: 'good.example' }],
        subUrl: 'https://good.example/sub',
        assetClosureMode: 'standard',
        protectedDomains: ['evil.example']
      });
      assert.deepStrictEqual(control._assetHosts, { 'good.example': '6.6.6.6' });

      const directSanitize = sanitizeHosts(
        { 'github.com': '6.6.6.6', 'paypal.com': '7.7.7.7', 'safe.org': '1.2.3.4' },
        { protectedDomains: [] }
      );
      assert.equal(directSanitize.hosts['github.com'], undefined, '原语层显式传空数组不得绕过 github.com 保护');
      assert.equal(directSanitize.hosts['paypal.com'], undefined, '原语层显式传空数组不得绕过 paypal.com 保护');
      assert.equal(directSanitize.hosts['safe.org'], '1.2.3.4', '正常域名仍应被放行');
    });

    it('protectedDomains - 用户追加后立即生效且保持幂等', () => {
      const { hosts, findings } = sanitizeHosts(
        { 'api.mybank.example': '6.6.6.6' },
        { protectedDomains: effectiveProtectedDomains(['mybank.example']) }
      );
      assert.deepStrictEqual(hosts, {});
      assert.ok(findings.some(f => f.id === 'HOSTS-PROTECTED-DOMAIN'));

      const once = effectiveProtectedDomains(['mybank.example']);
      assert.deepStrictEqual(effectiveProtectedDomains(once), once);
    });
  });

  describe('architecture-rules - 分层红线与基线完整性', () => {
    it('baseline - 词表归一化不得丢失任何条目', () => {
      assert.deepStrictEqual(normalizeDomainList(PROTECTED_DOMAINS), [...PROTECTED_DOMAINS]);
      assert.equal(effectiveProtectedDomains([]).length, PROTECTED_DOMAINS.length);
      assert.equal(effectiveExemptGroups([]).length, SKELETON_EXEMPT_GROUPS.length);
      assert.ok(FAKEIP_FILTER_BASELINE.length > 0);
      assert.ok(PROTECTED_DOMAINS.includes('github.com'));
      assert.ok(PROTECTED_DOMAINS.includes('paypal.com'));
    });

    it('layer-rules - data 层保持只读、纯数据、不反向依赖', () => {
      const dataDir = path.join(__dirname, '..', '..', 'src', 'data');
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
  });
});
