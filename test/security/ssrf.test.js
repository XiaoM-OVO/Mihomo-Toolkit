const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const dnsPromises = require('node:dns').promises;
const { validateUrlSsrf, isAllowedUrl, isAllowedUrlAsync } = require('../../src/index.js');

describe('【Security】SSRF 安全拦截与 URL 校验 (ssrf)', () => {
  it('isAllowedUrl - 拦截私网地址、云元数据及非法协议', () => {
    assert.equal(isAllowedUrl('http://localhost/config.yaml'), false);
    assert.equal(isAllowedUrl('http://127.0.0.1:8080/sub'), false);
    assert.equal(isAllowedUrl('http://192.168.1.1/sub'), false);
    assert.equal(isAllowedUrl('http://10.0.0.1/sub'), false);
    assert.equal(isAllowedUrl('http://100.64.0.1/sub'), false); // CGNAT
    assert.equal(isAllowedUrl('http://169.254.169.254/latest/meta-data/'), false); // 云元数据
    assert.equal(isAllowedUrl('http://255.255.255.255/sub'), false); // 广播
    assert.equal(isAllowedUrl('http://[::1]/sub'), false); // IPv6 回环
    assert.equal(isAllowedUrl('http://[::ffff:127.0.0.1]/sub'), false); // IPv4-mapped IPv6
    assert.equal(isAllowedUrl('http://[::ffff:169.254.169.254]/sub'), false);
    assert.equal(isAllowedUrl('http://[0:0:0:0:0:0:0:1]/sub'), false);
    assert.equal(isAllowedUrl('ftp://example.com/sub'), false);
    assert.equal(isAllowedUrl('https://example.com/sub.yaml'), true);
  });

  it('validateUrlSsrf - 异步解析并阻止 127.0.0.1、私网网段与文件协议', async () => {
    await assert.rejects(
      async () => { await validateUrlSsrf('http://localhost:3000/sub'); },
      /SSRF blocked/
    );

    await assert.rejects(
      async () => { await validateUrlSsrf('http://127.0.0.1/sub'); },
      /SSRF blocked/
    );

    await assert.rejects(
      async () => { await validateUrlSsrf('http://192.168.0.1/sub'); },
      /SSRF blocked/
    );

    await assert.rejects(
      async () => { await validateUrlSsrf('http://10.254.1.1/sub'); },
      /SSRF blocked/
    );

    await assert.rejects(
      async () => { await validateUrlSsrf('http://100.64.1.1/sub'); },
      /SSRF blocked/
    );

    await assert.rejects(
      async () => { await validateUrlSsrf('http://169.254.169.254/sub'); },
      /SSRF blocked/
    );

    await assert.rejects(
      async () => { await validateUrlSsrf('http://[::ffff:127.0.0.1]/sub'); },
      /SSRF blocked/
    );

    await assert.rejects(
      async () => { await validateUrlSsrf('http://[::ffff:169.254.169.254]/sub'); },
      /SSRF blocked/
    );

    await assert.rejects(
      async () => { await validateUrlSsrf('file:///etc/passwd'); },
      /SSRF blocked: illegal protocol/
    );

    await assert.rejects(
      async () => { await validateUrlSsrf('ftp://example.com/sub'); },
      /SSRF blocked: illegal protocol/
    );
  });

  it('isAllowedUrlAsync - DNS 解析至内网的合法域名被拦截 (补齐同步字面量盲区)', async () => {
    const origResolve4 = dnsPromises.resolve4;
    const origResolve6 = dnsPromises.resolve6;
    try {
      // 1. 域名本身合法，但解析结果指向私网 → 必须拦截（同步 isAllowedUrl 会放行）
      dnsPromises.resolve4 = async () => ['10.20.30.40'];
      dnsPromises.resolve6 = async () => [];
      assert.equal(
        await isAllowedUrlAsync('http://rebind-sync-gap.example/sub'),
        false,
        '域名解析至私网应被异步预检拦截'
      );

      // 2. 同一域名若是字面量私网 IP，无需 DNS 也应直接拒绝
      assert.equal(await isAllowedUrlAsync('http://127.0.0.1/sub'), false);
      assert.equal(await isAllowedUrlAsync('ftp://example.com/sub'), false);

      // 3. 解析结果为公网地址时应正常放行（避免误伤）
      dnsPromises.resolve4 = async () => ['93.184.216.34'];
      assert.equal(
        await isAllowedUrlAsync('http://rebind-public-probe.example/sub'),
        true,
        '解析至公网的合法域名不应被误拦'
      );
    } finally {
      dnsPromises.resolve4 = origResolve4;
      dnsPromises.resolve6 = origResolve6;
    }
  });
});

