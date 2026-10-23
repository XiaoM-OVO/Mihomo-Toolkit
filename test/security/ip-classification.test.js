'use strict';

/**
 * -----------------------------------------------------------------------------
 * IP 分类原语：私网 / 保留地址判定
 * -----------------------------------------------------------------------------
 * 这些函数是 DNS 过滤与 SSRF 拦截的底座，判错方向都会出事：
 *   - 漏判 → 私网地址被当成公网放行（SSRF / 内网探测）
 *   - 误判 → 公网地址被当成私网丢弃（DNS 结果被清空，节点解析失败）
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isPrivateIp, isPrivateIPv6 } = require('../../src/infra/ip');

describe('【Security】IP 分类原语 (ip-classification)', () => {
  it('isPrivateIPv6 - NAT64 内嵌 IPv4 按最后 32 位判定，与文本写法无关', () => {
    // 同一地址的两种写法必须同判：十六进制缩写不能绕过
    assert.strictEqual(isPrivateIPv6('64:ff9b::7f00:1'), true, 'NAT64 内嵌 127.0.0.1（十六进制）漏判');
    assert.strictEqual(isPrivateIPv6('64:ff9b::127.0.0.1'), true, 'NAT64 内嵌 127.0.0.1（点分）漏判');
    assert.strictEqual(isPrivateIPv6('64:ff9b::a00:1'), true, 'NAT64 内嵌 10.0.0.1 漏判');
    assert.strictEqual(isPrivateIPv6('64:ff9b::c0a8:105'), true, 'NAT64 内嵌 192.168.1.5 漏判');
    // 公网 NAT64 目标不应被误杀（否则 IPv6-only 网络下 DNS 结果被清空）
    assert.strictEqual(isPrivateIPv6('64:ff9b::808:808'), false, 'NAT64 内嵌 8.8.8.8 被误判为私网');
    assert.strictEqual(isPrivateIPv6('64:ff9b::101:101'), false, 'NAT64 内嵌 1.1.1.1 被误判为私网');
  });

  it('isPrivateIPv6 - IPv4 映射、6to4 与普通保留段', () => {
    assert.strictEqual(isPrivateIPv6('::ffff:127.0.0.1'), true);
    assert.strictEqual(isPrivateIPv6('::ffff:8.8.8.8'), false);
    assert.strictEqual(isPrivateIPv6('2002:7f00:0001::'), true, '6to4 内嵌 127.0.0.1 漏判');
    assert.strictEqual(isPrivateIPv6('fe80::1'), true, '链路本地漏判');
    assert.strictEqual(isPrivateIPv6('2001:4860:4860::8888'), false, '公网 IPv6 误判');
  });

  it('isPrivateIp - IPv4 私网 / 保留段', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '198.18.0.1']) {
      assert.strictEqual(isPrivateIp(ip), true, `${ip} 应判为私网`);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '104.16.1.1']) {
      assert.strictEqual(isPrivateIp(ip), false, `${ip} 不应判为私网`);
    }
  });
});
