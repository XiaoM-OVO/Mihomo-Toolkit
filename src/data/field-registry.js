/**
 * -----------------------------------------------------------------------------
 * Data Layer: 配置字段注册表 (Field Registry / Single Source of Truth)
 * -----------------------------------------------------------------------------
 * 本模块属于 `src/data/` 只读数据层：**纯数据、零副作用、零 I/O**。
 *
 * 它回答的唯一问题是「**本程序有哪些字段**」，并为每个字段一次性声明四件事：
 *   1. `default`  —— 出厂默认值（安全姿态的一部分：默认值被误改＝漏洞）
 *   2. `type`     —— 值域类型（文档与后续校验依据）
 *   3. `merge`    —— 与用户配置的合并语义：`override`(覆盖) ｜ `additive`(只增不减)
 *   4. `trust`    —— 谁有权写：`any`(任意来源) ｜ `local`(仅可信本地来源，远程 `?config=` 必剥夺)
 *
 * 为什么要把这些元数据集中在这里：
 *   旧实现中「默认值」「字段类型」「远程配置剥夺清单」「文档示例」是四份互不相干的手工清单，
 *   于是每次新增字段都要记得同时改四处；漏改 `REMOTE_CONFIG_FORBIDDEN_KEYS` 就会让一个
 *   安全开关悄悄变成远程可写（`?config=<恶意链接>` 可覆写），且没有任何测试会发现。
 *   现在：默认值由本表派生，远程剥夺清单由 `trust` 派生，漂移在结构上不可能发生。
 *
 * `src/config/` 只负责「**调用什么、改什么**」：合并与运行时兜底；
 * 「危险的定义」与「运行的选择」在物理上分处两层。
 */

'use strict';

const {
  PROTECTED_DOMAINS,
  SKELETON_EXEMPT_GROUPS
} = require('./security-baselines');

/**
 * 字段声明表。
 *
 * 约定：
 *   - `trust: 'local'` 的字段会被自动纳入 `REMOTE_DENIED_FIELDS`（远程不可信配置必被剥夺）。
 *     判定标准是「**该值被误改后，得利方是不是攻击者**」——凡符合者一律 `local`。
 *   - `merge: 'additive'` 的字段必须同时给出 `baseline`（来自只读基线词典），
 *     合并结果 = 基线 ∪ 用户值，**基线不可被用户删除或替换**。
 */
