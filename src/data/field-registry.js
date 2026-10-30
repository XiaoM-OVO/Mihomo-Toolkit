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
const { DEFAULT_ROUTING } = require('./default-routing');
const { GROUP_KEYS, groupName } = require('./catalog/identity');

/**
 * 字段声明表。
 *
 * 约定：
 *   - `trust: 'local'` 的字段会被自动纳入 `REMOTE_DENIED_FIELDS`（远程不可信配置必被剥夺）。
 *     判定标准是「**该值被误改后，得利方是不是攻击者**」——凡符合者一律 `local`。
 *   - `merge: 'additive'` 的字段必须同时给出 `baseline`（来自只读基线词典），
 *     合并结果 = 基线 ∪ 用户值，**基线不可被用户删除或替换**。
 */
/** 节点域名解析器出厂默认值：必须保持纯 IP 形式，用于识别用户是否显式覆盖 */
const DEFAULT_PROXY_SERVER_DNS = Object.freeze(['223.5.5.5', '119.29.29.29']);

const FIELDS = [
  // ── 【1. 基础全局配置】 ───────────────────────────────────────────────────
  { key: 'enablePipeline', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '流水线总控：设为 false 则跳过策略编排与拓扑构建，仅交付清洗后的节点' },
  { key: 'logLevel', type: 'string', default: 'info', merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '日志级别: silent | error | warn | info | debug' },
  { key: 'osType', type: 'string', default: 'windows', merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '设备类型: windows | mac | linux | all' },
  { key: 'trafficDirection', type: 'string', default: 'split', merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '流量方向: split(默认，国内直连/海外代理) | return(回国，国内代理/海外直连)——只影响 DNS 上游、QUIC 拦截目标与 WebRTC 分支' },
  { key: 'defaultProxyMode', type: 'string', default: 'auto', merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '默认代理策略: auto / manual / fallback（特殊: direct / reject）' },
  { key: 'enableIPv6', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '全局 IPv6：控制 TUN、DNS 及路由（本地无物理 IPv6 请保持 false）' },
  { key: 'showFeatureIcon', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '基础全局配置', doc: '特征图标：true(Emoji) / false(文字)' },
  { key: 'include', type: 'string[]', default: [], merge: 'override', trust: 'local',
    group: '基础全局配置', doc: '通用配置片段挂载：片段与主文件同一 schema，主文件优先、数组并集去重、支持递归 include（可读本地文件，仅可信来源可写）' },
  { key: 'servicesConfigFile', type: 'string', default: '', merge: 'override', trust: 'local',
    group: '基础全局配置', doc: '外部服务定义配置文件路径（可 require 本地代码，仅可信来源可写）' },

  // ── 【2. 节点清洗与处理】 ─────────────────────────────────────────────────
  { key: 'enableDedupe', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '节点去重：剔除底层物理特征完全重复的注水节点' },
  { key: 'enableNodeSort', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '节点智能排序：按大区、线路质量、倍率有序排布' },
  { key: 'assetClosure', type: 'string', default: 'standard', merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '节点专属 DNS 依赖继承强度: standard / strict / off' },
  { key: 'assetDomainAllowlist', type: 'string[]', default: [], merge: 'override', trust: 'local',
    group: '节点清洗与处理', doc: 'assetClosure=strict 时允许被继承的域名（仅可信来源可写）' },
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
  { key: 'blockKeywords', type: 'string[]', default: [], merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '黑名单关键词: 节点名包含即拦截（优先于白名单）' },
  { key: 'blockServers', type: 'string[]', default: [], merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '黑名单服务器: server 字段包含即拦截（优先于白名单）' },
  { key: 'specialNodeRules', type: 'object[]', default: [], merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '自定义重命名规则: { reg, targetName }' },
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
  { key: 'highMultiThreshold', type: 'number', default: 2.5, merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '高倍率阈值：超过此值排序自动下沉' },
  { key: 'nodeIpVersion', type: 'string', default: '', merge: 'override', trust: 'any',
    group: '节点清洗与处理', doc: '节点连接 IP 栈策略: "" (保持原样) | dual (双栈并发竞速) | ipv6-prefer | ipv4-prefer | ipv6 | ipv4' },

  // ── 【3. 策略组建组与 UI 面板】 ───────────────────────────────────────────
  { key: 'minorNodeThreshold', type: 'number', default: 3, merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '小众地区建组阈值' },
  { key: 'coreRegions', type: 'string[]', default: ['cn', 'hk', 'tw', 'jp', 'kr', 'sg', 'us'], merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '主力免折叠大区：即使节点数低于阈值也保证独立建组' },
  { key: 'regionGroupType', type: 'string', default: 'url-test', merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '地区组行为: url-test | select | fallback' },
  { key: 'enableRegionHashLB', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '地区组是否增加哈希负载均衡策略组' },
  { key: 'hideUnknownGroup', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: `隐藏${groupName(GROUP_KEYS.unknown)}节点组` },
  { key: 'groupIconMode', type: 'string', default: 'emoji', merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '策略组图标: emoji | icon | both | none' },
  { key: 'groupIcons', type: 'object', default: {}, merge: 'override', trust: 'any',
    group: '策略组建组与 UI 面板', doc: '自定义策略组/骨架组的图标与 Emoji 覆盖映射表' },
  { key: 'iconRepoOrz', type: 'string', default: 'https://fastly.jsdelivr.net/gh/Orz-3/mini@master/Color/',
    merge: 'override', trust: 'any', group: '策略组建组与 UI 面板', doc: '在线图标仓库 (Orz-3)' },
  { key: 'iconRepoKoolson', type: 'string', default: 'https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/',
    merge: 'override', trust: 'any', group: '策略组建组与 UI 面板', doc: '在线图标仓库 (Koolson)' },
  { key: 'iconRepoLige47', type: 'string', default: 'https://fastly.jsdelivr.net/gh/lige47/lige_icon@main/icon/',
    merge: 'override', trust: 'any', group: '策略组建组与 UI 面板', doc: '在线图标仓库 (lige47)' },
  // DAG 级联剪枝的骨架豁免组：新增项走 additive（基线只能追加不可删减）
  { key: 'exemptGroups', type: 'string[]', default: [], merge: 'additive', trust: 'local',
    baseline: SKELETON_EXEMPT_GROUPS, normalize: 'text', group: '策略组建组与 UI 面板',
    doc: '在骨架豁免基线之外追加「豁免空组剪枝清理」的策略组名' },

  // ── 【4. 扩展分流服务】 ───────────────────────────────────────────────────
  // 分流不再有开关：哪些品类 / 服务参与分流，只由 `routing` 表决定
  // （默认表见 src/data/default-routing.js：表里出现即生效，没写就没有）。
  { key: 'customServices', type: 'object', default: {}, merge: 'override', trust: 'any',
    group: '扩展分流服务', doc: '行内自定义服务字典' },
  { key: 'aiPreferredRegions', type: 'string[]', default: ['us', 'jp', 'tw', 'sg', 'kr', 'eu'],
    merge: 'override', trust: 'any', group: '扩展分流服务', doc: 'AI 策略组地区保底优先列表' },
  { key: 'residentialNodeGroups', type: 'object', default: {}, merge: 'override', trust: 'any',
    group: '扩展分流服务', doc: '家宽节点注入映射（需 `enableIsolation` 打开家宽池）' },
  { key: 'enableIsolation', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '扩展分流服务', doc: '隔离机制总开关：打开后启用家宽 / 高倍率 / 实验三个内置隔离池（成员从地区池剔除）' },
  { key: 'pools', type: 'object[]', default: [], merge: 'override', trust: 'local',
    group: '扩展分流服务', doc: '自定义节点池：match/exclude 圈定节点集合；isolate 池成员从地区池剔除；被 `@pool:<池名>` 或分流规则引用时才建组' },

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
  { key: 'dnsServer', type: 'string[]', default: [...DEFAULT_PROXY_SERVER_DNS],
    merge: 'override', trust: 'local', group: 'DNS 与 Hosts 安全面', doc: '节点服务器域名专用解析 DNS' },

  // ── 【8. 安全防漏与内核覆写】 ─────────────────────────────────────────
  { key: 'enableTrafficAudit', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '流量审计' },
  { key: 'overwriteTun', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '覆写 TUN 配置' },
  { key: 'overwriteDns', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '覆写 DNS 总开关' },
  { key: 'overwriteSniffer', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '覆写 Sniffer 配置' },
  { key: 'enableCoreOptimize', type: 'boolean', default: true, merge: 'override', trust: 'any',
    group: '安全防漏与内核覆写', doc: '覆写核心内核优化' },

  // ── 【9. 节点裂变】（代码以 `config.enableFission` 形式读取，此前同样未登记） ──
  { key: 'enableFission', type: 'boolean', default: false, merge: 'override', trust: 'any',
    group: '节点裂变', doc: '是否开启单域名多 IP 裂变增殖' },
  { key: 'fissionStack', type: 'string', default: 'all', merge: 'override', trust: 'any',
    group: '节点裂变', doc: '裂变协议栈偏好: all(双栈) | v4 | v6' },
  { key: 'fissionMaxNodes', type: 'number', default: 5, merge: 'override', trust: 'any',
    group: '节点裂变', doc: '单域名最大裂变节点数' },
  { key: 'fissionExcludeKeywords', type: 'string[]', default: [], merge: 'override', trust: 'any',
    group: '节点裂变', doc: '包含这些关键词的节点跳过裂变' },

  // ── 【10. 规则集与图标仓库来源】（此前代码读取但从未登记，用户无从发现） ──────
  { key: 'geositeRepo', type: 'string', default: 'MetaCubeX/meta-rules-dat@meta/geo/geosite',
    merge: 'override', trust: 'any', group: '规则集与图标仓库来源',
    doc: 'geosite 域名规则集仓库路径（配合 ruleProviderCDN 组成完整 URL）' },
  { key: 'geoipRepo', type: 'string', default: 'MetaCubeX/meta-rules-dat@meta/geo/geoip',
    merge: 'override', trust: 'any', group: '规则集与图标仓库来源',
    doc: 'geoip 网段规则集仓库路径（配合 ruleProviderCDN 组成完整 URL）' },

  // ── 【11. 进程分流名单】（此前代码读取但从未登记） ────────────────────────
  { key: 'customProcessWin', type: 'string[]', default: [],
    merge: 'override', trust: 'any', group: '进程分流名单',
    doc: 'Windows 自定义进程名单（默认直连；仅在 routing 使用 `{ preset: process }` 时生效，可用 to 改道）' },
  { key: 'customProcessMac', type: 'string[]', default: [],
    merge: 'override', trust: 'any', group: '进程分流名单',
    doc: 'macOS 自定义进程名单（默认直连；仅在 routing 使用 `{ preset: process }` 时生效，可用 to 改道）' },
  { key: 'customProcessLin', type: 'string[]', default: [],
    merge: 'override', trust: 'any', group: '进程分流名单',
    doc: 'Linux 自定义进程名单（默认直连；仅在 routing 使用 `{ preset: process }` 时生效，可用 to 改道）' },
  { key: 'btProcessWin', type: 'string[]',
    default: ['qBittorrent', 'Thunder', 'BitComet', 'uTorrent', 'aria2c'],
    merge: 'override', trust: 'any', group: '进程分流名单',
    doc: 'Windows BT 客户端进程名单（默认直连，可用 `{ preset: bt, to }` 整段改道）' },
  { key: 'btProcessMac', type: 'string[]',
    default: ['Thunder', 'BitComet', 'uTorrent', 'qbittorrent', 'aria2c', 'transmission-daemon'],
    merge: 'override', trust: 'any', group: '进程分流名单',
    doc: 'macOS BT 客户端进程名单（默认直连，可用 `{ preset: bt, to }` 整段改道）' },
  { key: 'btProcessLin', type: 'string[]',
    default: ['qbittorrent', 'aria2c', 'transmission-daemon'],
    merge: 'override', trust: 'any', group: '进程分流名单',
    doc: 'Linux BT 客户端进程名单（默认直连，可用 `{ preset: bt, to }` 整段改道）' },
  { key: 'downloadProcessWin', type: 'string[]', default: ['IDMan', 'fdm'],
    merge: 'override', trust: 'any', group: '进程分流名单',
    doc: 'Windows 下载软件进程名单（默认走下载出口组，可用 `{ preset: download, to }` 改道）' },
  { key: 'downloadProcessMac', type: 'string[]', default: ['fdm'],
    merge: 'override', trust: 'any', group: '进程分流名单',
    doc: 'macOS 下载软件进程名单（默认走下载出口组，可用 `{ preset: download, to }` 改道）' },
  { key: 'downloadProcessLin', type: 'string[]', default: [],
    merge: 'override', trust: 'any', group: '进程分流名单',
    doc: 'Linux 下载软件进程名单（默认走下载出口组，可用 `{ preset: download, to }` 改道）' },

  // ── 【12. 订阅源与拉取设置】（无出厂默认值：由代码内兜底，此处仅登记契约） ──
  // 说明：`default: undefined` 的字段不会进入 DEFAULT_CONFIG（保持出厂配置面不变），
  // 但它们**被登记**了，因此会参与「代码读取 ⊆ 注册表」的一致性校验与远程信任级派生。
  { key: 'subscriptions', type: 'object[]', merge: 'override', trust: 'any',
    group: '订阅源与拉取设置', doc: '订阅源列表（url/uri/tag/enabled/proxy/retry/resetDay…）' },
  { key: 'fetchProxyPort', type: 'number', merge: 'override', trust: 'local',
    group: '订阅源与拉取设置', doc: '拉取代理端口（可把订阅拉取指向本机任意端口，仅可信来源可写）' },
  { key: 'fetchProxyStrategy', type: 'string', merge: 'override', trust: 'local',
    group: '订阅源与拉取设置', doc: '拉取出口策略: direct | proxy | auto' },
  { key: 'fetchRetry', type: 'number', merge: 'override', trust: 'any',
    group: '订阅源与拉取设置', doc: '拉取失败重试次数（代码内兜底 2）' },
  { key: 'fetchTimeout', type: 'number', merge: 'override', trust: 'any',
    group: '订阅源与拉取设置', doc: '单次拉取超时秒数（代码内兜底 15）' },
  { key: 'fetchStaleTtl', type: 'number', merge: 'override', trust: 'any',
    group: '订阅源与拉取设置', doc: '容灾复用上次成功缓存的小时数（代码内兜底 24）' },
  { key: 'expireCutoffHours', type: 'number', default: 24, merge: 'override', trust: 'any',
    group: '订阅源与拉取设置', doc: '到期前 N 小时判定订阅已停用（默认 24，到期时刻前 24h 停用；0=关闭）' },
  { key: 'expireAggregation', type: 'string', merge: 'override', trust: 'any',
    group: '订阅源与拉取设置', doc: '多订阅到期聚合策略: min | max | first' },
  { key: 'timezone', type: 'string', default: 'local', merge: 'override', trust: 'any',
    group: '订阅源与拉取设置', doc: '看板日期时区（IANA 名称如 Asia/Shanghai；留空或 local 跟随系统）' },

  // ── 【13. 运行模式与缓存】 ───────────────────────────────────────────────
  { key: 'outputMode', type: 'string', merge: 'override', trust: 'any',
    group: '运行模式与缓存', doc: '交付形态: config | nodes | report（等价于 CLI --mode / -m）' },
  { key: 'output', type: 'string', merge: 'override', trust: 'local',
    group: '运行模式与缓存', doc: '产物输出路径（等价于 CLI -o，涉及本地磁盘写入，仅可信来源可写）' },
  { key: 'enableCache', type: 'boolean', merge: 'override', trust: 'any',
    group: '运行模式与缓存', doc: '是否启用内存构建缓存（默认 true）' },
  { key: 'cacheTtl', type: 'number', merge: 'override', trust: 'any',
    group: '运行模式与缓存', doc: '新鲜缓存有效秒数（默认 300）' },
  { key: 'cacheStaleMaxAge', type: 'number', merge: 'override', trust: 'any',
    group: '运行模式与缓存', doc: 'SWR 陈旧缓存最大容忍秒数（默认 86400；超期则同步重构）' },
  { key: 'redactLevel', type: 'string', merge: 'override', trust: 'local',
    group: '运行模式与缓存', doc: '日志脱敏档位: off | partial | full（远程配置不得降级脱敏）' },
  { key: 'enableChineseConvert', type: 'boolean', merge: 'override', trust: 'any',
    group: '运行模式与缓存', doc: '简繁智能转换开关' },
  { key: 'chineseConvertMode', type: 'string', merge: 'override', trust: 'any',
    group: '运行模式与缓存', doc: '简繁转换方向: s2t | t2s' },

  // ── 【14. 自定义规则入口】 ───────────────────────────────────────────────
  { key: 'customRuleProviders', type: 'object', merge: 'override', trust: 'local',
    group: '自定义规则入口', doc: '自定义 Rule-Provider 定义（name → {type, behavior, url…}，防出网探测仅可信来源可写）' },
  { key: 'groups', type: 'object[]', merge: 'override', trust: 'local',
    group: '自定义规则入口', doc: '统一策略组声明清单（`{ ref: <键> }` 引用内置组目录并允许条目内覆写字段，`disabled: true` 显式关闭，`direction: split|return` 限定生效方向）；只声明组的成员与呈现，不产出分流规则——规则一律写进 `routing`' },
  { key: 'routing', type: 'object[]', merge: 'override', trust: 'local', default: DEFAULT_ROUTING,
    group: '自定义规则入口',
    doc: '分流表：数组顺序即优先级，条目支持 `preset` / `service` / `rule` + `to` / `disabled` / `direction`；是规则生成的唯一来源（默认值即 `src/data/default-routing.js` 的默认顺序表）' },
  { key: 'subDomain', type: 'string[]', merge: 'override', trust: 'any',
    group: '自定义规则入口', doc: '订阅服务域名或 IP（自动注入为直连分流规则与 fake-ip-filter，防止客户端拉取订阅走代理循环与高延迟）' },

  // ── 【15. 安全与资源配额】 ───────────────────────────────────────────────
  { key: 'security', type: 'object', merge: 'override', trust: 'local',
    group: '安全与资源配额',
    doc: '资源配额上限（maxTotalNodes / perSubscriptionMaxNodes / maxSubscriptionBytes…）；' +
         '标记为 local 是因为流水线会直接读取它，若远程 ?config= 可写即可自我放宽配额、绕过 DoS 防御' },
  { key: 'hosts', type: 'object', merge: 'override', trust: 'local',
    group: '安全与资源配额', doc: '静态 hosts 映射（受保护域名与内网重定向默认被拒绝）' },
  { key: 'nameserverPolicy', type: 'object', merge: 'override', trust: 'local',
    group: '安全与资源配额', doc: '按域分流解析链（保留键不可被覆盖）' },
  { key: 'trustedHostDomains', type: 'string[]', merge: 'override', trust: 'local',
    group: '安全与资源配额', doc: 'hosts 豁免受保护域名的例外清单（可解除基线保护，仅可信来源可写）' },
  { key: 'allowInternalHosts', type: 'boolean', merge: 'override', trust: 'local',
    group: '安全与资源配额', doc: '是否允许 hosts 指向内网（等同开放内网探测）' },
  { key: 'fakeIpFilter', type: 'string[]', merge: 'override', trust: 'local',
    group: '安全与资源配额', doc: 'fake-ip-filter 追加条目' },
  { key: 'fakeIpFilterNodes', type: 'string', merge: 'override', trust: 'local',
    group: '安全与资源配额', doc: '节点防环注入模式: smart | exact | off' }
];

