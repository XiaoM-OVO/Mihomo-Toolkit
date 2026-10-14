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
