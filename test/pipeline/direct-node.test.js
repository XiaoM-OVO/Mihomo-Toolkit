const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isDirectNodeSub,
  buildDirectProxy,
  resolveDialerProxy,
  resolveShouldKeepName,
  resolveSubType
} = require('../../src/pipeline/direct-node');

describe('【Pipeline】结构化单节点声明与归一化 (direct-node)', () => {
  it('isDirectNodeSub - 边界判定与结构识别', () => {
    assert.equal(isDirectNodeSub(null), false);
    assert.equal(isDirectNodeSub(undefined), false);
    assert.equal(isDirectNodeSub('string'), false);
    assert.equal(isDirectNodeSub(123), false);
    assert.equal(isDirectNodeSub([]), false);
    assert.equal(isDirectNodeSub({ url: 'https://example.com' }), false);
    assert.equal(isDirectNodeSub({ uri: 'ss://abc@1.1.1.1:8388' }), false);

    assert.equal(isDirectNodeSub({ server: '198.51.100.1', port: 443 }), true);
    assert.equal(isDirectNodeSub({ proxy: { server: '198.51.100.1', port: 443 } }), true);
  });

  it('buildDirectProxy - 剥离 Toolkit 元数据并生成标准代理对象', () => {
    const sub = {
      tag: '我的节点',
      keepName: true,
      dialerProxy: '香港前置',
      groups: ['🚀 手动切换'],
      retry: 3,
      resetDay: 1,
      enabled: true,
      name: '自定义名称',
      type: 'SOCKS5',
      server: '  198.51.100.1  ',
      port: '1080',
      username: 'user',
      password: 'pwd',
      'client-fingerprint': 'chrome'
    };

    const proxy = buildDirectProxy(sub);
    assert.equal(proxy.name, '自定义名称');
    assert.equal(proxy.type, 'socks5');
    assert.equal(proxy.server, '198.51.100.1');
    assert.equal(proxy.port, 1080);
    assert.equal(proxy.username, 'user');
    assert.equal(proxy.password, 'pwd');
    assert.equal(proxy['client-fingerprint'], 'chrome');
    assert.equal(proxy['dialer-proxy'], '香港前置');

    // 确保 Toolkit 调度元字段不泄露到代理对象中
    assert.equal(proxy.tag, undefined);
    assert.equal(proxy.keepName, undefined);
    assert.equal(proxy.dialerProxy, undefined);
    assert.equal(proxy.groups, undefined);
    assert.equal(proxy.retry, undefined);
    assert.equal(proxy.resetDay, undefined);
    assert.equal(proxy.enabled, undefined);
  });

  it('buildDirectProxy - 嵌套 proxy 字段原样透传', () => {
    const rawProxy = {
      name: '嵌套代理',
      type: 'ss',
      server: '198.51.100.2',
      port: 8388,
      cipher: '2022-blake3-aes-128-gcm',
      password: 'pass'
    };
    const sub = {
      tag: '嵌套订阅',
      proxy: rawProxy
    };

    const result = buildDirectProxy(sub);
    assert.deepEqual(result, rawProxy);
    // 不得引用同一对象 (保持防御性拷贝)
    assert.notEqual(result, rawProxy);
  });

  it('buildDirectProxy - 缺省参数默认值回退', () => {
    const sub = {
      server: '198.51.100.3',
      port: 8080
    };
    const proxy = buildDirectProxy(sub);
    assert.equal(proxy.name, '198.51.100.3:8080');
    assert.equal(proxy.type, 'socks5');
    assert.equal(proxy.server, '198.51.100.3');
    assert.equal(proxy.port, 8080);
    assert.equal(proxy['dialer-proxy'], undefined);
  });

  it('resolveDialerProxy - 支持 dialerProxy 与 dialer-proxy 别名', () => {
    assert.equal(resolveDialerProxy(null), null);
    assert.equal(resolveDialerProxy({}), null);
    assert.equal(resolveDialerProxy({ dialerProxy: 'HK-01' }), 'HK-01');
    assert.equal(resolveDialerProxy({ 'dialer-proxy': 'JP-01' }), 'JP-01');
  });

  it('resolveShouldKeepName - 显式配置与直接节点默认推导', () => {
    // 显式配置具有最高优先级
    assert.equal(resolveShouldKeepName({ keepName: true }), true);
    assert.equal(resolveShouldKeepName({ keepName: false, name: '有名字' }), false);

    // 未配置 keepName 时：直接节点且显式声明了 name 默认保护
    assert.equal(resolveShouldKeepName({ server: '1.1.1.1', port: 80, name: '自建节点' }), true);
    // 未配置 keepName 且直接节点未声明 name 不保护 (交由模板统一命名)
    assert.equal(resolveShouldKeepName({ server: '1.1.1.1', port: 80 }), false);
    // 普通 URL 订阅未配置 keepName 默认不保护
    assert.equal(resolveShouldKeepName({ url: 'https://example.com' }), false);
  });

  it('resolveSubType - 正确识别 url / uri / node 类型', () => {
    assert.equal(resolveSubType({ url: 'https://example.com' }), 'url');
    assert.equal(resolveSubType({ uri: 'ss://...' }), 'uri');
    assert.equal(resolveSubType({ server: '1.1.1.1', port: 80 }), 'node');
    assert.equal(resolveSubType({}), 'node');
  });
});
