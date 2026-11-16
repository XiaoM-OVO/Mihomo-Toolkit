/**
 * standalone 单文件脚本的固定回归场景
 * -----------------------------------------------------------------------------
 * 目的：`standalone/src/mihomo-toolkit.js` 是用户直接粘贴进客户端的交付物，
 * 不接入 `src/` 的分层校验与单元测试，历史上每次改动只能靠「贴进客户端看效果」验证。
 * 本文件把「固定订阅样本 + 固定配置 → 最终产物」这条链路固定下来，
 * 让任何整理 / 重构都能被断言验证，而不是被口头保证。
 *
 * 约束：
 *   - 订阅样本必须保持稳定，不允许加入依赖当前时间的字段（脚本本身不使用 Date / random）；
 *   - 新增场景时优先扩展现有样本，而不是复制一份微调过的订阅。
 */

const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', '..', 'standalone', 'src', 'mihomo-toolkit.js');
const { main } = require(MODULE_PATH);

/**
 * 固定订阅样本：覆盖清洗链路的主要分支
 * - 正规地区节点（多地、多协议、多传输层）
 * - 低倍率下载节点 / 高倍率节点 / 实验节点
 * - 广告引流节点、信息公告节点、纯 IPv6 节点
 * - 内置策略（DIRECT / REJECT）
 * - 一对物理重复节点（仅 enableDedupe 时生效）
 */
function buildSubscription() {
  const proxies = [
    { name: '🇭🇰 香港 IEPL 01 | x2', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
    { name: '🇭🇰 香港 BGP 02 高速', type: 'trojan', server: '1.1.1.2', port: 443, password: 'p2', sni: 'hk.example.com' },
    { name: '🇯🇵 日本 东京 03 专线', type: 'vmess', server: '2.2.2.1', port: 443, uuid: '11111111-2222-3333-4444-555555555551', alterId: 0, network: 'ws' },
    { name: '🇯🇵 日本 大阪 04', type: 'vless', server: '2.2.2.2', port: 443, uuid: '11111111-2222-3333-4444-555555555552', network: 'grpc', tls: true },
    { name: '🇺🇸 美国 洛杉矶 05', type: 'trojan', server: '3.3.3.1', port: 443, password: 'p3', sni: 'us.example.com' },
    { name: '🇺🇸 美国 家宽 06', type: 'ss', server: '3.3.3.2', port: 8443, cipher: 'chacha20-ietf-poly1305', password: 'p4' },
    { name: '🇹🇼 台湾 07 CN2', type: 'ss', server: '4.4.4.1', port: 443, cipher: 'aes-256-gcm', password: 'p5' },
    { name: '🇸🇬 新加坡 08', type: 'tuic', server: '5.5.5.1', port: 443, uuid: '11111111-2222-3333-4444-555555555553', password: 'p6' },
    { name: '🇩🇪 德国 法兰克福 09', type: 'ss', server: '6.6.6.1', port: 443, cipher: 'aes-128-gcm', password: 'p7' },
    { name: '🇭🇰 香港 下载 0.5x 10', type: 'ss', server: '1.1.1.3', port: 443, cipher: 'aes-128-gcm', password: 'p8' },
    { name: '🇭🇰 香港 高倍率 x3.5 11', type: 'ss', server: '1.1.1.4', port: 443, cipher: 'aes-128-gcm', password: 'p9' },
    { name: '🧪 测试 香港 实验 12', type: 'ss', server: '1.1.1.5', port: 443, cipher: 'aes-128-gcm', password: 'p10' },
    // 广告引流：应当被前置拦截
    { name: '官网 https://t.me/example 防失联 点击入群', type: 'ss', server: '7.7.7.1', port: 443, cipher: 'aes-128-gcm', password: 'p11' },
    // 信息公告节点：应进入看板而不是节点池
    { name: '剩余流量：100 GB', type: 'ss', server: '', port: 0, cipher: 'none', password: '' },
    // 纯 IPv6：enableIPv6=false 时应被丢弃
    { name: '🇭🇰 香港 纯 IPv6 13', type: 'ss', server: '2400:3200::1', port: 443, cipher: 'aes-128-gcm', password: 'p12' },
    // 物理重复：与 01 的传输层身份完全一致，仅 enableDedupe 时被剔除
    { name: '🇭🇰 香港 IEPL 01 | x2 (复制)', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
    { name: 'DIRECT', type: 'direct' },
    { name: 'REJECT', type: 'reject' },
  ];

  return { proxies, 'proxy-groups': [], rules: [] };
}

/** 深拷贝，避免场景之间互相污染 main() 的原地改写 */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * 静默执行脚本：脚本内部通过 console 打日志，
 * 测试里必须拦截，否则几十行日志会淹没真正的失败信息。
 */
function runSilently(overrides) {
  const logs = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args) => logs.push(args.join(' '));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    const output = main(buildSubscription(), overrides || {});
    return { output: clone(output), logs, raw: output };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

/** 跑一次场景并返回可直接对比 / 落盘的纯数据产物 */
function buildStandaloneOutput(overrides) {
  return runSilently(overrides).output;
}

const SCENARIOS = [
  {
    name: 'default',
    fixture: 'standalone-mihomo-toolkit.golden.json',
    overrides: {},
  },
  {
    name: 'isolate-strict',
    fixture: 'standalone-mihomo-toolkit.isolate-strict.golden.json',
    overrides: {
      enableDedupe: true,
      strictRegionMatch: true,
      isolateDownload: true,
      isolateHighMulti: true,
      isolateExperimental: true,
      enableDomesticGroup: true,
      logLevel: 'silent',
    },
  },
];

module.exports = { SCENARIOS, buildSubscription, buildStandaloneOutput, runSilently, main };
