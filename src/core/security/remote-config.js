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

/**
 * 不可信配置中被禁止的字段（能力剥夺清单）。
 *
 * 部署方如需自定义 DNS 面，请写在服务端本地 config.yaml（可信来源）中，
 * 或通过本工具提供的显式配置项声明。
 */
const REMOTE_CONFIG_FORBIDDEN_KEYS = [
  // ① 触碰服务器本机资源
  'servicesConfigFile',   // 可 require 任意本地 .js/.cjs
  'servicesConfig',
  'fetchProxyPort',       // 可把抓取指向服务器本地任意端口
  'fetchProxyStrategy',
  // ② DNS 控制面：解析链
  'dnsListen',
  'dnsAllowNonLoopback',
  'dnsDefault',
  'dnsDirect',
  'dnsProxy',
  'dnsServer',
  'nameserverPolicy',
  'allowPrivateDns',
  'trustedPrivateCidrs',
  // ③ DNS 控制面：hosts 与 fake-ip
  'hosts',
  'trustedHostDomains',
  'allowInternalHosts',
  'fakeIpFilter',
  'fakeIpFilterNodes'
];

/**
 * 对不可信远程配置执行能力剥夺。
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
  for (const key of REMOTE_CONFIG_FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      delete config[key];
      strippedKeys.push(key);
    }
  }

  return { ok: true, config, strippedKeys };
}

module.exports = {
  REMOTE_CONFIG_FORBIDDEN_KEYS,
  hardenRemoteConfig
};
