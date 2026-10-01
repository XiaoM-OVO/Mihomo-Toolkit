/**
 * -----------------------------------------------------------------------------
 * 常驻服务安全姿态回归测试 (Server Security Posture)
 * -----------------------------------------------------------------------------
 * 覆盖历史缺陷：
 *   C-3  server 默认绑定全网卡且无鉴权 → 未授权即可驱动服务端抓取/读取本地文件
 * 全部用例均不依赖公网：参数拒绝发生在任何网络请求之前。
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, isLoopbackHost, safeTokenEqual } = require('../src/targets/server');
const { hardenRemoteConfig } = require('../src/core/security/remote-config');
const { readBodyWithLimit } = require('../src/io/fetcher');

const silentLogger = {
  debug() {}, info() {}, warn() {}, error() {}, success() {}, log() {},
  child() { return this; }, isLevelEnabled() { return false; }
};

const NODE_SUB = `
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: node.airport.com
    port: 443
    cipher: aes-128-gcm
    password: pass
`;

function makeFixture(extraConfig = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-srv-'));
  const subFile = path.join(dir, 'nodes.yaml');
  fs.writeFileSync(subFile, NODE_SUB, 'utf-8');
  const configFile = path.join(dir, 'config.yaml');
  fs.writeFileSync(configFile, `logLevel: silent\n${extraConfig}subscriptions:\n  - url: ${JSON.stringify(subFile)}\n    tag: LOCAL\n`, 'utf-8');
  return { dir, configFile };
}

async function startTestServer(options) {
  const server = startServer({ port: 0, logger: silentLogger, ...options });
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  return { server, port: server.address().port };
}

/**
 * 使用一次性连接（agent: false）发起请求：
 * 避免 undici/keep-alive 连接池在跨用例的临时端口复用下产生 ECONNRESET 假失败。
 */
function get(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method: 'GET', headers, agent: false },
      (res) => {
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** 一个永远不会被真正访问的「合法公网形态」URL：用于验证参数闸门是否放行 */
const PARAM_URI = '/sub?config=http%3A%2F%2F127.0.0.1%3A1%2Fx.yaml';

/** 构造一个最小 Response 替身，用于验证流式限长逻辑 */
function fakeResponse(chunks, headers = {}) {
  const encoder = new TextEncoder();
  return {
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      }
    }),
    text: async () => chunks.join('')
  };
}

describe('📏 响应体流式限长 (M-3 内存耗尽防护)', () => {
  test('未超限时正常聚合', async () => {
    const text = await readBodyWithLimit(fakeResponse(['hello', ' ', 'world']), 64);
    assert.equal(text, 'hello world');
  });

  test('超过上限时立即中止并抛出不可重试错误', async () => {
    await assert.rejects(
      () => readBodyWithLimit(fakeResponse(['a'.repeat(50), 'b'.repeat(50)]), 60),
      (err) => {
        assert.match(err.message, /too large/i);
        assert.equal(err.retryable, false);
        return true;
      }
    );
  });

  test('Content-Length 已声明超限时不读取正文', async () => {
    await assert.rejects(
      () => readBodyWithLimit(fakeResponse(['x'.repeat(10)], { 'content-length': '1048576' }), 1024),
      (err) => {
        assert.match(err.message, /too large/i);
        return true;
      }
    );
  });

  test('maxBytes 为 0 时不做限制（向后兼容）', async () => {
    const text = await readBodyWithLimit(fakeResponse(['unlimited']), 0);
    assert.equal(text, 'unlimited');
  });
});

