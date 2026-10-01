/**
 * -----------------------------------------------------------------------------
 * Data Layer: 只读安全基线词典 (Read-only Security Baselines)
 * -----------------------------------------------------------------------------
 * 本模块属于 `src/data/` 只读数据层：**纯数据 + 纯函数、零副作用、零 I/O**，
 * 随程序一同发布，不读取 `config.yaml`、不感知运行环境。
 *
 * 语义约定（与 `config.yaml` 的分工）：
 *   - 本文件是「运行基础」：程序据此判定什么是危险的，属于**程序所有、用户只读**。
 *   - `config.yaml` 是「操作者的选择」：它只能在基线之上做**加法**
 *     （追加受保护域名、追加骨架豁免组），**永远不能做减法**。
 *   - 因此这些清单**不可**通过配置文件删除或替换，也不允许被 `?config=` 远程来源触及。
 *
 * 为什么不放进 `src/config/`：
 *   一旦基线落入 `DEFAULT_CONFIG`，它就会参与 `Object.assign(DEFAULT_CONFIG, userConfig)`
 *   的合并，从而被远程 `?config=` 的不可信配置整体覆写（等于给攻击者一个「自我放行」开关）。
 *   把基线钉在只读数据层，是让「危险的定义」与「运行的选择」在物理上分离。
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 1. 受保护域名基线（禁止被 hosts 覆盖）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 证书体系 / 开发 / 身份 / 支付 / 即时通讯 / 游戏 / 浏览器等被投毒后果最严重的域。
 *
 * 注意：这是**枚举式兜底**，无法穷尽长尾域名；完整防护仍依赖
 * `assetClosure: strict` + `assetDomainAllowlist` 收紧节点资产继承范围。
 * 用户如需补充，请用 `protectedDomains` 配置项**追加**（本清单不可被削减）。
 */
const PROTECTED_DOMAINS = [
  // 开发者基础设施 / 包管理（供应链投毒面）
  'github.com', 'githubusercontent.com', 'gitlab.com', 'npmjs.com', 'npmjs.org',
  'pypi.org', 'python.org', 'nodejs.org', 'rust-lang.org', 'golang.org',
  // 操作系统更新与身份账号
  'microsoft.com', 'windowsupdate.com', 'live.com', 'office.com', 'apple.com', 'icloud.com',
  'google.com', 'gstatic.com', 'googleapis.com', 'android.com',
  // 云与 CDN 基础设施
  'cloudflare.com', 'cloudflare-dns.com', 'amazonaws.com', 'amazon.com',
  // AI 服务（对话内容与 API 凭据）
  'openai.com', 'anthropic.com', 'claude.ai', 'chatgpt.com',
  // 即时通讯与支付
  'telegram.org', 't.me', 'whatsapp.com', 'signal.org',
  'paypal.com', 'stripe.com', 'alipay.com', 'alibaba.com', 'alicdn.com',
  'taobao.com', 'tmall.com', 'jd.com', 'qq.com', 'weixin.qq.com', 'tencent.com',
  // 国内内容平台
  'baidu.com', 'bilibili.com', 'zhihu.com', 'weibo.com',
  // 游戏平台与浏览器
  'steampowered.com', 'steamcommunity.com', 'epicgames.com', 'mozilla.org',
  // CA 与证书签发（被投毒即可签发任意站点证书）
  'letsencrypt.org', 'digicert.com', 'verisign.com',
  // 公共 DNS 服务商（被投毒即可污染整条解析链）
  'dns.alidns.com', 'doh.pub', 'dns.google', 'one.one.one.one',
  'adguard-dns.io', 'nextdns.io', 'quad9.net', 'mozilla.cloudflare-dns.com'
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. 骨架策略组豁免基线（禁止被空组剪枝斩首）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DAG 级联剪枝时**必须保留**的基础骨架组：即便暂时无节点可用也不得移除，
 * 否则面板会出现「无手动选择/无兜底出口」的不可用状态。
 *
 * 用户如需补充自己的常驻组名，请用 `exemptGroups` 配置项**追加**。
 */
const SKELETON_EXEMPT_GROUPS = ['手动选择', '漏网之鱼', '📍 手动选择', '🐟 漏网之鱼'];

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fake-IP 过滤器基线（内核出站直连与本地服务保护）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * fake-ip-filter 的保底名单：局域网/本地域名、NTP 校时、Windows 连通性探测、
 * STUN 与主机游戏联机域名。这些域名一旦被 fake-ip 接管会导致断网或联机失败。
 */
const FAKEIP_FILTER_BASELINE = [
  '*.lan', '*.local', '*.arpa', 'time.*.com', 'ntp.*.com',
  'localhost.ptlogin2.qq.com', '*.msftncsi.com', '*.msftconnecttest.com', 'www.msftconnecttest.com',
  'ipv6.msftncsi.com', 'ipv6.msftconnecttest.com', '*.ipv6-literal.net', 'google.cn',
  '*.music.163.com', '*.music.126.net', '+.stun.*.*',
  '+.nintendo.net', '+.playstation.net', '+.xboxlive.com'
];

// ─────────────────────────────────────────────────────────────────────────────
// 4. 基线合并工具（纯函数）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 规范化单个域名条目：小写、去空白、剥离 `+.` / `*.` / 前导点与尾随点。
 * @param {unknown} value
 * @returns {string} 规范化结果；非法输入返回空串
 */
function normalizeDomainEntry(value) {
  const bare = String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/^[+*]\./, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  if (!bare) return '';
  // 仅接受形如 a.b / a.b.c 的域名；拒绝 URL、通配符残留、纯 IP 与畸形串
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(bare)) return '';
  if (/^\d+(\.\d+){3}$/.test(bare)) return '';
  return bare;
}