const FIELDS = [
  // ── 【1. 基础全局配置】 ───────────────────────────────────────────────────
  { key: 'enableScript', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '脚本总控：设为 false 则原样输出订阅内容' },
  { key: 'logLevel', type: 'string', default: 'info', merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '日志级别: silent | error | warn | info | debug' },
  { key: 'osType', type: 'string', default: 'windows', merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '设备类型: windows | mac | linux | all' },
  { key: 'proxyFirst', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '路由偏好：true(海外代理优先)，false(国内直连优先)' },
  { key: 'defaultProxyMode', type: 'string', default: 'auto', merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '默认代理策略: auto / manual / fallback（特殊: direct / reject）' },
  { key: 'enableIPv6', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '全局 IPv6：控制 TUN、DNS 及路由（本地无物理 IPv6 请保持 false）' },
  { key: 'enableAirportTag', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '标签提取：订阅合并时自动/手动捕捉标签内容' },
  { key: 'airportTag', type: 'string', default: '', merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '手动指定标签（逗号分隔），为空则自动正则检测' },
  { key: 'airportTagReg', type: 'regex', default: /^\[([^\]]{1,8})\]/i, merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '自定义标签提取正则（默认提取首部方括号内容）' },
  { key: 'showFeatureIcon', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '特征图标：true(Emoji) / false(文字)' },

  // ── 【2. 节点清洗与处理】 ─────────────────────────────────────────────────
  { key: 'enableDedupe', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '节点去重：剔除底层物理特征完全重复的注水节点' },
  { key: 'assetClosure', type: 'string', default: 'standard', merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '节点专属 DNS 依赖继承强度: standard / strict / off' },
  { key: 'assetDomainAllowlist', type: 'string[]', default: [], merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: 'assetClosure=strict 时允许被继承的域名（只收窄不放宽）' },
  { key: 'enableDashboard', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '订阅看板：为流量/到期信息建立独立策略组' },
  { key: 'removeInfoNodes', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '过滤机场自带的原生说明/流量提示伪节点' },
  { key: 'renameTemplate', type: 'string',
    default: '[{airport}] {icon} {region} {index} {features} | {in} {city} {line} {multi} {ip_stack} · {transport}',
    merge: 'override', trust: 'any', group: '节点清洗与处理', doc: '节点重命名模板' },
  { key: 'renameSeparators', type: 'string[]',
    default: ['|', '-', '·', '/', '~', ':', ',', ';', '_', '=', '+', '*', '>', '<', '➩', '=>', '->'],
    merge: 'override', trust: 'any', group: '节点清洗与处理', doc: '允许自动清理的悬空符号' },
  { key: 'whitelistKeywords', type: 'string[]', default: [], merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '白名单关键词: 包含即放行并保留原名' },
  { key: 'specialNodeRules', type: 'object[]', default: [], merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '自定义重命名规则: { reg, targetName }' },
  { key: 'customNodeGroups', type: 'object', default: {}, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '自定义节点分组: 指定节点进入哪些应用组' },
  { key: 'indexPrefixMap', type: 'object', default: {}, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '序号前缀映射: 键=订阅标签, 值=前缀' },
  { key: 'enableNodeRename', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '二次重命名：设为 false 则直接继承原节点名' },
  { key: 'strictRegionMatch', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '未知地区匹配：true(严格字典)，false(宽松国旗捕获)' },
  { key: 'adTextThreshold', type: 'number', default: 6, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '纯文本广告判定长度阈值' },
  { key: 'lowMultiThreshold', type: 'number', default: 0.99, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '低倍率分流阈值（0 关闭）' },
  { key: 'isolateDownload', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '低倍率节点是否从普通大区池剔除' },
  { key: 'highMultiThreshold', type: 'number', default: 2.5, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '高倍率阈值：超过此值排序自动下沉' },
  { key: 'isolateHighMulti', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '高倍率节点是否独立成组' },
  { key: 'isolateExperimental', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '实验节点是否独立成组' },

  // ── 【3. 策略组建组与 UI 面板】 ───────────────────────────────────────────
  { key: 'minorNodeThreshold', type: 'number', default: 3, merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '小众地区建组阈值' },
  { key: 'regionGroupType', type: 'string', default: 'url-test', merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '地区组行为: url-test | select | fallback' },
  { key: 'enableRegionHashLB', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '地区组是否增加哈希负载均衡策略组' },
  { key: 'hideGarbageGroup', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '隐藏垃圾桶组' },
  { key: 'groupIconMode', type: 'string', default: 'emoji', merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '策略组图标: emoji | icon | both' },
  { key: 'iconRepoOrz', type: 'string', default: 'https://fastly.jsdelivr.net/gh/Orz-3/mini@master/Color/',
    merge: 'override', trust: 'any', group: '策略组建组与 UI 面板', doc: '在线图标仓库 (Orz-3)' },
  { key: 'iconRepoKoolson', type: 'string', default: 'https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/',
    merge: 'override', trust: 'any', group: '策略组建组与 UI 面板', doc: '在线图标仓库 (Koolson)' },
  { key: 'iconRepoLige47', type: 'string', default: 'https://fastly.jsdelivr.net/gh/lige47/lige_icon@main/icon/',
    merge: 'override', trust: 'any', group: '策略组建组与 UI 面板', doc: '在线图标仓库 (lige47)' },
  // DAG 级联剪枝的骨架豁免组：新增项走 additive（基线只能追加不可删减）
  { key: 'exemptGroups', type: 'string[]', default: [], merge: 'additive', trust: 'local',
    baseline: SKELETON_EXEMPT_GROUPS, normalize: 'text', group: '策略组建组与 UI 面板',
    doc: '在骨架豁免基线之外追加「永不被空组剪枝斩首」的策略组名' },

  // ── 【4. 核心分流开关】 ───────────────────────────────────────────────────
  { key: 'enableAdBlock', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '核心分流开关', doc: '广告拦截' },
  { key: 'enableAI', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '核心分流开关', doc: 'AI 助手独立分流' },
  { key: 'enableTelegram', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '核心分流开关', doc: 'Telegram 独立分流' },
  { key: 'enableStreaming', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '核心分流开关', doc: '流媒体服务分流' },
  { key: 'enableGame', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '核心分流开关', doc: '游戏平台分流' },
  { key: 'enableSystemServices', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '核心分流开关', doc: '系统服务分流' },
  { key: 'enableDomesticGroup', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '核心分流开关', doc: '中国分流独立策略组' },

  // ── 【5. 扩展分流开关】 ───────────────────────────────────────────────────
  { key: 'servicesConfigFile', type: 'string', default: '', merge: 'override', trust: 'local',
    group: '扩展分流开关', doc: '外部服务定义配置文件路径（可 require 本地代码，仅可信来源可写）' },
  { key: 'customServices', type: 'object', default: {}, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: '行内自定义服务字典' },
  { key: 'aiServices', type: 'string[]', default: ['chatgpt', 'gemini', 'claude', 'copilot'],
    merge: 'override', trust: 'any', group: '扩展分流开关', doc: 'AI 服务清单' },
  { key: 'streamingServices', type: 'string[]',
    default: ['youtube', 'netflix', 'bilibili', 'disney', 'spotify', 'tiktok', 'bahamut', 'pixiv', 'twitch'],
    merge: 'override', trust: 'any', group: '扩展分流开关', doc: '流媒体服务清单' },
  { key: 'socialServices', type: 'string[]', default: ['twitter', 'facebook', 'instagram', 'discord'],
    merge: 'override', trust: 'any', group: '扩展分流开关', doc: '海外社交服务清单' },
  { key: 'independentSocial', type: 'string[]', default: ['twitter'],
    merge: 'override', trust: 'any', group: '扩展分流开关', doc: '独立成组的社交应用' },
  { key: 'gameServices', type: 'string[]',
    default: ['steam', 'epic', 'riot', 'blizzard', 'nintendo', 'playstation', 'xbox', 'ubisoft', 'origin', 'ea'],
    merge: 'override', trust: 'any', group: '扩展分流开关', doc: '游戏平台服务清单' },
  { key: 'systemServices', type: 'string[]', default: ['microsoft', 'apple', 'google'],
    merge: 'override', trust: 'any', group: '扩展分流开关', doc: '操作系统云服务清单' },
  { key: 'aiPreferredRegions', type: 'string[]', default: ['us', 'jp', 'tw', 'sg', 'kr', 'eu'],
    merge: 'override', trust: 'any', group: '扩展分流开关', doc: 'AI 策略组地区保底优先列表' },
  { key: 'enableAntiAD', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: '激进广告拦截 (anti-AD)' },
  { key: 'enableGitHub', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: '开发者选项分流' },
  { key: 'enableScholar', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: '学术资源分流' },
  { key: 'enableSocial', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: '海外社交分流' },
  { key: 'enableCrypto', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: '加密货币分流' },
  { key: 'enablePayPal', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: '金融支付分流' },
  { key: 'enableResidential', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: '家宽节点分流' },
  { key: 'enableWebRTC', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: 'WebRTC 专项分流' },
  { key: 'residentialNodeGroups', type: 'object', default: {}, merge: 'override', trust: 'any',
    group: '扩展分流开关', doc: '家宽节点注入映射' },

  // ── 【6. 网络测速与规则集】 ───────────────────────────────────────────────
  { key: 'testInterval', type: 'number', default: 300, merge: 'override', trust: 'any',
    group: '网络测速与规则集', doc: '测速间隔（秒）' },
  { key: 'testTolerance', type: 'number', default: 50, merge: 'override', trust: 'any',
    group: '网络测速与规则集', doc: '切换阈值（延迟差低于此值不切换）' },
  { key: 'useMRS', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '网络测速与规则集', doc: '极速规则模式：true(MRS) / false(YAML)' },
  { key: 'testURL', type: 'string', default: 'https://cp.cloudflare.com/generate_204',
    merge: 'override', trust: 'any', group: '网络测速与规则集', doc: '延迟测速地址' },
  { key: 'ruleProviderCDN', type: 'string', default: 'https://fastly.jsdelivr.net/gh',
    merge: 'override', trust: 'any', group: '网络测速与规则集', doc: '规则集 CDN 前缀' },

  // ── 【7. DNS 与 Hosts 安全面】 ───────────────────────────────────────────
  { key: 'dnsListen', type: 'string', default: '127.0.0.1:1053', merge: 'override', trust: 'local',
    group: 'DNS 与 Hosts 安全面', doc: 'DNS 监听地址（非回环需 dnsAllowNonLoopback）' },
  { key: 'dnsAllowNonLoopback', type: 'boolean', default: false, merge: 'override', trust: 'local',
    group: 'DNS 与 Hosts 安全面', doc: '安全铁律(INV-8)：是否允许非回环监听（对外开放解析器）' },
  { key: 'allowPrivateDns', type: 'boolean', default: false, merge: 'override', trust: 'local',
    group: 'DNS 与 Hosts 安全面', doc: '是否允许私网/保留地址作为解析器' },
  { key: 'trustedPrivateCidrs', type: 'string[]', default: [], merge: 'override', trust: 'local',
    group: 'DNS 与 Hosts 安全面', doc: '显式信任的私网解析器网段' },
  // 受保护域名：只读基线 + 用户追加（只能加，不能减）
  { key: 'protectedDomains', type: 'string[]', default: [], merge: 'additive', trust: 'local',
    baseline: PROTECTED_DOMAINS, normalize: 'domain', group: 'DNS 与 Hosts 安全面',
    doc: '在受保护域名基线之外**追加**禁止被 hosts 覆盖的域名（基线不可删除）' },
  { key: 'dnsDefault', type: 'string[]', default: ['223.5.5.5', '119.29.29.29'],
    merge: 'override', trust: 'local', group: 'DNS 与 Hosts 安全面', doc: '引导 DNS（必须纯 IP）' },
  { key: 'dnsDirect', type: 'string[]',
    default: ['https://223.5.5.5/dns-query', 'https://120.53.53.53/dns-query', '223.5.5.5', '119.29.29.29'],
    merge: 'override', trust: 'local', group: 'DNS 与 Hosts 安全面', doc: '直连域名解析链' },
  { key: 'dnsProxy', type: 'string[]',
    default: ['https://8.8.8.8/dns-query', 'https://1.1.1.1/dns-query'],
    merge: 'override', trust: 'local', group: 'DNS 与 Hosts 安全面', doc: '海外代理域名解析链' },
  { key: 'dnsServer', type: 'string[]', default: ['223.5.5.5', '119.29.29.29'],
    merge: 'override', trust: 'local', group: 'DNS 与 Hosts 安全面', doc: '节点服务器域名专用解析 DNS' },

  // ── 【8. 安全防漏与底层内核覆写】 ─────────────────────────────────────────
  { key: 'enableProcessDirect', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '进程直连防漏' },
  { key: 'enableTrafficAudit', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '流量审计' },
  { key: 'enableQUICReject', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: 'QUIC 智能分流' },
  { key: 'overwriteTun', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '覆写 TUN 配置' },
  { key: 'overwriteDns', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '覆写 DNS 总开关' },
  { key: 'dnsMergeMode', type: 'string', default: 'secure', merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '保留字段：生产实现固定为权威覆写（等价 secure）' },
  { key: 'overwriteSniffer', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '覆写 Sniffer 配置' },
  { key: 'enableCoreOptimize', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '覆写核心内核优化' }
];