describe('🔐 远程配置信任边界 (C-2 ?config= Hardening)', () => {
  test('拒绝远程配置引用本地路径订阅源（任意文件读取链）', () => {
    for (const bad of [
      './victim-profile.yaml',
      '../../etc/passwd',
      'C:\\Users\\admin\\.ssh\\id_rsa',
      'file:///etc/passwd',
      '\\\\server\\share\\x.yaml'
    ]) {
      const r = hardenRemoteConfig({ subscriptions: [{ url: bad, tag: 'X' }] });
      assert.equal(r.ok, false, `本地路径未被拒绝: ${bad}`);
    }
  });

  test('放行 http(s) 订阅源并剥夺本机资源与 DNS 控制面字段', () => {
    const r = hardenRemoteConfig({
      subscriptions: [{ url: 'https://example.com/sub.yaml' }, { uri: 'vless://x@1.2.3.4:443' }],
      servicesConfigFile: './evil.js',
      servicesConfig: { ai: {} },
      fetchProxyPort: 6379,
      fetchProxyStrategy: 'proxy',
      dnsListen: '0.0.0.0:53',
      dnsAllowNonLoopback: true,
      dnsProxy: ['https://evil.example.com/dns-query'],
      nameserverPolicy: { 'paypal.com': 'https://evil.example.com/dns-query' },
      hosts: { 'github.com': '6.6.6.6' },
      enableAI: true
    });
    assert.equal(r.ok, true);
    assert.deepEqual(
      r.strippedKeys.sort(),
      ['dnsAllowNonLoopback', 'dnsListen', 'dnsProxy', 'fetchProxyPort', 'fetchProxyStrategy',
       'hosts', 'nameserverPolicy', 'servicesConfig', 'servicesConfigFile'].sort()
    );
    // 能力剥夺：DNS 控制面与本地资源字段全部消失
    for (const k of ['servicesConfigFile', 'fetchProxyPort', 'dnsListen', 'dnsProxy', 'nameserverPolicy', 'hosts']) {
      assert.equal(r.config[k], undefined, `${k} 未被剥夺`);
    }
    // 策略编排偏好仍然保留（远程配置的正当用途）
    assert.equal(r.config.enableAI, true);
    assert.equal(r.config.subscriptions.length, 2);
  });

  test('回环地址判定与恒定时间比较工具', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) {
      assert.equal(isLoopbackHost(h), true, `${h} 应判为回环`);
    }
    for (const h of ['0.0.0.0', '::', '[::]', '192.168.1.5', '10.0.0.1', 'example.com', '']) {
      assert.equal(isLoopbackHost(h), false, `${h} 不应判为回环`);
    }
    assert.equal(safeTokenEqual('abc', 'abc'), true);
    assert.equal(safeTokenEqual('abc', 'abd'), false);
    assert.equal(safeTokenEqual('abc', 'abcd'), false);
    assert.equal(safeTokenEqual(undefined, 'abc'), false);
  });
});

describe('🌐 常驻服务安全姿态 (Server Security Posture)', () => {
  test('C-3 非回环监听且无 authToken：拒绝参数化请求，但本地配置订阅仍可用', async () => {
    const { dir, configFile } = makeFixture();
    const { server, port } = await startTestServer({ host: '0.0.0.0', configPath: configFile });
    try {
      // 1. 参数入口一律 fail-closed（此时尚无任何网络请求）
      const viaConfig = await get(port, PARAM_URI);
      assert.equal(viaConfig.status, 403, '?config= 未被拒绝');
      assert.match(viaConfig.body, /authToken/);

      const viaUrl = await get(port, '/sub?url=https%3A%2F%2Fexample.com%2Fsub');
      assert.equal(viaUrl.status, 403, '?url= 未被拒绝');

      // 2. 无参数请求（走本地 config.yaml 的可信订阅清单）仍正常工作
      const bare = await get(port, '/sub');
      assert.equal(bare.status, 200);
      assert.match(bare.body, /proxy-groups/);

      // 3. 健康检查不受影响
      const health = await get(port, '/healthz');
      assert.equal(health.status, 200);
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('回环监听：参数闸门放行（无效 URL 应返回 400 而非 403）', async () => {
    const { dir, configFile } = makeFixture();
    const { server, port } = await startTestServer({ host: '127.0.0.1', configPath: configFile });
    try {
      const res = await get(port, PARAM_URI);
      assert.equal(res.status, 400, '回环监听下参数闸门不应拦截');
      assert.match(res.body, /disallowed config URL/);
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('配置 authToken 后：非回环监听放行参数入口，但必须先通过鉴权', async () => {
    const { dir, configFile } = makeFixture('authToken: "s3cret-token"\n');
    const { server, port } = await startTestServer({ host: '0.0.0.0', configPath: configFile });
    try {
      // 1. 无 Token → 401（鉴权先于参数闸门）
      const noToken = await get(port, PARAM_URI);
      assert.equal(noToken.status, 401);

      // 2. 错误 Token → 401
      const badToken = await get(port, `${PARAM_URI}&token=wrong`);
      assert.equal(badToken.status, 401);

      // 3. 正确 Token（查询串） → 参数闸门放行，进入 URL 校验 → 400
      const goodToken = await get(port, `${PARAM_URI}&token=s3cret-token`);
      assert.equal(goodToken.status, 400);

      // 4. 正确 Token（Bearer 头） → 同样放行
      const bearer = await get(port, PARAM_URI, { Authorization: 'Bearer s3cret-token' });
      assert.equal(bearer.status, 400);
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('服务端错误只回显通用提示，不泄漏内部实现细节', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-srv-'));
    const configFile = path.join(dir, 'config.yaml');
    // subscriptions 被写成字符串 → 引擎内部抛 TypeError，用于验证 500 分支不回显细节
    fs.writeFileSync(configFile, 'logLevel: silent\nsubscriptions: "not-an-array"\n', 'utf-8');
    const { server, port } = await startTestServer({ host: '127.0.0.1', configPath: configFile });
    try {
      const res = await get(port, '/sub');
      assert.equal(res.status, 500);
      assert.ok(!/TypeError|is not a function|undefined/.test(res.body), `内部细节被回显: ${res.body}`);
      assert.match(res.body, /See server logs/);
    } finally {
      server.close();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