/** 字段名 → 声明 索引 */
const FIELDS_BY_KEY = Object.freeze(
  FIELDS.reduce((acc, f) => { acc[f.key] = f; return acc; }, {})
);

/**
 * 已删除字段名单（校验期用于给出迁移提示）。
 *
 * 这些键曾经是合法配置，删掉后若被静默忽略，用户会以为开关还生效、实际产物
 * 已按新默认表生成——属于最隐蔽的 fail-open。因此配置里再出现它们时直接报错，
 * 并指向迁移对照表。
 *
 * 注意：这里只登记**已退役的公开字段**。内部的运行时选项（`mode` / `silent`
 * 一类）不走本名单，也不进入字段注册表。
 */
const REMOVED_FIELDS = Object.freeze([
  // 批次 3 之前退役
  'dnsMergeMode', 'airportTagReg', 'enableDomesticGroup', 'proxyFirst',
  // 订阅标签改由入站阶段按订阅源自动写入，不再需要开关与手动指定
  'enableAirportTag', 'airportTag',
  // 批次 3 退役：分流开关
  'enableAdBlock', 'enableAntiAD', 'enableAI', 'enableStreaming', 'enableSocial',
  'enableGame', 'enableSystemServices', 'enableGitHub', 'enableScholar',
  'enableTelegram', 'enableCrypto', 'enablePayPal', 'enableWebRTC',
  'enableProcessDirect', 'enableQUICReject',
  // 批次 3 退役：服务清单（改由 routing 表表达）
  'aiServices', 'streamingServices', 'socialServices', 'gameServices',
  'systemServices', 'devServices',
  // DSL 收口：规则与组彻底分家
  'customRules', 'customGroups',
  // 节点池收口：隔离开关并入 enableIsolation + pools
  'enableResidential', 'isolateHighMulti', 'isolateExperimental', 'isolateDownload',
  // process 段正名：直连/代理语义改为「自定义进程 / BT 客户端 / 下载软件」
  'processDirectWin', 'processDirectMac', 'processDirectLin',
  'processProxyWin', 'processProxyMac', 'processProxyLin'
]);

