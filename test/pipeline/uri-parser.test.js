const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseVlessUri,
  parseVmessUri,
  parseTrojanUri,
  parseSsUri,
  parseHysteria2Uri,
  parseTuicUri,
  parseSocksUri,
  parseHttpUri,
  parseUri,
  parseContent,
  registerParser,
  hasParser,
  getRegisteredSchemes
} = require('../../src/index.js');

describe('【Pipeline】URI 节点协议解析与编解码 (uri-parser)', () => {
  test('parseVlessUri - 基础 TLS 节点解析', () => {
    const uri = 'vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls&sni=hk.example.com&type=ws&path=%2Fws#HK-Node';
    const proxy = parseVlessUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'HK-Node');
    assert.equal(proxy.type, 'vless');
    assert.equal(proxy.server, 'example.com');
    assert.equal(proxy.port, 443);
    assert.equal(proxy.uuid, '11111111-2222-3333-4444-555555555555');
    assert.equal(proxy.tls, true);
    assert.equal(proxy.servername, 'hk.example.com');
    assert.equal(proxy.network, 'ws');
    assert.equal(proxy['ws-opts'].path, '/ws');
  });

  test('parseVlessUri - Reality 节点解析', () => {
    const uri = 'vless://abcdef01-2345-6789-abcd-ef0123456789@reality.com:443?security=reality&pbk=pubkey123&sid=shortid123&fp=chrome&sni=reality.com#Reality-Node';
    const proxy = parseVlessUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.type, 'vless');
    assert.equal(proxy.tls, true);
    assert.equal(proxy['reality-opts']['public-key'], 'pubkey123');
    assert.equal(proxy['reality-opts']['short-id'], 'shortid123');
    assert.equal(proxy['client-fingerprint'], 'chrome');
  });

  test('parseVlessUri - IPv6 方括号清洗', () => {
    const uri = 'vless://uuid-test@[2606:4700:4700::1111]:443?security=tls#VLESS-IPv6';
    const proxy = parseVlessUri(uri);
    assert.notEqual(proxy, null);
    assert.equal(proxy.server, '2606:4700:4700::1111');
  });

  test('parseVmessUri - Base64 格式解析', () => {
    const vmessJson = JSON.stringify({
      v: "2", ps: "VMess-Node", add: "vmess.example.com", port: "8443", id: "12345678-1234-1234-1234-123456789012",
      aid: "0", scy: "auto", net: "ws", type: "none", host: "ws.example.com", path: "/vmess", tls: "tls", sni: "vmess.example.com"
    });
    const base64Str = Buffer.from(vmessJson).toString('base64');
    const uri = `vmess://${base64Str}`;

    const proxy = parseVmessUri(uri);
    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'VMess-Node');
    assert.equal(proxy.type, 'vmess');
    assert.equal(proxy.server, 'vmess.example.com');
    assert.equal(proxy.port, 8443);
    assert.equal(proxy.uuid, '12345678-1234-1234-1234-123456789012');
    assert.equal(proxy.tls, true);
    assert.equal(proxy.network, 'ws');
    assert.equal(proxy['ws-opts'].path, '/vmess');
  });

  test('parseTrojanUri - 基础节点与 IPv6 解析', () => {
    const uri = 'trojan://password123@[2400:3200::1]:443?sni=trojan.example.com&type=tcp#Trojan-IPv6';
    const proxy = parseTrojanUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'Trojan-IPv6');
    assert.equal(proxy.type, 'trojan');
    assert.equal(proxy.server, '2400:3200::1');
    assert.equal(proxy.port, 443);
    assert.equal(proxy.password, 'password123');
    assert.equal(proxy.sni, 'trojan.example.com');
  });

  test('parseSsUri - Shadowsocks 节点解析 (SIP002)', () => {
    const userpass = Buffer.from('aes-256-gcm:sspassword').toString('base64');
    const uri = `ss://${userpass}@ss.example.com:8388#SS-Node`;
    const proxy = parseSsUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'SS-Node');
    assert.equal(proxy.type, 'ss');
    assert.equal(proxy.server, 'ss.example.com');
    assert.equal(proxy.port, 8388);
    assert.equal(proxy.cipher, 'aes-256-gcm');
    assert.equal(proxy.password, 'sspassword');
  });

  test('parseSsUri - Shadowsocks 老式单 Base64 格式 (SIP001)', () => {
    const rawPayload = 'chacha20-ietf-poly1305:mypassword@legacy.example.com:8443';
    const base64Str = Buffer.from(rawPayload).toString('base64');
    const uri = `ss://${base64Str}#SIP001-Node`;
    const proxy = parseSsUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'SIP001-Node');
    assert.equal(proxy.type, 'ss');
    assert.equal(proxy.server, 'legacy.example.com');
    assert.equal(proxy.port, 8443);
    assert.equal(proxy.cipher, 'chacha20-ietf-poly1305');
    assert.equal(proxy.password, 'mypassword');
  });

  test('parseSsUri - IPv6 地址主机名方括号去除', () => {
    const userpass = Buffer.from('aes-128-gcm:pass').toString('base64');
    const uri = `ss://${userpass}@[2001:db8::1]:8388#SS-IPv6`;
    const proxy = parseSsUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'SS-IPv6');
    assert.equal(proxy.server, '2001:db8::1');
    assert.equal(proxy.port, 8388);
  });

  test('parseHysteria2Uri - 完整参数与端口跳跃解析', () => {
    const uri = 'hysteria2://mypassword@hy2.example.com:443?sni=sni.example.com&insecure=1&obfs=salamander&obfs-password=obfspass&ports=443,10000-20000&up=100&down=200&alpn=h3&fp=chrome#Hy2-Node';
    const proxy = parseHysteria2Uri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'Hy2-Node');
    assert.equal(proxy.type, 'hysteria2');
    assert.equal(proxy.server, 'hy2.example.com');
    assert.equal(proxy.port, 443);
    assert.equal(proxy.password, 'mypassword');
    assert.equal(proxy.sni, 'sni.example.com');
    assert.equal(proxy['skip-cert-verify'], true);
    assert.equal(proxy.obfs, 'salamander');
    assert.equal(proxy['obfs-password'], 'obfspass');
    assert.equal(proxy.ports, '443,10000-20000');
    assert.equal(proxy.up, '100 Mbps');
    assert.equal(proxy.down, '200 Mbps');
    assert.deepEqual(proxy.alpn, ['h3']);
    assert.equal(proxy['client-fingerprint'], 'chrome');
  });

  test('parseHysteria2Uri - 支持 hy2:// 别名与 IPv6', () => {
    const uri = 'hy2://auth123@[2606:4700::1]:8443#Hy2-IPv6';
    const proxy = parseHysteria2Uri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'Hy2-IPv6');
    assert.equal(proxy.type, 'hysteria2');
    assert.equal(proxy.server, '2606:4700::1');
    assert.equal(proxy.port, 8443);
    assert.equal(proxy.password, 'auth123');
    assert.equal(proxy['skip-cert-verify'], false);
  });

  test('parseTuicUri - 协议解析与高级流控参数', () => {
    const uri = 'tuic://00000000-1111-2222-3333-444444444444:tuicpass@tuic.example.com:8443?congestion_controller=bbr&udp_relay_mode=native&alpn=h3&reduce_rtt=1&sni=tuic.example.com&heartbeat_interval=10000#TUIC-Node';
    const proxy = parseTuicUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'TUIC-Node');
    assert.equal(proxy.type, 'tuic');
    assert.equal(proxy.server, 'tuic.example.com');
    assert.equal(proxy.port, 8443);
    assert.equal(proxy.uuid, '00000000-1111-2222-3333-444444444444');
    assert.equal(proxy.password, 'tuicpass');
    assert.equal(proxy.sni, 'tuic.example.com');
    assert.equal(proxy['congestion-controller'], 'bbr');
    assert.equal(proxy['udp-relay-mode'], 'native');
    assert.equal(proxy['reduce-rtt'], true);
    assert.equal(proxy['heartbeat-interval'], 10000);
    assert.deepEqual(proxy.alpn, ['h3']);
  });

  test('parseSocksUri - SOCKS5 节点解析 (支持用户名密码与 Base64)', () => {
    const uri = 'socks5://user:pass123@socks.example.com:1080#Socks5-Auth';
    const proxy = parseSocksUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'Socks5-Auth');
    assert.equal(proxy.type, 'socks5');
    assert.equal(proxy.server, 'socks.example.com');
    assert.equal(proxy.port, 1080);
    assert.equal(proxy.username, 'user');
    assert.equal(proxy.password, 'pass123');
  });

  test('parseHttpUri - HTTP 代理节点解析', () => {
    const uri = 'http://proxyuser:proxypass@http.example.com:8080#HTTP-Proxy';
    const proxy = parseHttpUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'HTTP-Proxy');
    assert.equal(proxy.type, 'http');
    assert.equal(proxy.server, 'http.example.com');
    assert.equal(proxy.port, 8080);
    assert.equal(proxy.username, 'proxyuser');
    assert.equal(proxy.password, 'proxypass');
  });

  test('Protocol Registry - 动态注册与统一 parseUri 分发', () => {
    assert.equal(hasParser('hysteria2'), true);
    assert.equal(hasParser('hy2'), true);
    assert.equal(hasParser('tuic'), true);
    assert.equal(hasParser('vless'), true);
    assert.ok(getRegisteredSchemes().includes('vmess'));

    // 自定义 Mock 协议动态注册
    registerParser('mockproto', (_uri) => {
      return {
        name: 'Mock-Node',
        type: 'mock',
        server: 'mock.local',
        port: 9999
      };
    });

    assert.equal(hasParser('mockproto'), true);
    const mockNode = parseUri('mockproto://something');
    assert.notEqual(mockNode, null);
    assert.equal(mockNode.name, 'Mock-Node');
    assert.equal(mockNode.server, 'mock.local');
    assert.equal(mockNode.port, 9999);
  });

  test('parseContent - 多协议混合订阅自动识别与批量解析', () => {
    const content = `
vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls#Vless-Node
hy2://pass1@hy2.example.com:443#Hy2-Node
tuic://00000000-1111-2222-3333-444444444444:pass2@tuic.example.com:8443#TUIC-Node
trojan://pass3@trojan.example.com:443#Trojan-Node
    `;
    const res = parseContent(content);
    assert.notEqual(res, null);
    assert.equal(res.proxies.length, 4);
    assert.equal(res.proxies[0].name, 'Vless-Node');
    assert.equal(res.proxies[1].name, 'Hy2-Node');
    assert.equal(res.proxies[2].name, 'TUIC-Node');
    assert.equal(res.proxies[3].name, 'Trojan-Node');
  });

  test('parseContent - Base64 编码的 Hy2/TUIC 节点列表解析', () => {
    const rawList = `hy2://pass@hy2.example.com:443#Hy2-B64\ntuic://uuid:pass@tuic.example.com:8443#TUIC-B64`;
    const b64 = Buffer.from(rawList).toString('base64');
    const res = parseContent(b64);

    assert.notEqual(res, null);
    assert.equal(res.proxies.length, 2);
    assert.equal(res.proxies[0].name, 'Hy2-B64');
    assert.equal(res.proxies[1].name, 'TUIC-B64');
  });

  describe('协议解析边界鲁棒性加固 (M1 Milestone)', () => {
    test('parseSsUri - 密码包含冒号不被截断', () => {
      // 未 base64 编码的 user:password，密码含多个冒号
      const uri = 'ss://aes-256-gcm:my:complex:pass:word@ss.example.com:8388#SS-ColonPass';
      const proxy = parseSsUri(uri);
      assert.notEqual(proxy, null);
      assert.equal(proxy.cipher, 'aes-256-gcm');
      assert.equal(proxy.password, 'my:complex:pass:word');
    });

    test('parseSsUri - 插件参数防等号截断与 SIP003 内联插件解析', () => {
      // plugin-opts 参数值包含等号（如 base64 或复杂的 token）
      const uri = 'ss://aes-256-gcm:pass@ss.example.com:8388?plugin=obfs-local&plugin-opts=obfs=tls;obfs-host=example.com;token=abc=123==#SS-Plugin';
      const proxy = parseSsUri(uri);
      assert.notEqual(proxy, null);
      assert.equal(proxy.plugin, 'obfs-local');
      assert.equal(proxy['plugin-opts'].obfs, 'tls');
      assert.equal(proxy['plugin-opts']['obfs-host'], 'example.com');
      assert.equal(proxy['plugin-opts'].token, 'abc=123==');

      // SIP003 内联插件
      const uriInline = 'ss://aes-256-gcm:pass@ss.example.com:8388?plugin=v2ray-plugin;mode=websocket;path=/ws#SS-Inline';
      const proxyInline = parseSsUri(uriInline);
      assert.notEqual(proxyInline, null);
      assert.equal(proxyInline.plugin, 'v2ray-plugin');
      assert.equal(proxyInline['plugin-opts'].mode, 'websocket');
      assert.equal(proxyInline['plugin-opts'].path, '/ws');
    });

    test('parseVmessUri - 兼容 tls: 1 / true 多种真值形式', () => {
      const vmess1 = Buffer.from(JSON.stringify({
        v: "2", ps: "VMess-TLS-1", add: "example.com", port: "443", id: "uuid-1", tls: 1
      })).toString('base64');
      const proxy1 = parseVmessUri(`vmess://${vmess1}`);
      assert.equal(proxy1.tls, true);

      const vmessTrue = Buffer.from(JSON.stringify({
        v: "2", ps: "VMess-TLS-True", add: "example.com", port: "443", id: "uuid-2", tls: true
      })).toString('base64');
      const proxyTrue = parseVmessUri(`vmess://${vmessTrue}`);
      assert.equal(proxyTrue.tls, true);
    });

    test('parseVmessUri - 提取 TCP + HTTP 伪装头 (type: http)', () => {
      const vmessHttp = Buffer.from(JSON.stringify({
        v: "2", ps: "VMess-TCP-HTTP", add: "example.com", port: "80", id: "uuid-3",
        net: "tcp", type: "http", host: "fake.domain.com", path: "/index.html"
      })).toString('base64');
      const proxy = parseVmessUri(`vmess://${vmessHttp}`);
      assert.notEqual(proxy, null);
      assert.equal(proxy.network, 'tcp');
      assert.ok(proxy['http-opts']);
      assert.deepStrictEqual(proxy['http-opts'].path, ['/index.html']);
      assert.deepStrictEqual(proxy['http-opts'].headers.Host, ['fake.domain.com']);
    });

    test('parseVlessUri & parseTrojanUri - gRPC 路径兼容 service-name 与 path 别名', () => {
      // VLESS service-name 别名
      const vlessUri1 = 'vless://uuid-test@example.com:443?type=grpc&service-name=my-grpc-service#Vless-Grpc';
      const vlessProxy1 = parseVlessUri(vlessUri1);
      assert.equal(vlessProxy1['grpc-opts']['grpc-service-name'], 'my-grpc-service');

      // VLESS path 别名
      const vlessUri2 = 'vless://uuid-test@example.com:443?type=grpc&path=my-grpc-path#Vless-Grpc-Path';
      const vlessProxy2 = parseVlessUri(vlessUri2);
      assert.equal(vlessProxy2['grpc-opts']['grpc-service-name'], 'my-grpc-path');

      // Trojan service-name 别名
      const trojanUri1 = 'trojan://pass@example.com:443?type=grpc&service-name=trojan-service#Trojan-Grpc';
      const trojanProxy1 = parseTrojanUri(trojanUri1);
      assert.equal(trojanProxy1['grpc-opts']['grpc-service-name'], 'trojan-service');

      // Trojan path 别名
      const trojanUri2 = 'trojan://pass@example.com:443?type=grpc&path=trojan-path#Trojan-Grpc-Path';
      const trojanProxy2 = parseTrojanUri(trojanUri2);
      assert.equal(trojanProxy2['grpc-opts']['grpc-service-name'], 'trojan-path');
    });
  });
});
