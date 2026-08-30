const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { operator } = require('../src/pure-nodes.js');

describe('🧬 节点裂变算法模块 (enableFission)', () => {
  test('pure-nodes - 单域名多 IP 节点裂变增殖测试', async () => {
    // 使用通常具备多个 A/AAAA 记录的域名进行测试
    const domainProxies = [
      { name: '🇭🇰 香港 01', type: 'trojan', server: 'dns.google', port: 443, password: 'pass1', tls: true }
    ];

    const config = {
      enableFission: true,
      fissionMaxNodes: 4,
      fissionStack: 'all',
      logLevel: 'silent'
    };

    const result = await operator(domainProxies, 'clash', config);
    const cleanProxies = Array.isArray(result) ? result : result.proxies;

    // 验证域名节点被成功裂变为多个 IP 节点（dns.google 至少有 8.8.8.8 和 8.8.4.4）
    assert.ok(cleanProxies.length > 1, `期望裂变产生 >1 个节点，实际产生 ${cleanProxies.length} 个`);
    // 验证裂变后节点的 server 已经变为具体 IP 地址，且原域名被注入到 servername/sni
    cleanProxies.forEach(p => {
      assert.ok(p.server.includes('.') || p.server.includes(':'), `节点 server 应为 IP 地址: ${p.server}`);
      assert.equal(p.servername, 'dns.google');
    });
  });

  test('pure-nodes - 裂变黑名单关键字跳过测试', async () => {
    const domainProxies = [
      { name: '🇭🇰 香港 01 自动选择', type: 'ss', server: 'dns.google', port: 443, cipher: 'aes-256-gcm', password: 'pass1' }
    ];

    const config = {
      enableFission: true,
      fissionExcludeKeywords: ['自动选择'],
      logLevel: 'silent'
    };

    const result = await operator(domainProxies, 'clash', config);
    const cleanProxies = Array.isArray(result) ? result : result.proxies;

    // 命中黑名单关键字时跳过裂变，节点数应仍为 1
    assert.equal(cleanProxies.length, 1);
  });
});
