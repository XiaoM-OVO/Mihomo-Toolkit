const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isFakeServerAddress,
  isNoticeNode,
  isNoticePlaceholderNode,
  hasOnlyPlaceholderNodes
} = require('../../src/core/notice');
const { markTrustedSynthetic } = require('../../src/core/node-trust');

describe('【Core】占位与公告节点判定 (notice)', () => {
  describe('isFakeServerAddress - 结构性无效/占位服务判定', () => {
    it('空值、未定义、空字符串与 localhost 判为假服务', () => {
      assert.equal(isFakeServerAddress(''), true);
      assert.equal(isFakeServerAddress(null), true);
      assert.equal(isFakeServerAddress(undefined), true);
      assert.equal(isFakeServerAddress('localhost', 443), true);
    });

    it('非法端口判为假服务 (非整数、<=0、>65535、非数字)', () => {
      assert.equal(isFakeServerAddress('1.2.3.4', 0), true);
      assert.equal(isFakeServerAddress('1.2.3.4', -1), true);
      assert.equal(isFakeServerAddress('1.2.3.4', 70000), true);
      assert.equal(isFakeServerAddress('1.2.3.4', 'abc'), true);
      assert.equal(isFakeServerAddress('1.2.3.4', null), true);
      assert.equal(isFakeServerAddress('1.2.3.4', ''), true);
    });

    it('假 IPv4 与假 IPv6 判为假服务', () => {
      assert.equal(isFakeServerAddress('0.0.0.0', 443), true);
      assert.equal(isFakeServerAddress('127.0.0.1', 443), true);
      assert.equal(isFakeServerAddress('1.0.0.1', 80), true); // 经典占位 IP
      assert.equal(isFakeServerAddress('8.8.8.8', 443), true); // 公共 DNS 占位
      assert.equal(isFakeServerAddress('114.114.114.114', 443), true);
      assert.equal(isFakeServerAddress('::', 443), true);
      assert.equal(isFakeServerAddress('::1', 443), true);
    });

    it('合法公网 IP 与域名且带合法端口判为真服务', () => {
      assert.equal(isFakeServerAddress('104.28.1.1', 443), false);
      assert.equal(isFakeServerAddress('203.0.113.5', 8080), false);
      assert.equal(isFakeServerAddress('hk.node.example.com', 443), false);
      assert.equal(isFakeServerAddress('2606:4700::1', 443), false);
    });
  });

  describe('isNoticeNode - 原生公告/说明候选节点判定', () => {
    it('非对象输入与空名称安全防御', () => {
      assert.equal(isNoticeNode(null), false);
      assert.equal(isNoticeNode(undefined), false);
      assert.equal(isNoticeNode({}), false);
      assert.equal(isNoticeNode({ name: '' }), false);
    });

    it('内部受信 synthetic 节点不被误判为原生 notice', () => {
      const synth = markTrustedSynthetic({
        name: '📊 剩余流量 100G',
        server: '127.0.0.1',
        port: 80,
        isSyntheticInfo: true
      });
      assert.equal(isNoticeNode(synth), false);
    });

    it('明确的纯流量/到期横幅标题：不论挂在什么 server/port 下均判定为 notice', () => {
      assert.equal(isNoticeNode({ name: '剩余流量：100GB', server: '1.2.3.4', port: 443 }), true);
      assert.equal(isNoticeNode({ name: '距离重置还有 5 天', server: 'hk.domain.com', port: 443 }), true);
      assert.equal(isNoticeNode({ name: '套餐到期日：2026-12-31', server: '1.2.3.4', port: 443 }), true);
    });

    it('一般公告/说明词：伴随假服务参数才判定为 notice，真实代理参数不误判', () => {
      // 伴随假参数 -> 确认为 notice
      assert.equal(isNoticeNode({ name: '官方公告：请更新订阅', server: '127.0.0.1', port: 0 }), true);
      assert.equal(isNoticeNode({ name: '说明：节点维护中', server: '0.0.0.0', port: 80 }), true);

      // 伴随真实参数 -> 不误判（放行为真实节点）
      assert.equal(isNoticeNode({ name: '🇭🇰 香港 01 [说明: 专线直连]', server: '210.1.2.3', port: 443 }), false);
      assert.equal(isNoticeNode({ name: '通知群专线 02', server: 'hk.node.com', port: 443 }), false);
    });
  });

  describe('isNoticePlaceholderNode - 无服务能力占位伪节点判定', () => {
    it('必须同时满足假服务参数与通知名称特征', () => {
      // 假服务 + 通知名称 -> true
      assert.equal(isNoticePlaceholderNode({ name: '套餐已到期，请续费', server: '1.0.0.1', port: 80 }), true);
      assert.equal(isNoticePlaceholderNode({ name: '官方通知：禁止BT', server: '127.0.0.1', port: 0 }), true);

      // 真服务 + 通知名称 -> false (不可误杀真实代理)
      assert.equal(isNoticePlaceholderNode({ name: '套餐已到期，请续费', server: '210.1.2.3', port: 443 }), false);

      // 假服务 + 普通节点名称 -> false (非通知占位，交由普通清洗拦截)
      assert.equal(isNoticePlaceholderNode({ name: '🇭🇰 香港 01', server: '127.0.0.1', port: 0 }), false);
    });
  });

  describe('hasOnlyPlaceholderNodes - 订阅有效性全量占位检查', () => {
    it('空数组或非数组视为全部占位 (无有效节点)', () => {
      assert.equal(hasOnlyPlaceholderNodes([]), true);
      assert.equal(hasOnlyPlaceholderNodes(null), true);
      assert.equal(hasOnlyPlaceholderNodes(undefined), true);
    });

    it('混合节点列表中存在至少一个有效真实节点时返回 false', () => {
      const proxies = [
        { name: '套餐已到期，请续费', server: '1.0.0.1', port: 80 },
        { name: '🇭🇰 香港 01', server: '210.1.2.3', port: 443 }
      ];
      assert.equal(hasOnlyPlaceholderNodes(proxies), false);
    });

    it('全部为占位伪节点时返回 true', () => {
      const proxies = [
        { name: '套餐已到期，请续费', server: '1.0.0.1', port: 80 },
        { name: '距离重置还有 3 天', server: '127.0.0.1', port: 0 }
      ];
      assert.equal(hasOnlyPlaceholderNodes(proxies), true);
    });
  });
});
