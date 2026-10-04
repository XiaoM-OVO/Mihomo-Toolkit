/**
 * -----------------------------------------------------------------------------
 * Core Layer: 控制面净化器 (Control-Plane Sanitizer)
 * -----------------------------------------------------------------------------
 * 严格遵循洋葱模型 Core 层规范：
 * 1. 绝对无副作用：无网络 I/O、无磁盘读写、无全局状态
 * 2. 纯函数设计：输入 (subConfig, options) 输出 (safeConfig, report)
 * 3. 单一职责：判定并剥离**不可信订阅**对 Mihomo 全局控制面的所有影响力
 *
 * 威胁模型：订阅内容是攻击者可控的第三方输入。任何能改变「解析结果、路由出口、
 * 监听面、控制面鉴权」的字段都属于控制面，必须与节点数据面严格隔离。
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 1. 字段分类表 (Field Classification)
// ─────────────────────────────────────────────────────────────────────────────

/** 数据面：允许从订阅合并的字段（仅限节点集合语义） */
const DATA_PLANE_KEYS = new Set([
  'proxies',
  'proxy-providers'
]);

/** 控制面：绝对禁止从外部订阅透传的字段 */
const CONTROL_PLANE_KEYS = new Set([
  // DNS 与解析
  'dns',
  'hosts',
  'sniffer',
  // 路由与出口
  'rules',
  'sub-rules',
  'rule-providers',
  'proxy-groups',
  'tunnels',
  'listeners',
  'interface-name',
  'routing-mark',
  'tproxy-port',
  'redir-port',
  'mixed-port',
  'port',
  'socks-port',
  'allow-lan',
  'bind-address',
  'lan-allowed-ips',
  'lan-disallowed-ips',
  'authentication',
  'skip-auth-prefixes',
  // 入站 / 内核接管
  'tun',
  'iptables',
  'auto-redirect',
  'auto-route',
  'strict-route',
  'ebpf',
  // 控制面与鉴权
  'external-controller',
  'external-controller-tls',
  'external-controller-cors',
  'external-controller-pipe',
  'external-controller-unix',
  'external-ui',
  'external-ui-name',
  'external-ui-url',
  'secret',
  'experimental',
  // 内核行为与供应链
  'geodata-mode',
  'geodata-loader',
  'geox-url',
  'geo-auto-update',
  'geo-update-interval',
  'asn',
  'mode',
  'log-level',
  'ipv6',
  'unified-delay',
  'tcp-concurrent',
  'keep-alive-interval',
  'find-process-mode',
  'global-client-fingerprint',
  'profile',
  'script',
  'ntp',
  'tls',
  'keep-alive-idle',
  'disable-keep-alive',
  'etag-support'
]);

/**
 * 危险字段分级：命中即视为**主动攻击特征**而非配置误合并。
 * 用于在审计报告中升级告警，并可为调用方提供 fail-closed 依据。
 */
const HOSTILE_SIGNATURES = [
  { re: /^external-controller(-tls|-unix|-pipe|-cors)?$/i, id: 'CP-EXT-CTRL', severity: 'critical', note: '订阅试图夺取内核 API 控制权（可被用于远程改写配置）' },
  { re: /^secret$/i, id: 'CP-SECRET', severity: 'critical', note: '订阅试图预设 API 密钥' },
  { re: /^external-ui(-name|-url)?$/i, id: 'CP-EXT-UI', severity: 'high', note: '订阅试图注入外部 Web 面板资源' },
  { re: /^(allow-lan|bind-address|lan-allowed-ips|lan-disallowed-ips)$/i, id: 'CP-LAN', severity: 'critical', note: '订阅试图开放或改写局域网/公网入站与访问控制' },
  { re: /^(mixed-port|port|socks-port|tproxy-port|redir-port)$/i, id: 'CP-PORT', severity: 'high', note: '订阅试图改写监听端口' },
  { re: /^tunnels$/i, id: 'CP-TUNNEL', severity: 'critical', note: '订阅试图建立到内网的流量隧道' },
  { re: /^listeners$/i, id: 'CP-LISTENERS', severity: 'critical', note: '订阅试图注册入站监听器' },
  { re: /^(geox-url|geo-auto-update|geo-update-interval)$/i, id: 'CP-GEOX', severity: 'high', note: '订阅试图改写地理数据库来源（路由结论污染）' },
  { re: /^dns$/i, id: 'CP-DNS', severity: 'high', note: '订阅试图改写 DNS 控制面' },
  { re: /^hosts$/i, id: 'CP-HOSTS', severity: 'high', note: '订阅试图写入 hosts 静态映射' },
  { re: /^tun$/i, id: 'CP-TUN', severity: 'high', note: '订阅试图改写 TUN 接管参数' },
  { re: /^(rules|sub-rules|rule-providers)$/i, id: 'CP-RULES', severity: 'high', note: '订阅试图改写路由规则' },
  { re: /^(proxy-groups)$/i, id: 'CP-GROUPS', severity: 'high', note: '订阅试图改写策略组（影响出口选择）' },
  { re: /^script$/i, id: 'CP-SCRIPT', severity: 'critical', note: '订阅试图注入脚本执行' }
];

