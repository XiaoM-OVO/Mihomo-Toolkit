const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateUrlSsrf, isAllowedUrl } = require('../src/builder.js');

describe('🔐 SSRF 安全拦截与 URL 校验模块', () => {
  test('isAllowedUrl - 拦截私网与非法协议', () => {
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

  test('validateUrlSsrf - 阻止 127.0.0.1 及私网地址', async () => {
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
  });
});
