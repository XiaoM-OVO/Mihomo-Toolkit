/**
 * 协议与特征图标字典
 *
 * 集中管理底层代理协议、业务特征标签与 Emoji/文字映射表。
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
  download: "⏬",
  free: "🆓",
  wap: "📱",
  cellular: "📱",
  CDN: "☁️",
  cdn: "☁️",
  AWS: "🛰️",
  aws: "🛰️",
  experimental: "🧪",
  no_download: "🚫",
  gpt: "🤖",
  chatgpt: "🤖",
  gemini: "♊",
  claude: "🦀",
  copilot: "🐙",
  ai: "✨",
  nf: "🎬",
  "d+": "🐭",
  yt: "▶️",
  tk: "🎵",
  sp: "🎧"
};

const FEATURE_TEXT_MAP = {
  residential: "家宽",
  game: "游戏",
  streaming: "流媒体",
  chatgpt: "GPT",
  gemini: "Gemini",
  claude: "Claude",
  copilot: "Copilot",
  ai: "AI",
  download: "下载",
  free: "免费",
  no_download: "禁止下载",
  wap: "WAP",
  CDN: "CDN",
  AWS: "AWS",
  cellular: "蜂窝",
  ipv6: "IPv6",
  dualstack: "双栈",
  experimental: "实验"
};

module.exports = {
  PROTOCOL_ICONS,
  FEATURE_ICONS,
  FEATURE_TEXT_MAP
};
