const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseVlessUri, parseVmessUri, parseTrojanUri, parseSsUri, parseContent } = require('../src/builder.js');

describe('🧩 URI 节点协议解析模块', () => {
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

  test('parseTrojanUri - 基础节点解析', () => {
    const uri = 'trojan://password123@trojan.example.com:443?sni=trojan.example.com&type=tcp#Trojan-Node';
    const proxy = parseTrojanUri(uri);

    assert.notEqual(proxy, null);
    assert.equal(proxy.name, 'Trojan-Node');
    assert.equal(proxy.type, 'trojan');
    assert.equal(proxy.server, 'trojan.example.com');
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

  test('parseContent - 多行 URI 批量识别解析', () => {
    const content = `
vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls#Node1
trojan://pass@example2.com:443#Node2
    `;
    const res = parseContent(content);
    assert.notEqual(res, null);
    assert.equal(res.proxies.length, 2);
    assert.equal(res.proxies[0].name, 'Node1');
    assert.equal(res.proxies[1].name, 'Node2');
  });
});