/**
 * 规范化域名清单（去重、保序）。
 * @param {unknown} list
 * @returns {string[]}
 */
function normalizeDomainList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const norm = normalizeDomainEntry(item);
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

/**
 * 基线 + 用户追加 的**只增不减**合并：基线永远在前且不可被移除。
 * @param {string[]} baseline 只读基线（本模块常量）
 * @param {unknown} additions 用户在 config.yaml 中追加的条目
 * @param {(v: unknown) => string} [normalize] 条目规范化器，默认按域名处理
 * @returns {string[]}
 */
function mergeBaseline(baseline, additions, normalize = normalizeDomainEntry) {
  const out = [];
  const push = (raw) => {
    const norm = normalize(raw);
    if (norm && !out.includes(norm)) out.push(norm);
  };
  (Array.isArray(baseline) ? baseline : []).forEach(push);
  (Array.isArray(additions) ? additions : []).forEach(push);
  return out;
}

/**
 * 条目规范化器注册表：字段声明里的 `normalize` 标签 → 具体规范化函数。
 * 供 `src/config/` 在合并 additive 字段时选用。
 */
const ENTRY_NORMALIZERS = {
  domain: normalizeDomainEntry,
  text: (value) => String(value == null ? '' : value).trim()
};

/**
 * 受保护域名的**生效值**：只读基线 ∪ 用户追加。
 *
 * 此函数是幂等的（对已合并过的输入再调用不会改变结果），因此**在判定点自持基线**是安全的：
 * 即便某个调用方漏做了配置合并、或直接传入了 `[]`，也绝不会退化成「没有受保护域名」
 * 这种 fail-open 状态。
 *
 * @param {unknown} additions 用户追加条目
 * @returns {string[]}
 */
function effectiveProtectedDomains(additions) {
  return mergeBaseline(PROTECTED_DOMAINS, additions, normalizeDomainEntry);
}

/**
 * 骨架豁免组的**生效值**：只读基线 ∪ 用户追加（幂等，同上）。
 * @param {unknown} additions 用户追加条目
 * @returns {string[]}
 */
function effectiveExemptGroups(additions) {
  return mergeBaseline(SKELETON_EXEMPT_GROUPS, additions, ENTRY_NORMALIZERS.text);
}

module.exports = {
  PROTECTED_DOMAINS,
  SKELETON_EXEMPT_GROUPS,
  FAKEIP_FILTER_BASELINE,
  ENTRY_NORMALIZERS,
  normalizeDomainEntry,
  normalizeDomainList,
  mergeBaseline,
  effectiveProtectedDomains,
  effectiveExemptGroups
};
