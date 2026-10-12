const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalEncode,
  getNodeFingerprint,
  dedupeNodes
} = require('../../src/core/dedupe');
const { markTrustedSynthetic } = require('../../src/core/node-trust');
const { runNodesPipeline } = require('../../src/pipeline/nodes');
const { runStrategyPipeline } = require('../../src/pipeline/strategy');

describe('【Security】协议感知去重与规范化指纹 (protocol-aware-dedupe)', () => {
  describe('1. 新增连接身份字段敏感性测试 (除该字段外完全相同的两个节点不应合并)', () => {
    it('Reality: short-id 不同不应合并', () => {
      const p1 = {
        name: 'VLESS Reality A',
        type: 'vless',
        server: '1.2.3.4',
        port: 443,
        uuid: 'uuid-1',
        tls: true,
        'reality-opts': { 'public-key': 'pk1', 'short-id': 'sid1' }
      };
      const p2 = {
        name: 'VLESS Reality B',
        type: 'vless',
        server: '1.2.3.4',
        port: 443,
        uuid: 'uuid-1',
        tls: true,
        'reality-opts': { 'public-key': 'pk1', 'short-id': 'sid2' }
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2));
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 2, 'Reality short-id 不同的两个节点绝不合并');
    });

    it('gRPC: grpc-service-name 或 mode 不同不应合并', () => {
      const p1 = {
        name: 'gRPC Node 1',
        type: 'vless',
        server: 'grpc.node.com',
        port: 443,
        network: 'grpc',
        uuid: 'uuid-1',
        'grpc-opts': { 'grpc-service-name': 'serviceA', mode: 'gun' }
      };
      const p2 = {
        name: 'gRPC Node 2',
        type: 'vless',
        server: 'grpc.node.com',
        port: 443,
        network: 'grpc',
        uuid: 'uuid-1',
        'grpc-opts': { 'grpc-service-name': 'serviceB', mode: 'gun' }
      };
      const p3 = {
        name: 'gRPC Node 3',
        type: 'vless',
        server: 'grpc.node.com',
        port: 443,
        network: 'grpc',
        uuid: 'uuid-1',
        'grpc-opts': { 'grpc-service-name': 'serviceA', mode: 'multi' }
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2));
      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p3));
      const deduped = dedupeNodes([p1, p2, p3]);
      assert.equal(deduped.length, 3, 'gRPC service-name 或 mode 不同的节点绝不合并');
    });

    it('Shadowsocks: plugin 与 plugin-opts 不同不应合并', () => {
      const p1 = {
        name: 'SS Node 1',
        type: 'ss',
        server: 'ss.node.com',
        port: 8388,
        cipher: 'aes-128-gcm',
        password: 'pass',
        plugin: 'v2ray-plugin',
        'plugin-opts': { mode: 'websocket', host: 'a.com' }
      };
      const p2 = {
        name: 'SS Node 2',
        type: 'ss',
        server: 'ss.node.com',
        port: 8388,
        cipher: 'aes-128-gcm',
        password: 'pass',
        plugin: 'v2ray-plugin',
        'plugin-opts': { mode: 'websocket', host: 'b.com' }
      };
      const p3 = {
        name: 'SS Node 3',
        type: 'ss',
        server: 'ss.node.com',
        port: 8388,
        cipher: 'aes-128-gcm',
        password: 'pass',
        plugin: 'obfs-local',
        'plugin-opts': { mode: 'websocket', host: 'a.com' }
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2));
      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p3));
      const deduped = dedupeNodes([p1, p2, p3]);
      assert.equal(deduped.length, 3, 'SS plugin 或 plugin-opts 不同的节点绝不合并');
    });

    it('Hysteria2: obfs, obfs-password 或 ports 不同不应合并', () => {
      const base = {
        name: 'Hy2 Node',
        type: 'hysteria2',
        server: 'hy2.node.com',
        port: 443,
        password: 'pass',
        obfs: 'salamander',
        'obfs-password': 'secret1',
        ports: '20000-30000'
      };
      const diffObfs = { ...base, obfs: 'other-obfs' };
      const diffSecret = { ...base, 'obfs-password': 'secret2' };
      const diffPorts = { ...base, ports: '40000-50000' };

      assert.notEqual(getNodeFingerprint(base), getNodeFingerprint(diffObfs));
      assert.notEqual(getNodeFingerprint(base), getNodeFingerprint(diffSecret));
      assert.notEqual(getNodeFingerprint(base), getNodeFingerprint(diffPorts));
      const deduped = dedupeNodes([base, diffObfs, diffSecret, diffPorts]);
      assert.equal(deduped.length, 4, 'Hysteria2 混淆或跳跃端口不同的节点绝不合并');
    });

    it('VLESS: flow 不同不应合并', () => {
      const p1 = {
        name: 'VLESS XTLS 1',
        type: 'vless',
        server: 'vless.node.com',
        port: 443,
        uuid: 'uuid-1',
        tls: true,
        flow: 'xtls-rprx-vision'
      };
      const p2 = {
        name: 'VLESS XTLS 2',
        type: 'vless',
        server: 'vless.node.com',
        port: 443,
        uuid: 'uuid-1',
        tls: true,
        flow: 'xtls-rprx-vision-udp443'
      };
      const p3 = {
        name: 'VLESS XTLS 3',
        type: 'vless',
        server: 'vless.node.com',
        port: 443,
        uuid: 'uuid-1',
        tls: true
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2));
      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p3));
      const deduped = dedupeNodes([p1, p2, p3]);
      assert.equal(deduped.length, 3, 'VLESS flow 不同的节点绝不合并');
    });

    it('TUIC: congestion-controller, udp-relay-mode 或 disable-sni 不同不应合并', () => {
      const base = {
        name: 'TUIC Node',
        type: 'tuic',
        server: 'tuic.node.com',
        port: 8443,
        uuid: 'uuid-1',
        password: 'pass',
        'congestion-controller': 'bbr',
        'udp-relay-mode': 'native',
        'disable-sni': false
      };
      const diffCc = { ...base, 'congestion-controller': 'cubic' };
      const diffRelay = { ...base, 'udp-relay-mode': 'quic' };
      const diffSni = { ...base, 'disable-sni': true };

      assert.notEqual(getNodeFingerprint(base), getNodeFingerprint(diffCc));
      assert.notEqual(getNodeFingerprint(base), getNodeFingerprint(diffRelay));
      assert.notEqual(getNodeFingerprint(base), getNodeFingerprint(diffSni));
      const deduped = dedupeNodes([base, diffCc, diffRelay, diffSni]);
      assert.equal(deduped.length, 4, 'TUIC 专有流控及转发模式不同的节点绝不合并');
    });

    it('TUIC: 仅 password 改变而 uuid 相同的节点绝不合并', () => {
      const p1 = {
        name: 'TUIC Pass A',
        type: 'tuic',
        server: 'tuic.node.com',
        port: 8443,
        uuid: 'same-uuid-1234',
        password: 'password-AAA'
      };
      const p2 = {
        name: 'TUIC Pass B',
        type: 'tuic',
        server: 'tuic.node.com',
        port: 8443,
        uuid: 'same-uuid-1234',
        password: 'password-BBB'
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2), '仅密码不同的 TUIC 节点指纹必须不同');
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 2, '仅密码不同的 TUIC 节点绝不合并');
    });

    it('TLS: alpn 差异不应合并', () => {
      const p1 = {
        name: 'Trojan ALPN 1',
        type: 'trojan',
        server: 'trojan.node.com',
        port: 443,
        password: 'pass',
        tls: true,
        alpn: ['h2', 'http/1.1']
      };
      const p2 = {
        name: 'Trojan ALPN 2',
        type: 'trojan',
        server: 'trojan.node.com',
        port: 443,
        password: 'pass',
        tls: true,
        alpn: ['http/1.1']
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2));
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 2, 'TLS ALPN 不同的节点绝不合并');
    });

    it('不透明凭据大小写敏感性: username 仅大小写不同绝不合并', () => {
      const p1 = {
        name: 'SOCKS User Upper',
        type: 'socks5',
        server: 'socks.node.com',
        port: 1080,
        username: 'Alice',
        password: 'Password123'
      };
      const p2 = {
        name: 'SOCKS User Lower',
        type: 'socks5',
        server: 'socks.node.com',
        port: 1080,
        username: 'alice',
        password: 'Password123'
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2), '仅大小写不同的 username 指纹必须不同');
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 2, '仅大小写不同的 username 节点绝不合并');
    });

    it('不透明凭据大小写敏感性: Reality public-key 仅大小写不同绝不合并', () => {
      const p1 = {
        name: 'Reality Key Mixed',
        type: 'vless',
        server: 'real.node.com',
        port: 443,
        uuid: 'same-uuid',
        tls: true,
        'reality-opts': {
          'public-key': 'AbCdEfGhIjKlMnOpQrStUvWxYz',
          'short-id': 'a1b2'
        }
      };
      const p2 = {
        name: 'Reality Key Lower',
        type: 'vless',
        server: 'real.node.com',
        port: 443,
        uuid: 'same-uuid',
        tls: true,
        'reality-opts': {
          'public-key': 'abcdefghijklmnopqrstuvwxyz',
          'short-id': 'a1b2'
        }
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2), '仅大小写不同的 Reality public-key 指纹必须不同');
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 2, '仅大小写不同的 Reality public-key 节点绝不合并');
    });

    it('RFC 7301 ALPN 大小写敏感性: ALPN 仅大小写不同绝不合并', () => {
      const p1 = {
        name: 'ALPN Upper',
        type: 'trojan',
        server: 'alpn.domain.com',
        port: 443,
        password: 'p',
        alpn: ['H2']
      };
      const p2 = {
        name: 'ALPN Lower',
        type: 'trojan',
        server: 'alpn.domain.com',
        port: 443,
        password: 'p',
        alpn: ['h2']
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2), '仅大小写不同的 ALPN 指纹必须不同');
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 2, '仅大小写不同的 ALPN 节点绝不合并');
    });
  });

  describe('2. 嵌套对象与键乱序规范化测试 (语义相同但键乱序应合并)', () => {
    it('Shadowsocks plugin-opts 键顺序不同应得到相同指纹并合并', () => {
      const p1 = {
        name: 'SS Order 1',
        type: 'ss',
        server: 'ss.example.com',
        port: 8388,
        cipher: 'aes-128-gcm',
        password: 'secret',
        plugin: 'v2ray-plugin',
        'plugin-opts': {
          mode: 'websocket',
          host: 'server.com',
          path: '/ray',
          tls: 'true'
        }
      };
      const p2 = {
        name: 'SS Order 2',
        type: 'ss',
        server: 'ss.example.com',
        port: 8388,
        cipher: 'aes-128-gcm',
        password: 'secret',
        plugin: 'v2ray-plugin',
        'plugin-opts': {
          tls: 'true',
          path: '/ray',
          mode: 'websocket',
          host: 'server.com'
        }
      };

      assert.equal(getNodeFingerprint(p1), getNodeFingerprint(p2));
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 1, '键顺序不同的 plugin-opts 产生相同指纹并正确合并');
    });

    it('Shadowsocks 嵌套 plugin-opts 参数值不同绝不合并 (防 [object Object] 压平)', () => {
      const p1 = {
        name: 'SS Nested A',
        type: 'ss',
        server: 'ss.example.com',
        port: 8388,
        cipher: 'aes-128-gcm',
        password: 'pass',
        plugin: 'custom-plugin',
        'plugin-opts': {
          transport: { mode: 'ws', path: '/v1' },
          security: 'tls'
        }
      };
      const p2 = {
        name: 'SS Nested B',
        type: 'ss',
        server: 'ss.example.com',
        port: 8388,
        cipher: 'aes-128-gcm',
        password: 'pass',
        plugin: 'custom-plugin',
        'plugin-opts': {
          transport: { mode: 'ws', path: '/v2' },
          security: 'tls'
        }
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2), '嵌套参数值不同的 plugin-opts 指纹必须不同');
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 2, '嵌套参数值不同的 plugin-opts 绝不合并');
    });

    it('Reality opts 键顺序不同应合并', () => {
      const p1 = {
        name: 'Reality Order 1',
        type: 'vless',
        server: 'real.example.com',
        port: 443,
        uuid: 'uuid-1',
        tls: true,
        'reality-opts': {
          'public-key': 'KEY123',
          'short-id': 'abcd',
          'server-name': 'sni.domain.com'
        }
      };
      const p2 = {
        name: 'Reality Order 2',
        type: 'vless',
        server: 'real.example.com',
        port: 443,
        uuid: 'uuid-1',
        tls: true,
        'reality-opts': {
          'server-name': 'sni.domain.com',
          'short-id': 'abcd',
          'public-key': 'KEY123'
        }
      };

      assert.equal(getNodeFingerprint(p1), getNodeFingerprint(p2));
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 1, 'Reality opts 键顺序不同得到相同指纹并合并');
    });

    it('ALPN 数组顺序不同视为不同协商偏好，绝不合并 (RFC 7301 客户端偏好优先序)', () => {
      const p1 = {
        name: 'ALPN A',
        type: 'trojan',
        server: 'alpn.domain.com',
        port: 443,
        password: 'p',
        alpn: ['h2', 'http/1.1']
      };
      const p2 = {
        name: 'ALPN B',
        type: 'trojan',
        server: 'alpn.domain.com',
        port: 443,
        password: 'p',
        alpn: ['http/1.1', 'h2']
      };

      assert.notEqual(getNodeFingerprint(p1), getNodeFingerprint(p2), 'ALPN 协商偏好顺序不同指纹必须不同');
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 2, 'ALPN 协商偏好顺序不同不得合并');
    });

    it('纯展示/策略字段不同不影响指纹合并', () => {
      const p1 = {
        name: '展示名 1',
        _rawName: 'raw 1',
        _keepName: true,
        _subTag: 'tag-A',
        server: 'same.server.com',
        port: 443,
        type: 'vmess',
        uuid: 'uid',
        alterId: 0,
        udp: true,
        'client-fingerprint': 'chrome'
      };
      const p2 = {
        name: '展示名 2',
        _rawName: 'raw 2',
        _keepName: false,
        _subTag: 'tag-B',
        server: 'same.server.com',
        port: 443,
        type: 'vmess',
        uuid: 'uid',
        alterId: 0,
        udp: false,
        'client-fingerprint': 'safari'
      };

      assert.equal(getNodeFingerprint(p1), getNodeFingerprint(p2));
      const deduped = dedupeNodes([p1, p2]);
      assert.equal(deduped.length, 1, '非连接身份字段不影响物理去重合并');
    });
  });

  describe('3. 边界编码与类型区分测试', () => {
    it('canonicalEncode 严格区分数字与数字字符串', () => {
      assert.notEqual(canonicalEncode(443), canonicalEncode('443'));
      assert.equal(canonicalEncode(443), 'num:443');
      assert.equal(canonicalEncode('443'), 's:3:443');
    });

    it('canonicalEncode 严格区分 boolean 与字符串', () => {
      assert.notEqual(canonicalEncode(true), canonicalEncode('true'));
      assert.notEqual(canonicalEncode(false), canonicalEncode('false'));
    });

    it('canonicalEncode 严格区分 null 与 undefined 与空字符串', () => {
      assert.notEqual(canonicalEncode(null), canonicalEncode(undefined));
      assert.notEqual(canonicalEncode(''), canonicalEncode(null));
      assert.notEqual(canonicalEncode(''), canonicalEncode(undefined));
    });

    it('分隔符与特殊字符安全防注入', () => {
      // 如果使用裸分隔符拼接，"a:b" + "" 与 "a" + ":b" 会产生相同串
      const obj1 = { a: 'x;y', b: 'z' };
      const obj2 = { a: 'x', b: ';yz' };
      assert.notEqual(canonicalEncode(obj1), canonicalEncode(obj2));

      // 键名含特殊符号
      const obj3 = { 'a:b': '1', c: '2' };
      const obj4 = { a: 'b:1', c: '2' };
      assert.notEqual(canonicalEncode(obj3), canonicalEncode(obj4));
    });
  });

  describe('4. 可信 Synthetic 与外部伪造去重边界', () => {
    it('内部受信 synthetic 节点仅按 name 防重，不按 127.0.0.1 物理指纹互相合并', () => {
      const syn1 = { name: '📊 剩余流量：100 GB', server: '127.0.0.1', port: 80, type: 'direct', isSyntheticInfo: true };
      const syn2 = { name: '⏱️ 距离重置：10 天', server: '127.0.0.1', port: 80, type: 'direct', isSyntheticInfo: true };
      markTrustedSynthetic(syn1);
      markTrustedSynthetic(syn2);

      const deduped = dedupeNodes([syn1, syn2]);
      assert.equal(deduped.length, 2, '内部受信看板节点具有不同名称时不会互相剔除');
    });

    it('同名的内部受信 synthetic 节点去重只保留 1 个', () => {
      const syn1 = { name: '📊 剩余流量：100 GB', server: '127.0.0.1', port: 80, type: 'direct', isSyntheticInfo: true };
      const syn2 = { name: '📊 剩余流量：100 GB', server: '127.0.0.1', port: 80, type: 'direct', isSyntheticInfo: true };
      markTrustedSynthetic(syn1);
      markTrustedSynthetic(syn2);

      const deduped = dedupeNodes([syn1, syn2]);
      assert.equal(deduped.length, 1, '同名的内部受信看板节点正确去重');
    });

    it('外部伪造 isSyntheticInfo 节点绝不享有看板豁免，同物理参数直接合并', () => {
      const fake1 = { name: '伪造看板 1', server: '127.0.0.1', port: 80, type: 'http', isSyntheticInfo: true };
      const fake2 = { name: '伪造看板 2', server: '127.0.0.1', port: 80, type: 'http', isSyntheticInfo: true };

      const deduped = dedupeNodes([fake1, fake2]);
      assert.equal(deduped.length, 1, '外部伪造 synthetic 必须接受物理指纹去重并合并');
    });
  });

  describe('5. nodes 与 strategy 两条调用路径一致性', () => {
    it('runNodesPipeline 与 runStrategyPipeline 去重语义完全一致', async () => {
      const proxies = [
        {
          name: '🇭🇰 香港 SS 01',
          type: 'ss',
          server: 'hk.node.com',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass',
          plugin: 'v2ray-plugin',
          'plugin-opts': { mode: 'websocket', host: 'a.com' }
        },
        {
          name: '🇭🇰 香港 SS 01 克隆',
          type: 'ss',
          server: 'hk.node.com',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass',
          plugin: 'v2ray-plugin',
          'plugin-opts': { host: 'a.com', mode: 'websocket' } // 键乱序，语义相同 -> 必须合并
        },
        {
          name: '🇭🇰 香港 SS 02 独立配置',
          type: 'ss',
          server: 'hk.node.com',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass',
          plugin: 'v2ray-plugin',
          'plugin-opts': { mode: 'websocket', host: 'b.com' } // host 不同 -> 必须分开保留
        }
      ];

      // 路径 1: nodes pipeline (使用独立克隆输入，避免跨用例对象共享属性污染)
      const nodesInput = JSON.parse(JSON.stringify(proxies));
      const nodesResult = await runNodesPipeline(nodesInput, {
        enableDedupe: true,
        enableNodeRename: false
      });
      assert.equal(nodesResult.length, 2, 'nodes pipeline 路径应去重保留 2 个独立节点');

      // 路径 2: strategy pipeline (Clash Verge / 独立调用路径，使用独立克隆输入)
      const skeleton = {
        proxies: JSON.parse(JSON.stringify(proxies))
      };
      const strategyResult = runStrategyPipeline(skeleton, {
        enableDedupe: true,
        enableNodeRename: false,
        enableNodeSort: false
      });
      assert.equal(strategyResult.proxies.length, 2, 'strategy pipeline 独立路径应去重保留 2 个独立节点');

      // 核对两条路径保留的节点 server & plugin-opts 语义完全对齐
      assert.equal(nodesResult[0].server, strategyResult.proxies[0].server);
      assert.equal(nodesResult[1].server, strategyResult.proxies[1].server);
      assert.equal(nodesResult[0]['plugin-opts'].host, strategyResult.proxies[0]['plugin-opts'].host);
      assert.equal(nodesResult[1]['plugin-opts'].host, strategyResult.proxies[1]['plugin-opts'].host);
    });
  });

  describe('6. 黑名单先于去重的执行顺序保持', () => {
    it('nodes pipeline: 黑名单节点抢先在去重前被拦截，绝不消灭后续正常节点', async () => {
      const proxies = [
        {
          name: '🚫 垃圾推广节点 [BLOCK]',
          type: 'ss',
          server: '1.2.3.4',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass'
        },
        {
          name: '🇭🇰 香港 正常节点 01',
          type: 'ss',
          server: '1.2.3.4',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass'
        }
      ];

      const config = {
        enableDedupe: true,
        blockKeywords: ['BLOCK']
      };

      const result = await runNodesPipeline(proxies, {
        ...config,
        withClassified: true
      });

      assert.equal(result.meta.stats.discardedCount, 1, '黑名单节点被阻断');
      assert.equal(result.meta.stats.dedupeCount, 0, '正常节点没有被去重掉');
      assert.equal(result.proxies.length, 1, '最终保留正常节点');
      assert.ok(result.proxies[0].name.includes('香港'), '保留的是香港正常节点');
    });

    it('strategy pipeline: 独立入口同样保证黑名单节点在前时先阻断，绝不抢先去重后续正常节点', () => {
      const skeleton = {
        proxies: [
          {
            name: '🚫 恶意推广 [BLOCK]',
            type: 'ss',
            server: '2.2.2.2',
            port: 8388,
            cipher: 'aes-128-gcm',
            password: 'secret'
          },
          {
            name: '🇭🇰 香港 01 正常节点',
            type: 'ss',
            server: '2.2.2.2',
            port: 8388,
            cipher: 'aes-128-gcm',
            password: 'secret'
          }
        ]
      };

      const userConfig = {
        enableDedupe: true,
        enableNodeRename: false,
        blockKeywords: ['BLOCK']
      };

      const result = runStrategyPipeline(skeleton, userConfig);
      assert.equal(result.proxies.length, 1, '黑名单节点被剔除，正常节点保留');
      assert.equal(result.proxies[0].name, '🇭🇰 香港 01 正常节点', '保留的一定是后续的正常节点');
    });
  });
});
