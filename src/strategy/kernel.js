/**
 * Mihomo 内核底层配置覆写 (TUN / Sniffer / 性能优化)
 *
 * 管理系统 TUN 网卡接管、深度包检测 Sniffer、TCP 握手并发与 Profile 持久化。
 */

/**
 * 注入 TUN 模式配置
 * @param {object} config
 * @param {object} userConfig
 */
function applyTunOverlay(config, userConfig) {
  config.ipv6 = userConfig.enableIPv6;
  config.tun = {
    ...config.tun,
    stack: 'system',
    device: 'Mihomo',
    'auto-route': true,
    'strict-route': true,
    'auto-detect-interface': true,
    'dns-hijack': ['any:53', 'tcp://any:53'],
    'route-exclude-address': ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', 'fc00::/7', 'fe80::/10']
  };
}

/**
 * 注入 Sniffer 域名嗅探配置
 * @param {object} config
 * @param {object} _userConfig
 */
function applySnifferOverlay(config, _userConfig) {
  config.sniffer = {
    enable: true,
    'force-dns-mapping': true,
    'parse-pure-ip': true,
    'override-destination': true,
    sniff: {
      TLS: { ports: [443, 8443] },
      HTTP: { ports: [80, '8080-8880'], 'override-destination': true },
      QUIC: { ports: [443, 4433] }
    }
  };
}

/**
 * 注入 Mihomo 核心性能调优与指纹伪装
 * @param {object} config
 * @param {object} _userConfig
 */
function applyCoreOptimize(config, _userConfig) {
  // 1. Profile 记忆模块
  config.profile = {
    ...config.profile,
    'store-selected': true,
    'store-fake-ip': true
  };

  // 2. 根级性能优化
  config['unified-delay'] = true;
  config['tcp-concurrent'] = true;
  config['keep-alive-interval'] = 15;
  config['find-process-mode'] = 'strict';

  if (Array.isArray(config.proxies)) {
    config.proxies = config.proxies.map(p => {
      if (!p || typeof p !== 'object') return p;
      const isTargetType = ['vless', 'vmess', 'trojan'].includes(p.type);
      const isTlsEnabled = p.tls === true || (['ws', 'grpc'].includes(p.network) && p.tls !== false);
      const needFingerprint = isTargetType && isTlsEnabled && !p['client-fingerprint'];
      const needUdp = p.udp === undefined && p.type !== 'http';
      if (!needFingerprint && !needUdp) {
        return p;
      }
      const updated = { ...p };
      if (needFingerprint) {
        updated['client-fingerprint'] = 'chrome';
      }
      if (needUdp) {
        updated.udp = true;
      }
      return updated;
    });
  }
}

module.exports = {
  applyTunOverlay,
  applySnifferOverlay,
  applyCoreOptimize
};
