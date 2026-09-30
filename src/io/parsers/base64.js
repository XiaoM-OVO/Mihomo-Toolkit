/**
 * 跨运行时安全的 Base64 / URI 编解码工具
 */

function decodeBase64(str) {
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str.trim(), 'base64').toString('utf-8');
    }
    const binString = atob(str.trim());
    return new TextDecoder().decode(Uint8Array.from(binString, (m) => m.codePointAt(0)));
  } catch {
    return null;
  }
}

function decodeBase64UrlSafe(str) {
  try {
    let s = str.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(s, 'base64').toString('utf-8');
    }
    const binString = atob(s);
    return new TextDecoder().decode(Uint8Array.from(binString, (m) => m.codePointAt(0)));
  } catch {
    return null;
  }
}

function safeDecodeURIComponent(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

function cleanHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return '';
  const trimmed = hostname.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

module.exports = {
  decodeBase64,
  decodeBase64UrlSafe,
  safeDecodeURIComponent,
  cleanHostname
};

