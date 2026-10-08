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
 * 对不可信远程配置执行能力剥夺（基于白名单收敛 fail-closed）。
 *
 * @param {object} rawConfig 解析后的远程配置对象
 * @returns {{ ok: boolean, reason?: string, config: object, strippedKeys: string[] }}
 *          ok=false 表示该配置引用了不被允许的资源（如本地文件路径），调用方应整体拒绝
 */
function hardenRemoteConfig(rawConfig) {
  const config = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};

  // 订阅源只允许 http(s)：否则可把服务器上的任意本地文件当作订阅读取并回显（任意文件读取）
  const subs = Array.isArray(config.subscriptions) ? config.subscriptions : [];
  const illegal = subs.find(
    s => s && typeof s === 'object' && s.url && !/^https?:\/\//i.test(String(s.url))
  );
  if (illegal) {
    return {
      ok: false,
      reason: 'remote config may only reference http(s) subscription URLs',
      config,
      strippedKeys: []
    };
  }

  const strippedKeys = [];
  for (const key of Object.keys(config)) {
    if (!ALLOWED_SET.has(key)) {
      delete config[key];
      strippedKeys.push(key);
    }
  }

  return { ok: true, config, strippedKeys };
}

module.exports = {
  REMOTE_CONFIG_FORBIDDEN_KEYS,
  REMOTE_CONFIG_ALLOWED_KEYS,
  hardenRemoteConfig
};
