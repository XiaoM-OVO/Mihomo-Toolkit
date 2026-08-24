const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateUrlSsrf, isAllowedUrl } = require('../src/builder.js');

describe('🔐 SSRF 安全拦截与 URL 校验模块', () => {
  test('isAllowedUrl - 拦截私网与非法协议', () => {
    assert.equal(isAllowedUrl('http://localhost/config.yaml'), false);
    assert.equal(isAllowedUrl('http://127.0.0.1:8080/sub'), false);
    assert.equal(isAllowedUrl('http://192.168.1.1/sub'), false);
    assert.equal(isAllowedUrl('http://10.0.0.1/sub'), false);
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
  });
});
