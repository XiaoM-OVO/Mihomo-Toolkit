/**
 * 【Strategy】交付层叠加：请求 Host 直连规则 / fake-ip-filter / 降级提示节点
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('yaml');
const { renderDelivery } = require('../../src/strategy/delivery-overlay');
const { groupName, GROUP_KEYS } = require('../../src/data/catalog/identity');

const BANNER = '# ==== test banner ====\n';

function makeOutputData(overrides = {}) {
  return {
    rules: [
      'RULE-SET,lan-domain,DIRECT',
      'RULE-SET,lan-ip,DIRECT,no-resolve',
      'IP-CIDR6,::1/128,DIRECT,no-resolve',
      'DOMAIN,static.example.com,DIRECT',
      'RULE-SET,ads,广告拦截',
      'MATCH,漏网之鱼'
    ],
    proxies: [
      { name: '节点A', type: 'ss', server: '1.2.3.4', port: 443 }
    ],
    'proxy-groups': [
      { name: groupName(GROUP_KEYS.dashboard), type: 'select', proxies: ['节点A', 'DIRECT'] },
      { name: groupName(GROUP_KEYS.auto), type: 'select', proxies: ['节点A'] }
    ],
    dns: { 'fake-ip-filter': ['*.lan', 'static.example.com'] },
    ...overrides
  };
}

function makeResult(outputData = makeOutputData()) {
  return {
    banner: BANNER,
    outputData,
    yamlStr: BANNER + yaml.stringify(outputData)
  };
}

describe('【Strategy】交付层叠加 (delivery-overlay)', () => {
  it('无叠加项时原样返回缓存字符串', () => {
    const result = makeResult();
    assert.equal(renderDelivery(result), result.yamlStr);
    assert.equal(renderDelivery(result, { hosts: [] }), result.yamlStr);
  });

  it('请求 Host 生成直连规则并插入订阅直连段（LAN / IPv6 之后，分流规则之前）', () => {
    const result = makeResult();
    const out = renderDelivery(result, { hosts: ['sub.test-toolkit.com', '198.51.100.1', '+.example.org'] });
    const parsed = yaml.parse(out);

    const lanIdx = parsed.rules.indexOf('RULE-SET,lan-ip,DIRECT,no-resolve');
    const ipv6Idx = parsed.rules.indexOf('IP-CIDR6,::1/128,DIRECT,no-resolve');
    const domainIdx = parsed.rules.indexOf('DOMAIN,sub.test-toolkit.com,DIRECT');
    const ipIdx = parsed.rules.indexOf('IP-CIDR,198.51.100.1/32,DIRECT,no-resolve');
    const suffixIdx = parsed.rules.indexOf('DOMAIN-SUFFIX,example.org,DIRECT');
    const adsIdx = parsed.rules.indexOf('RULE-SET,ads,广告拦截');

    assert.ok(domainIdx > lanIdx, 'Host 直连规则必须在 LAN 规则之后');
    assert.ok(domainIdx > ipv6Idx, 'Host 直连规则必须越过可选 IPv6 直连段');
    assert.ok(domainIdx < adsIdx, 'Host 直连规则必须排在分流规则之前');
    assert.ok(ipIdx > domainIdx && suffixIdx > domainIdx);

    // fake-ip-filter 只收域名/通配，IP 字面量不得进入
    assert.ok(parsed.dns['fake-ip-filter'].includes('sub.test-toolkit.com'));
    assert.ok(parsed.dns['fake-ip-filter'].includes('+.example.org'));
    assert.ok(!parsed.dns['fake-ip-filter'].includes('198.51.100.1'));

    // 缓存产物必须保持不可变
    assert.equal(result.outputData.rules.length, 6);
    assert.equal(result.outputData.dns['fake-ip-filter'].length, 2);
  });

  it('已存在的静态 subDomain 条目不会重复注入', () => {
    const result = makeResult();
    const out = renderDelivery(result, { hosts: ['static.example.com'] });
    assert.equal(out, result.yamlStr);
    const parsed = yaml.parse(out);
    assert.equal(parsed.rules.filter(r => r === 'DOMAIN,static.example.com,DIRECT').length, 1);
    assert.equal(parsed.dns['fake-ip-filter'].filter(f => f === 'static.example.com').length, 1);
  });

  it('降级提示节点只加入看板组，且排在 DIRECT 之前', () => {
    const result = makeResult();
    const out = renderDelivery(result, { noticeTags: ['FN'] });
    const parsed = yaml.parse(out);
    const dashboard = parsed['proxy-groups'].find(g => g.name === groupName(GROUP_KEYS.dashboard));

    const noticeName = parsed.proxies.map(p => p.name).find(name => /[FN].*旧缓存/.test(name));
    assert.ok(noticeName, '必须生成降级提示节点');
    assert.ok(dashboard.proxies.includes(noticeName), '提示节点必须进入看板组');
    assert.equal(dashboard.proxies[dashboard.proxies.length - 1], 'DIRECT');
    assert.equal(parsed.proxies.length, result.outputData.proxies.length + 1);

    // 其它组不得被污染
    const auto = parsed['proxy-groups'].find(g => g.name === groupName(GROUP_KEYS.auto));
    assert.ok(!auto.proxies.includes(noticeName));
  });

  it('enableDashboard=false 时不生成提示节点，但 Host 叠加仍然生效', () => {
    const result = makeResult();
    const out = renderDelivery(result, {
      hosts: ['sub.test-toolkit.com'],
      noticeTags: ['FN'],
      enableDashboard: false
    });
    const parsed = yaml.parse(out);
    assert.ok(parsed.rules.includes('DOMAIN,sub.test-toolkit.com,DIRECT'));
    assert.equal(parsed.proxies.length, result.outputData.proxies.length);
  });

  it('convertText 仅作用于新生成的提示文案', () => {
    const result = makeResult();
    const out = renderDelivery(result, {
      noticeTags: ['FN'],
      convertText: (text) => text.replace('旧缓存', '舊快取')
    });
    const parsed = yaml.parse(out);
    assert.ok(parsed.proxies.some(p => p.name.includes('舊快取')));
  });
});