describe('【Security】SSRF fail-closed 与分模式严格度 (ssrf-strict)', () => {
  /** 注入固定解析结果的确定性解析器 */
  const staticResolver = (v4, v6 = []) => async (_host, family) => (family === 4 ? v4 : v6);
  /** 模拟 DNS 解析失败（NXDOMAIN / 网络不可用 / 超时） */
  const failingResolver = async () => { throw new Error('ENOTFOUND'); };

  it('strict（直连语义）- DNS 解析失败/超时一律拒绝，不得把 DNS 错误当作放行', async () => {
    await assert.rejects(
      async () => { await validateUrlSsrf('http://dns-fail.example/sub', { resolve: failingResolver }); },
      (err) => err.ssrfBlocked === 'unverified' && err.retryable !== false
    );
    // 默认即 strict，无需显式传参
    await assert.rejects(
      async () => { await validateUrlSsrf('http://dns-fail-default.example/sub', { resolve: failingResolver }); },
      /SSRF blocked/
    );
  });

  it('strict - A/AAAA 均无记录（空结果）同样拒绝，不得视为可放行', async () => {
    await assert.rejects(
      async () => { await validateUrlSsrf('http://no-record.example/sub', { resolve: staticResolver([], []) }); },
      /unable to verify/
    );
  });

  it('非 strict（代理语义）- 本地解析失败不据此拒绝（本地结果不权威）', async () => {
    assert.equal(
      await validateUrlSsrf('http://proxy-delegated.example/sub', { resolve: failingResolver, strict: false }),
      true
    );
  });

  it('全候选地址检查 - A 记录中混有公网与私网时按既定策略拒绝', async () => {
    await assert.rejects(
      async () => {
        await validateUrlSsrf('http://mixed.example/sub', { resolve: staticResolver(['93.184.216.34', '10.0.0.5']) });
      },
      /resolved to private IP 10\.0\.0\.5/
    );
  });

  it('全候选地址检查 - AAAA 结果指向私网/IPv4 映射地址时拒绝', async () => {
    await assert.rejects(
      async () => { await validateUrlSsrf('http://v6-loopback.example/sub', { resolve: staticResolver([], ['::1']) }); },
      /private IPv6/
    );
    await assert.rejects(
      async () => { await validateUrlSsrf('http://v6-mapped.example/sub', { resolve: staticResolver([], ['::ffff:10.0.0.9']) }); },
      /private IPv6/
    );
  });

  it('只有 AAAA 且为公网时不误伤', async () => {
    assert.equal(
      await validateUrlSsrf('http://only-aaaa.example/sub', { resolve: staticResolver([], ['2606:2800:220:1:248:1893:25c8:1946']) }),
      true
    );
  });

  it('localhost 子域在解析前即拒绝，不依赖 DNS 结果', async () => {
    // 即便解析器返回公网，也必须被前置拦截
    await assert.rejects(
      async () => { await validateUrlSsrf('http://evil.localhost/sub', { resolve: staticResolver(['93.184.216.34']) }); },
      /illegal host/
    );
    await assert.rejects(
      async () => { await validateUrlSsrf('http://sub.localhost/sub', { resolve: staticResolver(['93.184.216.34']), strict: false }); },
      /illegal host/
    );
    assert.equal(isAllowedUrl('http://evil.localhost/sub'), false);
    assert.equal(isAllowedUrl('http://sub.localhost:8080/sub'), false);
  });

  it('错误分类 - 策略拦截 retryable=false（不重试/不回退），无法证明不设该标记（允许 auto 回退代理）', async () => {
    await assert.rejects(
      async () => { await validateUrlSsrf('http://169.254.169.254/latest/meta-data/'); },
      (err) => err.ssrfBlocked === 'policy' && err.retryable === false
    );
    await assert.rejects(
      async () => { await validateUrlSsrf('http://dns-fail-classify.example/sub', { resolve: failingResolver }); },
      (err) => err.ssrfBlocked === 'unverified' && err.retryable === undefined
    );
  });
});
