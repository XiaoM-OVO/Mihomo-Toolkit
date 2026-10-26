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
  REMOTE_DENIED_FIELDS,
  PROTECTED_DOMAINS,
  SKELETON_EXEMPT_GROUPS,
  FAKEIP_FILTER_BASELINE,
  ENTRY_NORMALIZERS,
  normalizeDomainList,
  effectiveProtectedDomains,
  effectiveExemptGroups,
  ENTRY_CITIES,
  EXIT_REGIONS,
  TAG_MAP,
  LINE_QUALITY_TIERS,
  getLineQualityWeight,
  SORTED_CARRIER_COMBOS,
  DOMESTIC_ENTRY_CITIES,
  STATIC_FEATURE_RULES,
  STREAMING_FEATURE_REG,
  ISOLATION_SORT_ORDER,
  REGEX_FAKE_IPV4,
  REGEX_FAKE_IPV6,
  REGEX_DUMMY_AUTH,
  REGEX_INFO_NODE,
  REGEX_AD_TYPO
} = require('../../src/data');
const { REMOTE_CONFIG_FORBIDDEN_KEYS, hardenRemoteConfig } = require('../../src/core/security/remote-config');
const { sanitizeHosts } = require('../../src/core/security/dns-sanitizer');
const { applyDnsOverlay } = require('../../src/strategy/dns');
const { pruneEmptyGroups } = require('../../src/strategy/prune');
const { applySubscriptionGuards } = require('../../src/pipeline/ingestion');

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
      // 基线已不含退役字段：批次 3 起分流开关与分类清单全部移除（迁移对照表见 docs/history/m3-spec.md 10.7）。
      // 若 golden 重新混入旧字段，下面的逐字段比对会直接失败。
      for (const [key, expected] of Object.entries(GOLDEN)) {
        assert.deepStrictEqual(DEFAULT_CONFIG[key], expected, `默认值 ${key} 与 golden 基线不一致`);
      }

      const goldenKeys = new Set(Object.keys(GOLDEN));
      const added = Object.keys(DEFAULT_CONFIG).filter(k => !goldenKeys.has(k));
      assert.deepStrictEqual(
        added.sort(),
        [
          'exemptGroups', 'protectedDomains',
          'coreRegions',
          'geoipRepo', 'geositeRepo',
          'enableFission', 'fissionStack', 'fissionMaxNodes', 'fissionExcludeKeywords',
          'enableNodeSort',
          'customProcessLin', 'customProcessMac', 'customProcessWin',
          'btProcessLin', 'btProcessMac', 'btProcessWin',
          'downloadProcessLin', 'downloadProcessMac', 'downloadProcessWin',
          'blockKeywords', 'blockServers',
          'nodeIpVersion',
          'routing', 'trafficDirection',
          'enableIsolation', 'pools'
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
      assert.ok(REMOTE_CONFIG_FORBIDDEN_KEYS.includes('routing'), 'routing 必须是远程剥夺字段（防策略劫持）');
      assert.ok(REMOTE_CONFIG_FORBIDDEN_KEYS.includes('customRuleProviders'), 'customRuleProviders 必须是远程剥夺字段（防出网探测）');
      assert.ok(REMOTE_CONFIG_FORBIDDEN_KEYS.includes('assetDomainAllowlist'), 'assetDomainAllowlist 必须是远程剥夺字段（防清明白名单）');
    });

    it('hardenRemoteConfig - 无法通过 ?config= 摘掉受保护域名、注入自定义规则或篡改豁免组', () => {
      const r = hardenRemoteConfig({
        subscriptions: [{ url: 'https://example.com/sub.yaml' }],
        protectedDomains: [],
        exemptGroups: ['🗑️ 未知识别'],
        dnsServer: ['1.2.3.4'],
        groups: [{ name: 'evil', proxies: ['DIRECT'] }],
        customRuleProviders: { evil: { url: 'https://evil.com' } },
        assetDomainAllowlist: []
      });
      assert.equal(r.ok, true);
      assert.equal(r.config.protectedDomains, undefined);
      assert.equal(r.config.exemptGroups, undefined);
      assert.equal(r.config.dnsServer, undefined);
      assert.equal(r.config.groups, undefined);
      assert.equal(r.config.customRuleProviders, undefined);
      assert.equal(r.config.assetDomainAllowlist, undefined);
      assert.ok(r.strippedKeys.includes('protectedDomains'));
      assert.ok(r.strippedKeys.includes('exemptGroups'));
      assert.ok(r.strippedKeys.includes('groups'));
      assert.ok(r.strippedKeys.includes('customRuleProviders'));
      assert.ok(r.strippedKeys.includes('assetDomainAllowlist'));
    });

    it('hardenRemoteConfig - 白名单收敛拦截未知字段与本地资源 [Fail-Closed]', () => {
      const r = hardenRemoteConfig({
        subscriptions: [{ url: 'https://example.com/sub.yaml' }],
        enableRegionHashLB: true,
        output: '/etc/cron.d/evil',
        unknownAttackerField: 'danger-payload'
      });
      assert.equal(r.ok, true);
      assert.equal(r.config.enableRegionHashLB, true);
      assert.equal(r.config.output, undefined);
      assert.equal(r.config.unknownAttackerField, undefined);
      assert.ok(r.strippedKeys.includes('output'));
      assert.ok(r.strippedKeys.includes('unknownAttackerField'));
    });

    it('hardenRemoteConfig - 严格纯函数，不得原地修改入参对象', () => {
      const raw = {
        subscriptions: [{ url: 'https://example.com/sub.yaml' }],
        enableRegionHashLB: true,
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

    it('exemptGroups - 骨架豁免组只增不减与无视装饰匹配 (Decoration-Agnostic)', () => {
      const merged = resolveConfig({ exemptGroups: ['🧪 实验节点'] });
      for (const g of SKELETON_EXEMPT_GROUPS) {
        assert.ok(merged.exemptGroups.includes(g), `骨架豁免组 ${g} 被配置覆盖`);
      }
      assert.ok(merged.exemptGroups.includes('🧪 实验节点'));

      // 1. 骨架组纯净名自持保活
      const res1 = pruneEmptyGroups({
        proxyGroups: [{ name: '手动选择', proxies: [] }, { name: '临时空组', proxies: [] }],
        exemptGroups: []
      });
      assert.deepStrictEqual(res1.proxyGroups.map(g => g.name), ['手动选择']);

      // 2. 带 Emoji 组名被纯净豁免清单命中 (📍 手动选择 匹配 手动选择)
      const res2 = pruneEmptyGroups({
        proxyGroups: [{ name: '📍 手动选择', proxies: [] }, { name: '临时空组', proxies: [] }],
        exemptGroups: ['手动选择']
      });
      assert.deepStrictEqual(res2.proxyGroups.map(g => g.name), ['📍 手动选择']);

      // 3. 用户配置带 Emoji 豁免项 (🏠 家宽优选) 命中纯净策略组名 (家宽优选)
      const res3 = pruneEmptyGroups({
        proxyGroups: [{ name: '家宽优选', proxies: [] }, { name: '临时空组', proxies: [] }],
        exemptGroups: ['🏠 家宽优选']
      });
      assert.deepStrictEqual(res3.proxyGroups.map(g => g.name), ['家宽优选']);
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

      const evilResult = applySubscriptionGuards({ hosts: { 'evil.example': '6.6.6.6' } }, {
        proxies: [{ name: 'A', server: 'evil.example' }],
        subUrl: 'https://evil.example/sub',
        assetClosureMode: 'standard',
        protectedDomains: ['evil.example']
      });
      assert.deepStrictEqual(evilResult.assets.hosts, {}, '资产闭包通道绕过了用户追加的受保护域名');

      const controlResult = applySubscriptionGuards({ hosts: { 'good.example': '6.6.6.6' } }, {
        proxies: [{ name: 'A', server: 'good.example' }],
        subUrl: 'https://good.example/sub',
        assetClosureMode: 'standard',
        protectedDomains: ['evil.example']
      });
      assert.deepStrictEqual(controlResult.assets.hosts, { 'good.example': '6.6.6.6' });

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

  describe('cleaner-rules - 节点清洗只读规则与词库基线完整性', () => {
    it('cleaner-rules - 城市与地区词库格式正确且具备代表性条目', () => {
      assert.ok(Array.isArray(ENTRY_CITIES) && ENTRY_CITIES.length >= 40);
      assert.ok(Array.isArray(EXIT_REGIONS) && EXIT_REGIONS.length >= 40);
      assert.ok(ENTRY_CITIES.includes('深圳') && ENTRY_CITIES.includes('SZX'));
      assert.ok(EXIT_REGIONS.includes('香港') && EXIT_REGIONS.includes('HKG'));
      assert.equal(TAG_MAP['深圳'], '深');
      assert.equal(TAG_MAP['SZX'], '深');
      assert.equal(TAG_MAP['上海'], '沪');
      assert.equal(TAG_MAP['PVG'], '沪');
      assert.ok(DOMESTIC_ENTRY_CITIES instanceof Set);
      assert.ok(DOMESTIC_ENTRY_CITIES.has('深') && DOMESTIC_ENTRY_CITIES.has('SZX'));
      assert.ok(DOMESTIC_ENTRY_CITIES.has('沪') && DOMESTIC_ENTRY_CITIES.has('PVG'));
    });

    it('cleaner-rules - 线路质量权重与梯队判定自洽', () => {
      assert.ok(Array.isArray(LINE_QUALITY_TIERS) && LINE_QUALITY_TIERS.length === 5);
      assert.ok(Array.isArray(SORTED_CARRIER_COMBOS) && SORTED_CARRIER_COMBOS.length === 4);
      assert.equal(SORTED_CARRIER_COMBOS[0][0], '三网', '大集合三网必须排在最前');
      assert.equal(getLineQualityWeight('IEPL/深港'), 1);
      assert.equal(getLineQualityWeight('IPLC专线'), 1);
      assert.equal(getLineQualityWeight('CN2 GIA'), 2);
      assert.equal(getLineQualityWeight('CMIN2'), 2);
      assert.equal(getLineQualityWeight('AS9929'), 2);
      assert.equal(getLineQualityWeight('优质专线VIP'), 3);
      assert.equal(getLineQualityWeight('BGP'), 4);
      assert.equal(getLineQualityWeight('CMI'), 4);
      assert.equal(getLineQualityWeight('中转隧道'), 5);
      assert.equal(getLineQualityWeight('普通直连节点'), 6);
      assert.equal(getLineQualityWeight(''), 6);
      assert.equal(getLineQualityWeight(null), 6);
    });

    it('cleaner-rules - 静态业务特征与隔离排序权重无孤儿', () => {
      assert.ok(Array.isArray(STATIC_FEATURE_RULES) && STATIC_FEATURE_RULES.length >= 10);
      for (const rule of STATIC_FEATURE_RULES) {
        assert.ok(rule.reg instanceof RegExp, `规则 ${rule.tag} reg 不是 RegExp`);
        assert.ok(typeof rule.tag === 'string' && rule.tag.length > 0, '规则 tag 缺失');
      }
      assert.ok(STREAMING_FEATURE_REG instanceof RegExp, 'STREAMING_FEATURE_REG 必须为 RegExp');
      assert.ok(STREAMING_FEATURE_REG.test('Netflix 解锁'));
      assert.ok(STREAMING_FEATURE_REG.test('Disney+ 4K'));
      assert.equal(ISOLATION_SORT_ORDER[''], 0);
      assert.equal(ISOLATION_SORT_ORDER.std, 0);
      assert.equal(ISOLATION_SORT_ORDER.residential, 1);
      assert.equal(ISOLATION_SORT_ORDER.lowMulti, 2);
      assert.equal(ISOLATION_SORT_ORDER.experimental, 3);
      assert.equal(ISOLATION_SORT_ORDER.highMulti, 4);
    });

    it('cleaner-rules - 拦截与阻断正则基线工作正常', () => {
      assert.ok(REGEX_FAKE_IPV4.test('127.0.0.1'));
      assert.ok(REGEX_FAKE_IPV4.test('10.0.0.1'));
      assert.ok(REGEX_FAKE_IPV4.test('192.168.1.1'));
      assert.ok(!REGEX_FAKE_IPV4.test('1.2.3.4'));

      assert.ok(REGEX_FAKE_IPV6.test('::1'));
      assert.ok(REGEX_FAKE_IPV6.test('fc00::1'));
      assert.ok(!REGEX_FAKE_IPV6.test('2400:3200::1'));

      assert.ok(REGEX_DUMMY_AUTH.test('password'));
      assert.ok(REGEX_DUMMY_AUTH.test('123456'));
      assert.ok(REGEX_DUMMY_AUTH.test('00000000-0000-0000-0000-000000000000'));
      assert.ok(!REGEX_DUMMY_AUTH.test('my-secret-key-12345'));

      assert.ok(REGEX_INFO_NODE.test('剩余流量：100G'));
      assert.ok(REGEX_INFO_NODE.test('套餐到期时间'));
      assert.ok(!REGEX_INFO_NODE.test('🇭🇰 香港 01 BGP'));

      assert.ok(REGEX_AD_TYPO.test('防失联地址'));
      assert.ok(REGEX_AD_TYPO.test('最新发布页'));
      assert.ok(!REGEX_AD_TYPO.test('🇭🇰 香港 01'));
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

    it('layer-rules - infra 层保持只读无状态基元、零业务反向依赖', () => {
      const infraDir = path.join(__dirname, '..', '..', 'src', 'infra');
      const files = fs.readdirSync(infraDir).filter(f => f.endsWith('.js'));
      assert.ok(files.length >= 2, 'infra 层模块缺失');
      const forbidden = [
        /require\(\s*['"](?:node:)?(fs|http|https|net|dns|child_process|os)['"]\s*\)/,
        /require\(\s*['"][^'"]*\/(?:io|pipeline|targets|core|strategy|config|data)\//,
        /\bfetch\s*\(/,
        /\bprocess\.env\b/
      ];
      for (const file of files) {
        const src = fs.readFileSync(path.join(infraDir, file), 'utf8');
        for (const re of forbidden) {
          assert.ok(!re.test(src), `src/infra/${file} 命中分层红线: ${re}`);
        }
      }
    });
  });
});