/**
 * 由注册表派生出厂默认配置（保持声明顺序）。
 *
 * `default` 为 `undefined` 的字段**不进入** DEFAULT_CONFIG：它们代表「代码内有兜底、
 * 但没有出厂默认值」的配置项（如 `fetchRetry`）。登记它们是为了让
 * 「代码读取 ⊆ 注册表」的一致性校验与信任级派生能覆盖到，而不是为了给它们编一个默认值。
 *
 * @returns {object}
 */
function buildDefaultConfig() {
  const config = {};
  for (const field of FIELDS) {
    if (field.default === undefined) continue;
    const value = field.merge === 'additive' && field.baseline
      ? []                       // 基线不落到 defaults：它由 data 层持有，合并时注入
      : field.default;
    config[field.key] = Array.isArray(value)
      ? value.map(item => (item && typeof item === 'object' ? { ...item } : item))
      : value;
  }
  return config;
}

/** 无出厂默认值的已登记字段（用户可写、代码内兜底） */
const DEFAULTLESS_FIELDS = Object.freeze(FIELDS.filter(f => f.default === undefined));

/** 需要「基线 ∪ 用户值」合并的字段（基线永远保留） */
const ADDITIVE_FIELDS = Object.freeze(FIELDS.filter(f => f.merge === 'additive'));

/**
 * 远程不可信配置（`?config=`）必须被剥夺的字段全集：
 * 注册表中 `trust: 'local'` 的字段。
 */
const REMOTE_DENIED_FIELDS = Object.freeze(
  FIELDS.filter(f => f.trust === 'local').map(f => f.key)
);

/**
 * 远程不可信配置（`?config=`）允许放行的字段全集（白名单）：
 * 注册表中 `trust: 'any'` 的字段。
 */
const REMOTE_ALLOWED_FIELDS = Object.freeze(
  FIELDS.filter(f => f.trust === 'any').map(f => f.key)
);

module.exports = {
  DEFAULT_PROXY_SERVER_DNS,
  FIELDS,
  FIELDS_BY_KEY,
  REMOVED_FIELDS,
  ADDITIVE_FIELDS,
  DEFAULTLESS_FIELDS,
  REMOTE_DENIED_FIELDS,
  REMOTE_ALLOWED_FIELDS,
  buildDefaultConfig
};
