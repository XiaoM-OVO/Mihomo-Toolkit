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

const stableStringify = require('fast-json-stable-stringify');

// ─────────────────────────────────────────────────────────────────────────────
// 1. 字段分类表 (Field Classification)
// ─────────────────────────────────────────────────────────────────────────────

/** 数据面：允许从订阅合并的字段（仅限节点集合语义） */
const DATA_PLANE_KEYS = new Set([
  'proxies',
  'proxy-providers'
]);

/** 控制面：绝对禁止从非 master 订阅透传的字段 */
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
 * @param {boolean} [options.isMaster=false] 是否为受信 master 订阅
 * @param {string}  [options.tag=''] 订阅标识（用于审计）
 * @returns {{ data: object, report: object }}
 */
function partitionControlPlane(subConfig, options = {}) {
  const { isMaster = false, tag = '' } = options;
  const report = {
    tag,
    isMaster,
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

/** 稳定键顺序的 JSON 序列化，用于确定性深度比较 */
function canonicalJson(obj) {
  if (obj === undefined) return 'undefined';
  return stableStringify(obj);
}

/**
 * 合并多个订阅的数据面，并仲裁控制面归属。
 *
 * 仲裁规则（确定性、与完成顺序无关）：
 *   R1. 用户本地配置 > master 订阅 > 非 master 订阅（非 master 无控制面权）
 *   R2. 严格 Fail-Closed：未在 masterControlWhitelist 明确允许的未知控制面键坚决剥离，绝不泄漏穿透
 *   R3. 同一层级内出现**互斥取值**时 fail-closed：丢弃该字段并上报，而非先到先得
 *   R4. 多个 master 声明视为配置错误，直接抛错（防止隐式竞争）
 *
 * @param {Array<{tag:string, config:object, isMaster:boolean}>} sources
 * @param {object} [localConfig={}] 用户本地声明的控制面（最高优先级）
 * @param {object} [options={}]
 * @param {string[]} [options.masterControlWhitelist] 显式允许 master 订阅合并的受控控制面字段白名单
 * @returns {{ merged: object, audits: Array<object>, conflicts: Array<object> }}
 */
function mergeSubscriptionConfigs(sources = [], localConfig = {}, options = {}) {
  const audits = [];
  const conflicts = [];
  const masters = sources.filter(s => s.isMaster);

  if (masters.length > 1) {
    throw new Error(
      `[ControlPlane] 检测到 ${masters.length} 个 master 订阅 (${masters.map(m => m.tag).join(', ')})，` +
      `控制权仲裁必须唯一，请在配置中显式指定且仅指定一个 master。`
    );
  }

  const merged = { proxies: [] };
  const claimedBy = new Map(); // key -> { tag, value }
  const masterWhitelist = new Set(options.masterControlWhitelist || []);

  for (const { tag, config, isMaster } of sources) {
    const { data, report } = partitionControlPlane(config, { isMaster, tag });
    audits.push(report);

    // 数据面：proxies 无条件并集
    if (Array.isArray(data.proxies)) {
      merged.proxies = merged.proxies.concat(data.proxies);
    }

    // 数据面：proxy-providers 深度合并与冲突上报
    if (data['proxy-providers'] && typeof data['proxy-providers'] === 'object') {
      merged['proxy-providers'] = merged['proxy-providers'] || {};
      for (const [pKey, pVal] of Object.entries(data['proxy-providers'])) {
        if (!merged['proxy-providers'][pKey]) {
          merged['proxy-providers'][pKey] = pVal;
          claimedBy.set(`proxy-providers.${pKey}`, { tag, value: pVal });
        } else {
          const prev = claimedBy.get(`proxy-providers.${pKey}`);
          if (prev && canonicalJson(prev.value) !== canonicalJson(pVal)) {
            conflicts.push({
              key: `proxy-providers.${pKey}`,
              a: prev.tag,
              b: tag,
              resolution: 'conflict:kept-first'
            });
          }
        }
      }
    }

    // 控制面：仅当显式授权 masterControlWhitelist 且为 master 时，才允许白名单内的字段合并
    // 任何未在白名单登记的未知字段一律 fail-closed，杜绝任何未知键被合并穿透！
    if (isMaster && masterWhitelist.size > 0) {
      for (const [key, value] of Object.entries(config)) {
        if (!masterWhitelist.has(key)) continue;
        if (DATA_PLANE_KEYS.has(key)) continue;
        if (Object.prototype.hasOwnProperty.call(localConfig, key)) continue;

        if (!claimedBy.has(key)) {
          claimedBy.set(key, { tag, value });
          merged[key] = value;
        } else {
          const prev = claimedBy.get(key);
          if (canonicalJson(prev.value) !== canonicalJson(value)) {
            conflicts.push({ key, a: prev.tag, b: tag, resolution: 'fail-closed:dropped' });
            delete merged[key];
          }
        }
      }
    }
  }

  // 用户本地声明始终拥有最终否决权
  for (const [key, value] of Object.entries(localConfig)) {
    if (value !== undefined) merged[key] = value;
  }

  return { merged, audits, conflicts };
}

module.exports = {
  DATA_PLANE_KEYS,
  CONTROL_PLANE_KEYS,
  HOSTILE_SIGNATURES,
  partitionControlPlane,
  mergeSubscriptionConfigs
};
