/**
 * 常驻服务安全姿态回归测试 (Server Security Posture)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dnsPromises = require('node:dns').promises;
const { startServer, isLoopbackHost, safeTokenEqual, getClientIp, resolveClientIp, isHostAllowed, resolveRequestHosts } = require('../../src/targets/server');
const { normalizeProxyRules, isTrustedProxy } = require('../../src/infra/ip');
const { hardenRemoteConfig } = require('../../src/core/security/remote-config');
const { readBodyWithLimit } = require('../../src/io/fetcher');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-srv-'));
  const subFile = path.join(dir, 'nodes.yaml');
  fs.writeFileSync(subFile, NODE_SUB, 'utf-8');
  const configFile = path.join(dir, 'config.yaml');
  fs.writeFileSync(configFile, `logLevel: silent\n${extraConfig}subscriptions:\n  - url: ${JSON.stringify(subFile)}\n    tag: LOCAL\n`, 'utf-8');
  return { dir, configFile };
}

async function startTestServer(options = {}) {
  const originalAuthToken = process.env.AUTH_TOKEN;
  if (!options.envAuthToken) {
    delete process.env.AUTH_TOKEN;
  }
  const server = startServer({ port: 0, logger: silentLogger, ...options });
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  const originalClose = server.close.bind(server);
  server.close = function(cb) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    if (originalAuthToken !== undefined) {
      process.env.AUTH_TOKEN = originalAuthToken;
    }
    return originalClose(cb);
  };
  return { server, port: server.address().port };
}

function get(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
        headers: { Connection: 'close', ...headers },
        agent: false
      },
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

const PARAM_URI = '/sub?config=http%3A%2F%2F127.0.0.1%3A1%2Fx.yaml';

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

describe('【Security】常驻服务安全姿态与防御 (server-security)', () => {
  describe('stream-limit - 响应体流式限长 [M-3 内存耗尽防护]', () => {
    it('readBodyWithLimit - 未超限时正常聚合', async () => {
      const text = await readBodyWithLimit(fakeResponse(['hello', ' ', 'world']), 64);
      assert.equal(text, 'hello world');
    });

    it('readBodyWithLimit - 超过上限时立即中止并抛出不可重试错误', async () => {
      await assert.rejects(
        () => readBodyWithLimit(fakeResponse(['a'.repeat(50), 'b'.repeat(50)]), 60),
        (err) => {
          assert.match(err.message, /too large/i);
          assert.equal(err.retryable, false);
          return true;
        }
      );
    });

    it('readBodyWithLimit - Content-Length 已声明超限时不读取正文', async () => {
      await assert.rejects(
        () => readBodyWithLimit(fakeResponse(['x'.repeat(10)], { 'content-length': '1048576' }), 1024),
        (err) => {
          assert.match(err.message, /too large/i);
          return true;
        }
      );
    });

    it('readBodyWithLimit - maxBytes 为 0 时不做限制 (向后兼容)', async () => {
      const text = await readBodyWithLimit(fakeResponse(['unlimited']), 0);
      assert.equal(text, 'unlimited');
    });
  });

  describe('remote-trust - 远程配置信任边界 [C-2 ?config= Hardening]', () => {
    it('hardenRemoteConfig - 拒绝远程配置引用本地路径订阅源 (防任意文件读取)', () => {
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

    it('hardenRemoteConfig - 放行 http(s) 订阅源并剥夺本机资源与 DNS 控制面字段', () => {
      const r = hardenRemoteConfig({
        subscriptions: [{ url: 'https://example.com/sub.yaml' }, { uri: 'vless://x@1.2.3.4:443' }],
        servicesConfigFile: './evil.js',
        fetchProxyPort: 6379,
        fetchProxyStrategy: 'proxy',
        dnsListen: '0.0.0.0:53',
        dnsAllowNonLoopback: true,
        dnsProxy: ['https://evil.example.com/dns-query'],
        nameserverPolicy: { 'paypal.com': 'https://evil.example.com/dns-query' },
        hosts: { 'github.com': '6.6.6.6' },
        enableRegionHashLB: true
      });
      assert.equal(r.ok, true);
      assert.deepEqual(
        r.strippedKeys.sort(),
        ['dnsAllowNonLoopback', 'dnsListen', 'dnsProxy', 'fetchProxyPort', 'fetchProxyStrategy',
         'hosts', 'nameserverPolicy', 'servicesConfigFile'].sort()
      );
      for (const k of ['servicesConfigFile', 'fetchProxyPort', 'dnsListen', 'dnsProxy', 'nameserverPolicy', 'hosts']) {
        assert.equal(r.config[k], undefined, `${k} 未被剥夺`);
      }
      assert.equal(r.config.enableRegionHashLB, true);
      assert.equal(r.config.subscriptions.length, 2);
    });

    it('hardenRemoteConfig - 拒绝内联 uri 的非节点协议，放行解析器认识的 scheme 与纯 base64', () => {
      for (const bad of [
        'file:///etc/passwd',
        'javascript:alert(1)',
        'data:text/yaml,proxies%3A%20%5B%5D'
      ]) {
        const r = hardenRemoteConfig({ subscriptions: [{ uri: bad }] });
        assert.equal(r.ok, false, `非法内联 uri scheme 未被拒绝: ${bad}`);
      }
      for (const good of [
        'vless://x@1.2.3.4:443',
        'trojan://pass@1.2.3.4:443#n',
        'aGVsbG8=' // 纯 base64 订阅块：无 scheme，照常放行
      ]) {
        const r = hardenRemoteConfig({ subscriptions: [{ uri: good }] });
        assert.equal(r.ok, true, `合法内联 uri 被误拒: ${good}`);
      }
    });

    it('hardenRemoteConfig - 图标字段只允许 https 公网地址（阻断客户端侧内网探测）', () => {
      const r = hardenRemoteConfig({
        groupIcons: {
          自动选择: 'http://127.0.0.1:8080/x.png',
          漏网之鱼: 'https://cdn.example.com/y.png',
          广告拦截: { emoji: '🚫', icon: 'http://192.168.1.5/x.png' },
          流媒体: { icon: 'http://localhost/x.png' }
        },
        iconRepoKoolson: 'http://10.0.0.5/icons/',
        customServices: { streaming: { netflix: { name: 'Netflix', icon: 'http://169.254.169.254/i.png' } } }
      });
      assert.equal(r.ok, true);
      assert.equal(r.config.groupIcons['自动选择'], undefined, '回环图标未被丢弃');
      assert.equal(r.config.groupIcons['漏网之鱼'], 'https://cdn.example.com/y.png', '合法 https 图标被误删');
      assert.equal(r.config.groupIcons['广告拦截'].icon, undefined, '内网图标未被丢弃');
      assert.equal(r.config.groupIcons['广告拦截'].emoji, '🚫', 'emoji 展示应保留');
      assert.equal(r.config.groupIcons['流媒体'], undefined, '单 label 主机名图标未被丢弃');
      assert.equal(r.config.iconRepoKoolson, undefined, '内网图标仓库未被丢弃');
      assert.equal(r.config.customServices.streaming.netflix.icon, undefined, '自定义服务内网图标未被丢弃');
      assert.equal(r.config.customServices.streaming.netflix.name, 'Netflix', '服务定义本体应保留');
    });

    it('isLoopbackHost & safeTokenEqual - 回环判定与恒定时间防时序攻击比较', () => {
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

  describe('posture - 常驻服务安全姿态与防爆盾 [C-3]', () => {
    it('server - 非回环监听且无 authToken：拒绝参数化请求，但本地配置订阅仍可用 [C-3]', async () => {
      const { dir, configFile } = makeFixture();
      const { server, port } = await startTestServer({ host: '0.0.0.0', configPath: configFile });
      try {
        const viaConfig = await get(port, PARAM_URI);
        assert.equal(viaConfig.status, 403, '?config= 未被拒绝');
        assert.match(viaConfig.body, /authToken/);

        const viaUrl = await get(port, '/sub?url=https%3A%2F%2Fexample.com%2Fsub');
        assert.equal(viaUrl.status, 403, '?url= 未被拒绝');

        const bare = await get(port, '/sub');
        assert.equal(bare.status, 200);
        assert.match(bare.body, /proxy-groups/);

        const health = await get(port, '/healthz');
        assert.equal(health.status, 200);
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('server - 回环监听下参数闸门放行 (无效 URL 返回 400 而非 403)', async () => {
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

    it('server - 参数化入口做 DNS 后置 SSRF 预检：域名解析至内网一律 400', async () => {
      const { dir, configFile } = makeFixture();
      const { server, port } = await startTestServer({ host: '127.0.0.1', configPath: configFile });
      const origResolve4 = dnsPromises.resolve4;
      const origResolve6 = dnsPromises.resolve6;
      dnsPromises.resolve4 = async () => ['10.9.9.9'];
      dnsPromises.resolve6 = async () => [];
      try {
        // ?config= 入口：域名合法但解析到私网，同步字面量判断会放行，必须由异步预检拦下
        const viaConfig = await get(port, `/sub?config=${encodeURIComponent('http://rebind-cfg.internal/x.yaml')}`);
        assert.equal(viaConfig.status, 400, '?config= 解析至内网的域名未被预检拦截');
        assert.match(viaConfig.body, /disallowed config URL/);

        const viaUrl = await get(port, `/sub?url=${encodeURIComponent('http://rebind-sub.internal/nodes.yaml')}`);
        assert.equal(viaUrl.status, 400, '?url= 解析至内网的域名未被预检拦截');
        assert.match(viaUrl.body, /disallowed subscription URL/);
      } finally {
        dnsPromises.resolve4 = origResolve4;
        dnsPromises.resolve6 = origResolve6;
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('server - 配置 authToken 后：非回环监听放行参数入口，但必须先通过鉴权', async () => {
      const { dir, configFile } = makeFixture('authToken: "s3cret-token"\n');
      const { server, port } = await startTestServer({ host: '0.0.0.0', configPath: configFile });
      try {
        const noToken = await get(port, PARAM_URI);
        assert.equal(noToken.status, 401);

        const badToken = await get(port, `${PARAM_URI}&token=wrong`);
        assert.equal(badToken.status, 401);

        const goodToken = await get(port, `${PARAM_URI}&token=s3cret-token`);
        assert.equal(goodToken.status, 400);

        const bearer = await get(port, PARAM_URI, { Authorization: 'Bearer s3cret-token' });
        assert.equal(bearer.status, 400);
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('server - 服务端错误只回显通用提示，不泄漏内部实现细节', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-srv-'));
      const configFile = path.join(dir, 'config.yaml');
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

    it('getClientIp - 正确提取反代头与 IPv4 映射', () => {
      assert.equal(getClientIp({ headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1' } }), '203.0.113.195');
      assert.equal(getClientIp({ headers: { 'x-real-ip': '198.51.100.2' } }), '198.51.100.2');
      assert.equal(getClientIp({ headers: {}, socket: { remoteAddress: '::ffff:192.0.2.1' } }), '192.0.2.1');
      assert.equal(getClientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
    });

    describe('client-ip - 反代信任边界（XFF 防伪造）', () => {
      it('normalizeProxyRules - 归一化精确 IP 与 CIDR，忽略非法条目', () => {
        assert.deepEqual(normalizeProxyRules(['127.0.0.1', '10.0.0.0/8']), ['127.0.0.1', '10.0.0.0/8']);
        assert.deepEqual(normalizeProxyRules('::ffff:127.0.0.1, 192.168.1.0/24'), ['127.0.0.1', '192.168.1.0/24']);
        assert.deepEqual(normalizeProxyRules(['not-an-ip', '999.1.1.1']), []);
        assert.deepEqual(normalizeProxyRules(''), []);
      });

      it('resolveClientIp - 未受信直连一律忽略伪造转发头', () => {
        const req = { headers: { 'x-forwarded-for': '203.0.113.7' }, socket: { remoteAddress: '198.51.100.50' } };
        assert.equal(resolveClientIp(req, []), '198.51.100.50');
        assert.equal(resolveClientIp(req, ['10.0.0.0/8']), '198.51.100.50');
      });

      it('resolveClientIp - 受信直连按右向左跳过代理取真实客户端', () => {
        const rules = normalizeProxyRules(['127.0.0.1']);
        assert.equal(
          resolveClientIp(
            { headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.9, 127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } },
            rules
          ),
          '198.51.100.9',
          '最左侧为客户端伪造项，应取最右侧不可信地址'
        );
        assert.equal(
          resolveClientIp({ headers: { 'x-real-ip': '203.0.113.7' }, socket: { remoteAddress: '::ffff:127.0.0.1' } }, rules),
          '203.0.113.7'
        );
        assert.equal(resolveClientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, rules), '127.0.0.1');
      });

      it('isTrustedProxy - 精确与 IPv4 CIDR 匹配', () => {
        assert.equal(isTrustedProxy('127.0.0.1', ['127.0.0.1']), true);
        assert.equal(isTrustedProxy('10.1.2.3', ['10.0.0.0/8']), true);
        assert.equal(isTrustedProxy('192.168.1.5', ['10.0.0.0/8']), false);
        assert.equal(isTrustedProxy('not-an-ip', ['10.0.0.0/8']), false);
      });
    });

    it('server - ?refresh=1 绕过缓存并同步更新，防爆盾在冷却期内拦截频繁请求', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-srv-'));
      const subFile = path.join(dir, 'nodes.yaml');
      fs.writeFileSync(subFile, NODE_SUB, 'utf-8');
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `logLevel: silent\nenableNodeRename: false\nrefreshCooldown: 1\nenableWarmup: false\nsubscriptions:\n  - url: ${JSON.stringify(subFile)}\n    tag: LOCAL\n`, 'utf-8');

      const { server, port } = await startTestServer({ host: '127.0.0.1', configPath: configFile });
      try {
        const res1 = await get(port, '/sub');
        assert.equal(res1.status, 200);
        assert.match(res1.body, /香港 01/);

        const UPDATED_SUB = NODE_SUB.replace('香港 01', '香港 02 (Updated)');
        fs.writeFileSync(subFile, UPDATED_SUB, 'utf-8');

        const res2 = await get(port, '/sub');
        assert.equal(res2.status, 200);
        assert.match(res2.body, /香港 01/);
        assert.ok(!res2.body.includes('香港 02'));

        const res3 = await get(port, '/sub?refresh=1');
        assert.equal(res3.status, 200);
        assert.match(res3.body, /香港 02/);

        fs.writeFileSync(subFile, NODE_SUB.replace('香港 01', '香港 03 (Spam)'), 'utf-8');
        const res4 = await get(port, '/sub?refresh=1');
        assert.equal(res4.status, 200);
        assert.match(res4.body, /香港 02/);
        assert.ok(!res4.body.includes('香港 03'));

        await new Promise(r => setTimeout(r, 1100));
        const res5 = await get(port, '/sub?refresh=1');
        assert.equal(res5.status, 200);
        assert.match(res5.body, /香港 03/);
      } finally {
        server.close();
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('server - 后台定时静默预热 (autoRefreshInterval) 正确挂载与安全关闭', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-srv-'));
      const subFile = path.join(dir, 'nodes.yaml');
      fs.writeFileSync(subFile, NODE_SUB, 'utf-8');
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `logLevel: silent\nenableWarmup: false\nautoRefreshInterval: 3600\nsubscriptions:\n  - url: ${JSON.stringify(subFile)}\n    tag: LOCAL\n`, 'utf-8');

      const { server } = await startTestServer({ host: '127.0.0.1', configPath: configFile });
      try {
        assert.equal(server.listening, true);
      } finally {
        server.close();
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('access-log - 请求访问日志成对与鉴权失败原因', () => {
    it('server - 请求行/完成行带配对序号，未授权请求只保留拒绝日志', async () => {
      const logs = { info: [], warn: [], debug: [] };
      const captureLogger = {
        info(msg) { logs.info.push(String(msg)); },
        warn(msg) { logs.warn.push(String(msg)); },
        error(msg) { logs.warn.push(String(msg)); },
        debug(msg) { logs.debug.push(String(msg)); },
        success() {},
        log() {},
        child() { return this; },
        isLevelEnabled() { return true; }
      };
      const { dir, configFile } = makeFixture('authToken: "s3cret-token"\n');
      const { server, port } = await startTestServer({ host: '127.0.0.1', configPath: configFile, logger: captureLogger });
      try {
        const unauthorized = await get(port, '/sub');
        assert.equal(unauthorized.status, 401);
        await new Promise(resolve => setTimeout(resolve, 20));

        const authorized = await get(port, '/sub?token=s3cret-token');
        assert.equal(authorized.status, 200);
        await new Promise(resolve => setTimeout(resolve, 20));

        assert.equal(logs.info.filter(msg => msg.includes('收到订阅请求')).length, 1, '未授权请求不得输出请求行');
        const rejectLine = logs.warn.find(msg => msg.includes('拒绝未授权访问'));
        assert.ok(rejectLine, '必须记录鉴权拒绝日志');
        assert.match(rejectLine, /GET/);
        assert.match(rejectLine, /未提供凭据/);
        assert.ok(!rejectLine.includes('s3cret-token'), '日志不得回显凭据');

        const completeLine = logs.info.find(msg => msg.includes('请求完成'));
        assert.ok(completeLine, '成功响应必须输出完成行');
        assert.match(completeLine, /#0002/);
        assert.match(completeLine, /200/);
        assert.match(completeLine, /X-Cache=/);
        assert.match(completeLine, /ms/);

        const rejectFinish = logs.debug.find(msg => msg.includes('请求结束') && msg.includes('401'));
        assert.ok(rejectFinish, '失败请求结束行应存在于 debug');
        assert.match(rejectFinish, /#0001/);
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('server - 配置 trustedProxies 后才采信 X-Forwarded-For', async () => {
      const messages = [];
      const captureLogger = {
        info(msg) { messages.push(String(msg)); },
        warn() {}, error() {}, debug() {}, success() {}, log() {},
        child() { return this; },
        isLevelEnabled() { return true; }
      };
      const { dir, configFile } = makeFixture('trustedProxies:\n  - "127.0.0.1"\n');
      const { server, port } = await startTestServer({ host: '127.0.0.1', configPath: configFile, logger: captureLogger });
      try {
        await get(port, '/sub', { 'X-Forwarded-For': '203.0.113.7' });
        await new Promise(resolve => setTimeout(resolve, 20));
        const requestLine = messages.find(msg => msg.includes('收到订阅请求'));
        assert.ok(requestLine, '必须输出请求行');
        assert.match(requestLine, /203\.0\.113\.7/);
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('host-policy - Host 白名单与缓存键收敛 [P1 缓存投毒防护]', () => {
    it('resolveRequestHosts - 白名单精确/通配匹配、可信边界与排序收敛', () => {
      const allowed = ['*.svc.test', 'exact.example.com'];
      assert.equal(isHostAllowed('a.svc.test', allowed), true);
      assert.equal(isHostAllowed('svc.test', allowed), true, '通配规则应含裸域');
      assert.equal(isHostAllowed('a.b.svc.test', allowed), true, '通配规则应含任意级子域');
      assert.equal(isHostAllowed('evil.test', allowed), false);
      assert.equal(isHostAllowed('a.svc.test.evil.test', allowed), false);
      assert.equal(isHostAllowed('exact.example.com', allowed), true);
      assert.equal(isHostAllowed('sub.exact.example.com', allowed), false, '精确规则不得匹配子域');

      const loopback = resolveRequestHosts({ rawHost: 'b.svc.test,a.svc.test', allowedHosts: [], boundLoopback: true });
      assert.deepEqual(loopback.hosts, ['a.svc.test', 'b.svc.test'], '回环监听保持兼容且排序收敛');
      assert.equal(loopback.reason, null);

      const untrusted = resolveRequestHosts({ rawHost: 'evil.test', allowedHosts: [], boundLoopback: false });
      assert.deepEqual(untrusted.hosts, [], '非回环监听且无白名单必须忽略 Host');
      assert.equal(untrusted.reason, 'untrusted-host');

      const authed = resolveRequestHosts({ rawHost: 'auto.example.com', allowedHosts: [], boundLoopback: false, authenticated: true });
      assert.deepEqual(authed.hosts, ['auto.example.com'], '已鉴权请求应保留 Host 自动嗅探');
      assert.equal(authed.reason, null);

      const authedButWhitelisted = resolveRequestHosts({ rawHost: 'evil.test', allowedHosts: allowed, boundLoopback: false, authenticated: true });
      assert.deepEqual(authedButWhitelisted.hosts, [], '配置白名单时鉴权不放大 Host 权限');

      const filtered = resolveRequestHosts({ rawHost: 'a.svc.test,evil.test', allowedHosts: allowed, boundLoopback: false });
      assert.deepEqual(filtered.hosts, ['a.svc.test']);
      assert.deepEqual(filtered.rejected, ['evil.test']);
      assert.equal(filtered.reason, 'not-allowed');

      // 同一 Host 集合的请求头顺序差异不得改变合并结果（否则会分裂缓存键）
      const orderA = resolveRequestHosts({ rawHost: 'a.svc.test,b.svc.test', allowedHosts: allowed, boundLoopback: true });
      const orderB = resolveRequestHosts({ rawHost: 'b.svc.test,a.svc.test', allowedHosts: allowed, boundLoopback: true });
      assert.deepEqual(orderA.hosts, orderB.hosts);
    });

    it('server - allowedHosts 白名单：仅命中规则的 Host 注入直连规则', async () => {
      const { dir, configFile } = makeFixture('allowedHosts:\n  - "*.svc.test"\n');
      const { server, port } = await startTestServer({ host: '127.0.0.1', configPath: configFile });
      try {
        const hit = await get(port, '/sub', { Host: 'a.svc.test' });
        assert.equal(hit.status, 200);
        assert.match(hit.body, /DOMAIN,a\.svc\.test,DIRECT/);

        const miss = await get(port, '/sub', { Host: 'evil.test' });
        assert.equal(miss.status, 200);
        assert.ok(!miss.body.includes('evil.test'), '白名单外 Host 不得进入产物');
      } finally {
        server.close();
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('server - 非回环监听且未配置 allowedHosts：请求 Host 不参与推导（fail-closed）', async () => {
      const { dir, configFile } = makeFixture();
      const { server, port } = await startTestServer({ host: '0.0.0.0', configPath: configFile });
      try {
        const res = await get(port, '/sub', { Host: 'evil.test' });
        assert.equal(res.status, 200);
        assert.ok(!res.body.includes('evil.test'), '未配置白名单时非回环监听必须忽略 Host');
      } finally {
        server.close();
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('server - 非回环监听 + authToken：已鉴权请求仍按 Host 自动嗅探', async () => {
      const { dir, configFile } = makeFixture('authToken: "s3cret-token"\n');
      const { server, port } = await startTestServer({ host: '0.0.0.0', configPath: configFile });
      try {
        const authed = await get(port, '/sub', {
          Host: 'auto.example.com',
          Authorization: 'Bearer s3cret-token'
        });
        assert.equal(authed.status, 200);
        assert.match(authed.body, /DOMAIN,auto\.example\.com,DIRECT/, '已鉴权请求应保留 Host 自动嗅探');

        const anonymous = await get(port, '/sub', { Host: 'evil.test' });
        assert.equal(anonymous.status, 401);
      } finally {
        server.close();
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
