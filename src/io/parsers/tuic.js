/**
 * TUIC 节点链接解析器
 *
 * 解析 tuic:// 协议链接并转换为标准 Mihomo 节点对象。
 */

const { safeDecodeURIComponent, cleanHostname } = require('./base64');

function parseTuicUri(uri) {
  try {
    const url = new URL(uri.trim());
    let server = cleanHostname(url.hostname);
    const port = parseInt(url.port) || 8443;
    const name = safeDecodeURIComponent(url.hash.slice(1)) || `${server}:${port}`;
    const params = url.searchParams;

    const uuid = safeDecodeURIComponent(url.username || '');
    const password = safeDecodeURIComponent(url.password || '');

    const insecure = params.get('insecure') || params.get('allow_insecure') || params.get('skip-cert-verify');
    const skipCertVerify = insecure === '1' || insecure === 'true';

    const alpnParam = params.get('alpn');
    const alpn = alpnParam
      ? alpnParam.split(',').map(s => s.trim()).filter(Boolean)
      : ['h3'];

    const congestionController = params.get('congestion_controller') || params.get('congestion-controller') || 'bbr';
    const udpRelayMode = params.get('udp_relay_mode') || params.get('udp-relay-mode') || 'native';

    const proxy = {
      name,
      type: 'tuic',
      server,
      port,
      uuid,
      password,
      'skip-cert-verify': skipCertVerify,
      alpn,
      'congestion-controller': congestionController,
      'udp-relay-mode': udpRelayMode
    };

    if (params.get('sni')) {
      proxy.sni = params.get('sni');
    }

    const reduceRtt = params.get('reduce_rtt') || params.get('reduce-rtt');
    if (reduceRtt === '1' || reduceRtt === 'true') {
      proxy['reduce-rtt'] = true;
    }

    const disableSni = params.get('disable_sni') || params.get('disable-sni');
    if (disableSni === '1' || disableSni === 'true') {
      proxy['disable-sni'] = true;
    }

    const ip = params.get('ip');
    if (ip) {
      proxy.ip = ip;
    }

    const heartbeatInterval = params.get('heartbeat_interval') || params.get('heartbeat-interval');
    if (heartbeatInterval) {
      const intervalVal = parseInt(heartbeatInterval, 10);
      if (!isNaN(intervalVal)) {
        proxy['heartbeat-interval'] = intervalVal;
      }
    }

    const fp = params.get('fp') || params.get('client-fingerprint');
    if (fp) {
      proxy['client-fingerprint'] = fp;
    }

    return proxy;
  } catch {
    return null;
  }
}

module.exports = {
  parseTuicUri
};
