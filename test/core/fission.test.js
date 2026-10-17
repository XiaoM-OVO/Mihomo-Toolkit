const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns').promises;
const { runNodesPipeline } = require('../../src/pipeline/nodes');
const { resolveProxiesDomains, DNS_QUERY_CONCURRENCY } = require('../../src/io/dns-resolver');

describe('【Core】节点域名裂变算法 (fission)', () => {
  let origResolve4;
  let origResolve6;

  beforeEach(() => {
    origResolve4 = dns.resolve4;
    origResolve6 = dns.resolve6;
    dns.resolve4 = async (domain) => {
      if (domain === 'dns.google') return ['8.8.8.8', '8.8.4.4'];
      return [];
    };
    dns.resolve6 = async (domain) => {
      if (domain === 'dns.google') return ['2001:4860:4860::8888', '2001:4860:4860::8844'];
      return [];
    };
  });

  afterEach(() => {
    dns.resolve4 = origResolve4;
    dns.resolve6 = origResolve6;
  });

  it('fission - 单域名多 IP 节点裂变增殖与 SNI 注入', async () => {
    const domainProxies = [
      { name: '🇭🇰 香港 01', type: 'trojan', server: 'dns.google', port: 443, password: 'pass1', tls: true }
    ];

    const config = {
      enableFission: true,
      fissionMaxNodes: 4,
      fissionStack: 'all',
      logLevel: 'silent'
    };

    const cleanProxies = await runNodesPipeline(domainProxies, config);

    // 验证域名节点被成功裂变为多个 IP 节点（dns.google 至少有 8.8.8.8 和 8.8.4.4）
    assert.ok(cleanProxies.length > 1, `期望裂变产生 >1 个节点，实际产生 ${cleanProxies.length} 个`);
    // 验证裂变后节点的 server 已经变为具体 IP 地址，且原域名被注入到 servername/sni
    cleanProxies.forEach(p => {
      assert.ok(p.server.includes('.') || p.server.includes(':'), `节点 server 应为 IP 地址: ${p.server}`);
      assert.equal(p.servername, 'dns.google');
    });
  });

  it('fission - 裂变黑名单关键字跳过', async () => {
    const domainProxies = [
      { name: '🇭🇰 香港 01 自动选择', type: 'ss', server: 'dns.google', port: 443, cipher: 'aes-256-gcm', password: 'pass1' }
    ];

    const config = {
      enableFission: true,
      fissionExcludeKeywords: ['自动选择'],
      logLevel: 'silent'
    };

    const cleanProxies = await runNodesPipeline(domainProxies, config);

    // 命中黑名单关键字时跳过裂变，节点数应仍为 1
    assert.equal(cleanProxies.length, 1);
  });

  it('fission - 域名批量解析受并发上限约束（信号量流控）', async () => {
    const domainCount = DNS_QUERY_CONCURRENCY * 4; // 远超上限，制造并发压力
    const proxies = Array.from({ length: domainCount }, (_, i) => ({
      name: `node-${i}`,
      type: 'ss',
      server: `host-${i}.example.com`,
      port: 443,
      cipher: 'aes-256-gcm',
      password: 'p'
    }));

    let inflight = 0;
    let maxInflight = 0;
    dns.resolve4 = async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise(r => setTimeout(r, 5));
      inflight--;
      return ['93.184.216.34']; // 公网 IP，命中即跳过 DoH 兜底，全程零真实出网
    };
    dns.resolve6 = async () => {
      await new Promise(r => setTimeout(r, 5));
      return [];
    };

    const map = await resolveProxiesDomains(proxies, {});

    assert.equal(map.size, domainCount, '域名解析结果数量不符');
    assert.ok(
      maxInflight <= DNS_QUERY_CONCURRENCY,
      `并发流控失效：峰值 ${maxInflight} 超过上限 ${DNS_QUERY_CONCURRENCY}`
    );
    assert.ok(maxInflight >= 2, `未观测到并发（峰值 ${maxInflight}），可能退化为串行`);
  });
});
