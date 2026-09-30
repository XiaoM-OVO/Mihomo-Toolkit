const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getTransportSni,
  getTransportHost,
  getTransportPath,
  getTransportAuthKey,
  injectTransportHost,
  getTransportType
} = require('../src/core/transport');
const { getNodeFingerprint, dedupeNodes } = require('../src/core/dedupe');
const { fissionNode } = require('../src/core/fission');

test('🚇 Transport 模块 - getTransportSni / getTransportHost 提取', () => {
  // 1. SNI 提取
  assert.equal(getTransportSni({ servername: 'sni.com' }), 'sni.com');
  assert.equal(getTransportSni({ sni: 'sni2.com' }), 'sni2.com');
  assert.equal(getTransportSni({ peer: 'peer.com' }), 'peer.com');
  assert.equal(getTransportSni({ 'reality-opts': { 'server-name': 'reality.com' } }), 'reality.com');

  // 2. ws Host 提取
  const wsProxy = { 'ws-opts': { headers: { Host: 'ws.com' } } };
  assert.equal(getTransportHost(wsProxy), 'ws.com');

  // 3. httpupgrade Host 提取
  const upgradeProxy = { 'httpupgrade-opts': { headers: { Host: 'upgrade.com' } } };
  assert.equal(getTransportHost(upgradeProxy), 'upgrade.com');

  // 4. h2 Host 提取 (数组与字符串)
  const h2ProxyArr = { 'h2-opts': { host: ['h2.com'] } };
  assert.equal(getTransportHost(h2ProxyArr), 'h2.com');
  const h2ProxyStr = { 'h2-opts': { host: 'h2-single.com' } };
  assert.equal(getTransportHost(h2ProxyStr), 'h2-single.com');

  // 5. 顶层 host 兜底
  assert.equal(getTransportHost({ host: 'generic.com' }), 'generic.com');
});

test('🚇 Transport 模块 - getTransportPath 服务路径提取', () => {
  assert.equal(getTransportPath({ 'ws-opts': { path: '/ws-path' } }), '/ws-path');
  assert.equal(getTransportPath({ 'grpc-opts': { 'grpc-service-name': 'my-grpc-service' } }), 'my-grpc-service');
  assert.equal(getTransportPath({ 'h2-opts': { path: '/h2-path' } }), '/h2-path');
  assert.equal(getTransportPath({ 'httpupgrade-opts': { path: '/upgrade-path' } }), '/upgrade-path');
  assert.equal(getTransportPath({}), '');
});

test('🚇 Transport 模块 - getTransportAuthKey 鉴权凭证提取', () => {
  assert.equal(getTransportAuthKey({ uuid: 'u-123' }), 'u-123');
  assert.equal(getTransportAuthKey({ password: 'p-456' }), 'p-456');
  assert.equal(getTransportAuthKey({ 'reality-opts': { 'public-key': 'pbk-789' } }), 'pbk-789');
  assert.equal(getTransportAuthKey({}), '');
});

test('🚇 Transport 模块 - injectTransportHost 智能注入与补全', () => {
  // 1. ws 补全 Host
  const wsNode = { type: 'vless', network: 'ws', server: '1.1.1.1' };
  injectTransportHost(wsNode, 'origin.domain.com');
  assert.equal(wsNode.servername, 'origin.domain.com');
  assert.equal(wsNode['ws-opts'].headers.Host, 'origin.domain.com');

  // 2. httpupgrade 补全 Host
  const upgradeNode = { type: 'vless', network: 'httpupgrade', server: '1.1.1.1' };
  injectTransportHost(upgradeNode, 'origin.domain.com');
  assert.equal(upgradeNode.servername, 'origin.domain.com');
  assert.equal(upgradeNode['httpupgrade-opts'].headers.Host, 'origin.domain.com');

  // 3. h2 补全 host 数组
  const h2Node = { type: 'vmess', network: 'h2', server: '1.1.1.1' };
  injectTransportHost(h2Node, 'origin.domain.com');
  assert.equal(h2Node.servername, 'origin.domain.com');
  assert.deepEqual(h2Node['h2-opts'].host, ['origin.domain.com']);

  // 4. 不覆写已存在的 Host / SNI
  const customWsNode = {
    type: 'vless',
    network: 'ws',
    server: '1.1.1.1',
    servername: 'custom-sni.com',
    'ws-opts': { headers: { Host: 'custom-host.com' } }
  };
  injectTransportHost(customWsNode, 'origin.domain.com');
  assert.equal(customWsNode.servername, 'custom-sni.com');
  assert.equal(customWsNode['ws-opts'].headers.Host, 'custom-host.com');
});

