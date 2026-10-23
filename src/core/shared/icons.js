/**
 * 协议与特征图标字典
 *
 * 集中管理底层代理协议与基础设施/网络基线特征标签的 Emoji/文字映射表。
 * 业务服务级特征（如 AI、流媒体、社交平台等）由 ServiceCatalog 编目体系统一部署。
 */

const PROTOCOL_ICONS = {
  ss: "🛩️",
  ssr: "🚀",
  vmess: "🦊",
  vless: "🛸",
  trojan: "🐴",
  hysteria: "⚡",
  hysteria2: "⚡",
  tuic: "💨",
  wireguard: "🕸️",
  snell: "📡",
  socks: "🧦",
  socks5: "🧦",
  http: "🌐",
  https: "🔒",
  ssh: "💻",
  xray: "☢️",
  shadowtls: "🛡️",
  anytls: "🛡️",
  reality: "🎭"
};

const FEATURE_ICONS = {
  residential: "🏠",
  game: "🎮",
  streaming: "📺",
  free: "🆓",
  wap: "📱",
  cellular: "📱",
  CDN: "☁️",
  cdn: "☁️",
  AWS: "🛰️",
  aws: "🛰️",
  experimental: "🧪"
};

const FEATURE_TEXT_MAP = {
  residential: "家宽",
  game: "游戏",
  streaming: "流媒体",
  lowMulti: "低倍率",
  free: "免费",
  wap: "WAP",
  cellular: "蜂窝",
  CDN: "CDN",
  cdn: "CDN",
  AWS: "AWS",
  aws: "AWS",
  ipv6: "IPv6",
  dualstack: "双栈",
  experimental: "实验"
};

module.exports = {
  PROTOCOL_ICONS,
  FEATURE_ICONS,
  FEATURE_TEXT_MAP
};
