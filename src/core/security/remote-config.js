/**
 * -----------------------------------------------------------------------------
 * Core Layer: 不可信远程配置加固 (Untrusted Remote Config Hardening)
 * -----------------------------------------------------------------------------
 * 纯函数、无副作用、无 I/O。
 *
 * 信任模型约定：
 *   - `UserConfig`（CLI 的 -c 文件、服务端本地 config.yaml、SDK 调用方传参）视为**可信**输入，
 *     因此它被允许声明 DNS 控制面、本机资源路径等能力。
 *   - 来自网络、他人分享链接、`?config=` 查询参数的配置视为**不可信**输入，
 *     必须先经过本模块剥夺「触碰本机资源」与「改写 DNS 控制面」的能力。
 *
 * 为什么 DNS 控制面也必须剥夺：
 *   一条分享链接就足以让受害者的内核把 github.com / paypal.com 解析到攻击者 IP
 *   （hosts 与 nameserver-policy 两条通道），或让内核监听成开放 DNS 解析器。
 */

'use strict';

const { REMOTE_DENIED_FIELDS, REMOTE_ALLOWED_FIELDS } = require('../../data');
const { isPrivateIp, isPrivateIPv6 } = require('../../infra/ip');

/**
 * 不可信配置中被禁止的字段（能力剥夺清单）。
 *
 * ⚠️ 本清单**由只读数据层派生**，不再手工维护：`src/data/field-registry.js` 中
 * 每个声明 `trust: 'local'` 的字段都会自动进入此处。
 */
const REMOTE_CONFIG_FORBIDDEN_KEYS = [...REMOTE_DENIED_FIELDS];

/**
 * 不可信配置中允许保留的字段（白名单放行清单）。
 *
 * ⚠️ 基于 Fail-Closed 原则：仅允许注册表中声明 `trust: 'any'` 的字段通过。
 * 任何声明为 `trust: 'local'` 的字段或未登记的未知字段一律安全剥离。
 */
const REMOTE_CONFIG_ALLOWED_KEYS = [...REMOTE_ALLOWED_FIELDS];
const ALLOWED_SET = new Set(REMOTE_CONFIG_ALLOWED_KEYS);

/**
 * 远程配置中允许出现的内联节点 scheme。
 *
 * `subscriptions[].uri` 是「内联订阅内容」（`src/pipeline/ingestion.js` 里直接当
 * `content` 解析，**不读文件**），但它仍是不可信输入：`file://` / `javascript:` 之类的
 * scheme 会把语义不明的字符串送进解析器。这里只放行解析器注册表里真实存在的协议，
 * 与 `src/io/parsers/index.js` 的 `registerParser(...)` 一一对应（新增协议时同步维护）。
 *
 * 注意：不带 scheme 的纯 base64 订阅块照常放行——base64 字母表不含 `:`。
 */
const INLINE_URI_SCHEMES = new Set([
  'vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'hy2',
  'tuic', 'socks', 'socks5', 'http', 'https'
]);

/** 图标类字段：客户端会直接请求这些 URL，属于「客户端侧访问」能力 */
const ICON_REPO_KEYS = ['iconRepoOrz', 'iconRepoKoolson', 'iconRepoLige47'];
const ICON_FIELD_RE = /^(icon|iconUrl|image|logo)$/i;

/**
 * 判断一个字符串是不是「客户端会去请求的」安全资源地址。
 *
 * 威胁：远程配置把策略组图标写成 `http://127.0.0.1:8080/x.png` 或内网域名，
 * 客户端加载配置时会发起请求——这是客户端侧的内网探测 / 隐私泄露通道，
 * 服务端 SSRF 校验拦不到（请求根本不经过本工具）。
 *
 * 规则：https、主机名带点、非私网 IP 字面量。非 URL 形态（emoji / 图标文件名）原样放行。
 */
function isSafeRemoteAssetUrl(value) {
  if (typeof value !== 'string') return true;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) return true;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || !host.includes('.')) return false; // localhost / 单 label 内网主机名
  if (isPrivateIp(host) || isPrivateIPv6(host)) return false;
  return true;
}