/**
 * 别名输入字段：流水线与历史版本接受、但**没有出厂默认值**的字段名。
 *
 * 它们同样承载「触碰本机资源 / 改写 DNS 控制面」的能力，因此必须与注册表中
 * `trust: 'local'` 的字段一同被远程不可信配置剥夺。之所以不在 `FIELDS` 里，
 * 是因为它们不属于「程序声明的默认字段面」，无法从注册表派生默认值。
 */
const ALIAS_REMOTE_DENIED_FIELDS = [
  { key: 'servicesConfig', doc: 'servicesConfigFile 的行内别名' },
  { key: 'fetchProxyPort', doc: '把抓取指向本机任意端口' },
  { key: 'fetchProxyStrategy', doc: '抓取出口策略（可强制走本机代理）' },
  { key: 'nameserverPolicy', doc: 'DNS 控制面：按域分流解析链' },
  { key: 'hosts', doc: 'DNS 控制面：静态 hosts 映射' },
  { key: 'trustedHostDomains', doc: '受保护域名的豁免清单（可解除基线保护）' },
  { key: 'allowInternalHosts', doc: '允许 hosts 指向内网（等同开放内网探测）' },
  { key: 'fakeIpFilter', doc: 'DNS 控制面：fake-ip-filter 注入' },
  { key: 'fakeIpFilterNodes', doc: 'DNS 控制面：节点防环注入模式' }
];