test('🚇 Transport 模块 - getTransportType 传输层类型标识', () => {
  assert.equal(getTransportType({ network: 'ws' }), 'WS');
  assert.equal(getTransportType({ network: 'grpc' }), 'GRPC');
  assert.equal(getTransportType({ network: 'h2' }), 'H2');
  assert.equal(getTransportType({ network: 'httpupgrade' }), 'HTTPUPGRADE');
  assert.equal(getTransportType({ network: 'tcp' }), '');
  assert.equal(getTransportType({ type: 'hysteria2' }), 'QUIC');
  assert.equal(getTransportType({ type: 'tuic' }), 'QUIC');
  assert.equal(getTransportType({ type: 'ss' }), '');
});

test('🚇 Transport 集成 - 指纹去重全协议识别 (H2 / HttpUpgrade / Reality)', () => {
  // H2: 路径不同应视为不同节点
  const h2NodeA = { server: '1.2.3.4', port: 443, type: 'vless', network: 'h2', 'h2-opts': { path: '/p1' } };
  const h2NodeB = { server: '1.2.3.4', port: 443, type: 'vless', network: 'h2', 'h2-opts': { path: '/p2' } };
  assert.notEqual(getNodeFingerprint(h2NodeA), getNodeFingerprint(h2NodeB));

  // HttpUpgrade: Host 不同应视为不同节点
  const upNodeA = { server: '1.2.3.4', port: 443, type: 'vless', network: 'httpupgrade', 'httpupgrade-opts': { headers: { Host: 'a.com' } } };
  const upNodeB = { server: '1.2.3.4', port: 443, type: 'vless', network: 'httpupgrade', 'httpupgrade-opts': { headers: { Host: 'b.com' } } };
  assert.notEqual(getNodeFingerprint(upNodeA), getNodeFingerprint(upNodeB));

  // Reality: 公钥不同应视为不同节点
  const realNodeA = { server: '1.2.3.4', port: 443, type: 'vless', 'reality-opts': { 'public-key': 'key-1' } };
  const realNodeB = { server: '1.2.3.4', port: 443, type: 'vless', 'reality-opts': { 'public-key': 'key-2' } };
  assert.notEqual(getNodeFingerprint(realNodeA), getNodeFingerprint(realNodeB));

  const deduped = dedupeNodes([h2NodeA, h2NodeB, upNodeA, upNodeB, realNodeA, realNodeB]);
  assert.equal(deduped.length, 6);
});

test('🚇 Transport 集成 - Fission 裂变在 H2 / HttpUpgrade 下注入验证', () => {
  const h2Proxy = {
    name: '🇯🇵 日本 H2',
    server: 'jp.domain.com',
    port: 443,
    type: 'vless',
    network: 'h2'
  };

  const fissions = fissionNode(h2Proxy, ['1.1.1.1', '2.2.2.2'], { fissionMaxNodes: 2 });
  assert.equal(fissions.length, 2);
  // 主节点与克隆节点均应正确注入 servername 与 h2-opts.host
  assert.equal(fissions[0].server, '1.1.1.1');
  assert.equal(fissions[0].servername, 'jp.domain.com');
  assert.deepEqual(fissions[0]['h2-opts'].host, ['jp.domain.com']);

  assert.equal(fissions[1].server, '2.2.2.2');
  assert.equal(fissions[1].servername, 'jp.domain.com');
  assert.deepEqual(fissions[1]['h2-opts'].host, ['jp.domain.com']);
});