/** 递归清洗对象里的图标字段；返回被丢弃的路径清单 */
function sanitizeIconFields(node, path, dropped) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (typeof value === 'string') {
      if (ICON_FIELD_RE.test(key) && !isSafeRemoteAssetUrl(value)) {
        delete node[key];
        dropped.push(currentPath);
      }
      continue;
    }
    if (Array.isArray(value)) continue;
    if (value && typeof value === 'object') sanitizeIconFields(value, currentPath, dropped);
  }
}

/**
 * 对不可信远程配置执行能力剥夺（基于白名单收敛 fail-closed）。
 *
 * @param {object} rawConfig 解析后的远程配置对象
 * @returns {{ ok: boolean, reason?: string, config: object, strippedKeys: string[] }}
 *          ok=false 表示该配置引用了不被允许的资源（如本地文件路径），调用方应整体拒绝
 */
function hardenRemoteConfig(rawConfig) {
  const input = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};

  // 订阅源只允许 http(s)：否则可把服务器上的任意本地文件当作订阅读取并回显（任意文件读取）
  const subs = Array.isArray(input.subscriptions) ? input.subscriptions : [];
  const illegal = subs.find(
    s => s && typeof s === 'object' && s.url && !/^https?:\/\//i.test(String(s.url))
  );
  if (illegal) {
    return {
      ok: false,
      reason: 'remote config may only reference http(s) subscription URLs',
      config: {},
      strippedKeys: []
    };
  }

  // 内联订阅内容（uri）不得使用解析器不认识的 scheme。
  // 不带 scheme 的纯 base64 块照常放行（base64 不含 `:`）。
  const illegalUri = subs.find(s => {
    if (!s || typeof s !== 'object' || !s.uri) return false;
    const match = /^([a-z][a-z0-9+.-]*):/i.exec(String(s.uri).trim());
    return Boolean(match) && !INLINE_URI_SCHEMES.has(match[1].toLowerCase());
  });
  if (illegalUri) {
    return {
      ok: false,
      reason: 'remote config may only inline proxy node URI schemes',
      config: {},
      strippedKeys: []
    };
  }

  const cleanConfig = {};
  const strippedKeys = [];
  for (const [key, value] of Object.entries(input)) {
    if (ALLOWED_SET.has(key)) {
      cleanConfig[key] = value;
    } else {
      strippedKeys.push(key);
    }
  }

  // 顶层键白名单只管「键」，不管「值」：图标类字段要额外做 URL 安全判定，
  // 否则远程配置可让客户端去请求内网地址（详见 isSafeRemoteAssetUrl 注释）。
  for (const key of ICON_REPO_KEYS) {
    if (key in cleanConfig && !isSafeRemoteAssetUrl(cleanConfig[key])) {
      delete cleanConfig[key];
      strippedKeys.push(key);
    }
  }
  if (cleanConfig.groupIcons && typeof cleanConfig.groupIcons === 'object') {
    for (const [groupName, iconConf] of Object.entries(cleanConfig.groupIcons)) {
      if (typeof iconConf === 'string') {
        if (!isSafeRemoteAssetUrl(iconConf)) {
          delete cleanConfig.groupIcons[groupName];
          strippedKeys.push(`groupIcons.${groupName}`);
        }
        continue;
      }
      const dropped = [];
      sanitizeIconFields(iconConf, `groupIcons.${groupName}`, dropped);
      strippedKeys.push(...dropped);
      if (iconConf && typeof iconConf === 'object' && Object.keys(iconConf).length === 0) {
        delete cleanConfig.groupIcons[groupName];
      }
    }
    if (Object.keys(cleanConfig.groupIcons).length === 0) delete cleanConfig.groupIcons;
  }
  if (cleanConfig.customServices && typeof cleanConfig.customServices === 'object') {
    const dropped = [];
    sanitizeIconFields(cleanConfig.customServices, 'customServices', dropped);
    strippedKeys.push(...dropped);
  }

  return { ok: true, config: cleanConfig, strippedKeys };
}

module.exports = {
  REMOTE_CONFIG_FORBIDDEN_KEYS,
  hardenRemoteConfig
};