/** 字段名 → 声明 索引 */
const FIELDS_BY_KEY = Object.freeze(
  FIELDS.reduce((acc, f) => { acc[f.key] = f; return acc; }, {})
);

/**
 * 由注册表派生出厂默认配置（保持声明顺序）。
 * @returns {object}
 */
function buildDefaultConfig() {
  const config = {};
  for (const field of FIELDS) {
    const value = field.merge === 'additive' && field.baseline
      ? []                       // 基线不落到 defaults：它由 data 层持有，合并时注入
      : field.default;
    config[field.key] = Array.isArray(value) ? [...value] : value;
  }
  return config;
}

/** 需要「基线 ∪ 用户值」合并的字段（基线永远保留） */
const ADDITIVE_FIELDS = Object.freeze(FIELDS.filter(f => f.merge === 'additive'));

/**
 * 远程不可信配置（`?config=`）必须被剥夺的字段全集：
 * 注册表中 `trust: 'local'` 的字段 ∪ 别名输入字段。
 */
const REMOTE_DENIED_FIELDS = Object.freeze([
  ...FIELDS.filter(f => f.trust === 'local').map(f => f.key),
  ...ALIAS_REMOTE_DENIED_FIELDS.map(f => f.key)
]);

module.exports = {
  FIELDS,
  FIELDS_BY_KEY,
  ALIAS_REMOTE_DENIED_FIELDS,
  ADDITIVE_FIELDS,
  REMOTE_DENIED_FIELDS,
  buildDefaultConfig
};