/**
 * 对单个订阅顶层配置做控制面剥离。
 * @param {object} subConfig 解析后的订阅原始配置对象
 * @param {object} [options]
 * @param {string}  [options.tag=''] 订阅标识（用于审计）
 * @returns {{ data: object, report: object }}
 */
function partitionControlPlane(subConfig, options = {}) {
  const { tag = '' } = options;
  const report = {
    tag,
    stripped: [],   // 被剥离的字段
    hostile: [],    // 命中攻击特征的字段
    kept: []        // 被允许合并的字段
  };

  if (!subConfig || typeof subConfig !== 'object') {
    return { data: {}, report };
  }

  const data = {};

  for (const [key, value] of Object.entries(subConfig)) {
    const signature = HOSTILE_SIGNATURES.find(s => s.re.test(key));

    if (DATA_PLANE_KEYS.has(key)) {
      data[key] = value;
      report.kept.push(key);
      continue;
    }

    if (CONTROL_PLANE_KEYS.has(key) || signature) {
      report.stripped.push(key);
      if (signature) {
        report.hostile.push({ key, id: signature.id, severity: signature.severity, note: signature.note });
      }
      continue;
    }

    // 未登记字段：默认拒绝（fail-closed），并标记为待人工归类的未知键。
    // 这是关键设计：宁可丢字段，不可让新版本内核的新控制面字段静默穿透。
    report.stripped.push(key);
    report.hostile.push({
      key,
      id: 'CP-UNKNOWN',
      severity: 'medium',
      note: '未登记字段，按 fail-closed 策略剥离，请人工归类'
    });
  }

  return { data, report };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 交付契约 (Delivery Contract)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 工具自有顶层键 (Toolkit-Owned Top-Level Keys)。
 *
 * config 交付模式产出的内核配置**只允许**出现这些键，且全部由本工具的策略层
 * (strategy.js / dns.js / kernel.js) 生成。任何来自外部的其它顶层键一律 fail-closed 剥离。
 *
 * 历史缺陷：config 模式曾直接复用外部输入的顶层配置作为输出骨架，导致订阅可把
 * `external-controller` / `secret` / `script` / `tunnels` / `geox-url` / `hosts` 等
 * 字段随产物下发到用户内核。现由「生成前重置 + 交付前收口」两层保证（见 pipeline/config.js）。
 *
 * 注意：`proxy-providers` 刻意不在白名单内 —— 它会让内核在运行时从外部 URL 拉取节点，
 * 属于不可审计的运行时数据面来源，不参与交付。
 */
const TOOLKIT_OUTPUT_KEYS = new Set([
  'proxies',              // 数据面：清洗后的节点
  'proxy-groups',         // 策略层：策略组拓扑
  'rules',                // 策略层：分流规则
  'rule-providers',       // 策略层：规则集提供者
  'dns',                  // 内核层：DNS 覆写
  'hosts',                // 内核层：节点专属优选 IP (资产闭包内)
  'ipv6',                 // 内核层：地址族开关
  'tun',                  // 内核层：TUN 接管
  'sniffer',              // 内核层：域名嗅探
  'profile',              // 内核层：持久化
  'unified-delay',
  'tcp-concurrent',
  'keep-alive-interval',
  'find-process-mode'
]);

/**
 * 生成前重置：删除输入骨架里全部工具自有键（`proxies` 除外，它由清洗流水线重建）。
 *
 * 目的：某些内核层覆写是可开关的（如 overwriteTun=false、overwriteDns=false），
 * 若只做「生成后白名单」，被关闭的覆写会放任输入骨架里的同名键原样存活。
 * 先在生成前清空，即可保证「工具自有键要么由本工具生成，要么不存在」。
 *
 * @param {object} config 待清理的配置骨架（原地修改）
 * @returns {string[]} 被清除的键
 */
function resetToolkitOutputKeys(config) {
  const removed = [];
  if (!config || typeof config !== 'object') return removed;
  for (const key of TOOLKIT_OUTPUT_KEYS) {
    if (key === 'proxies') continue;
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      delete config[key];
      removed.push(key);
    }
  }
  return removed;
}

/**
 * 交付前收口：仅保留工具自有顶层键，其余一律剥离（fail-closed）。
 *
 * @param {object} config 待交付的配置对象（原地修改）
 * @param {object} [options]
 * @param {string[]} [options.extraAllowed] 调用方显式追加允许的键（默认无）
 * @returns {{ kept: string[], stripped: string[] }}
 */
function enforceOutputContract(config, options = {}) {
  const kept = [];
  const stripped = [];
  if (!config || typeof config !== 'object') return { kept, stripped };

  const extra = Array.isArray(options.extraAllowed) ? options.extraAllowed : [];
  const allowed = extra.length > 0 ? new Set([...TOOLKIT_OUTPUT_KEYS, ...extra]) : TOOLKIT_OUTPUT_KEYS;

  for (const key of Object.keys(config)) {
    if (allowed.has(key)) {
      kept.push(key);
      continue;
    }
    stripped.push(key);
    delete config[key];
  }

  return { kept, stripped };
}

module.exports = {
  TOOLKIT_OUTPUT_KEYS,
  partitionControlPlane,
  resetToolkitOutputKeys,
  enforceOutputContract
};
