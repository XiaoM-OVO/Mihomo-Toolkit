/**
 * Mihomo-Toolkit TypeScript 类型定义文件
 * 适用于 Node.js、Sub-Store 以及各类二次开发场景
 */

// ─────────────────────────────────────────────────────────────────────────────
// 基础枚举与联合类型
// ─────────────────────────────────────────────────────────────────────────────

export type OutputMode = 'config' | 'nodes' | 'report';
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';
export type RedactLevel = 'off' | 'partial' | 'full';
export type ProxyStrategy = 'direct' | 'proxy' | 'auto';
export type FissionStack = 'all' | 'v4' | 'v6';
export type ChineseConvertMode = 's2t' | 't2s';

// ─────────────────────────────────────────────────────────────────────────────
// 订阅配置项
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionConfig {
  /** 订阅名称或机场标识（用于节点打标与日志显示） */
  name?: string;
  /** 远端订阅 URL 地址 */
  url?: string;
  /** 单个或多个自建节点 URI（如 ss://, vmess://, vless://, trojan://） */
  uri?: string;
  /** 是否启用该订阅项（默认为 true，设为 false 临时停用） */
  enabled?: boolean;
  /** 抓取代理开关：true 走代理，false 强制直连，省略则继承全局 fetchProxyStrategy */
  proxy?: boolean;
  /** 自定义请求头（如 User-Agent、Authorization 等） */
  headers?: Record<string, string>;
  /** 订阅解析失败重试次数（覆盖全局 fetchRetry，默认继承全局值） */
  retry?: number;
  /** 每月重置日（1-31），用于自动计算"距离重置剩余 X 天" */
  resetDay?: number;
  /** 保留节点原名，不执行模板重命名，且豁免垃圾与广告拦截 */
  keepName?: boolean;
  /** 手动指定该订阅节点注入的目标策略组列表（如 ['🤖 ChatGPT', '📍 手动选择']） */
  groups?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 节点清洗模块配置 (pure-nodes)
// ─────────────────────────────────────────────────────────────────────────────

export interface PureConfig {
  /** 是否启用「📊 订阅与状态看板」独立展示策略组（展示流量/到期/重置，不污染主力节点池） */
  enableDashboard?: boolean;
  /** 是否开启物理参数去重（默认为 false） */
  enableDedupe?: boolean;
  /** 严格地区匹配模式：为 true 时仅匹配完全确信的地区名 */
  strictRegionMatch?: boolean;
  /** 是否在节点名中显示特征 Emoji 图标（如 🚀, 🏠, 🛰️） */
  showFeatureIcon?: boolean;
  /** 是否开启节点重命名格式化 */
  enableNodeRename?: boolean;
  /** 节点重命名模板字符串或自定义命名函数 */
  renameTemplate?: string | ((vars: Record<string, string>, proxy: any) => string);
  /** 允许作为分隔符被自动清理的悬空符号列表 */
  renameSeparators?: string[];
  /** 机场前缀映射表 (如: { "机场A": "A" }) */
  indexPrefixMap?: Record<string, string>;

  // 🧬 节点裂变
  /** 是否开启单域名多 IP 节点裂变增殖（默认为 false） */
  enableFission?: boolean;
  /** 裂变协议栈偏好：all (保留所有), v4 (仅IPv4), v6 (仅IPv6) */
  fissionStack?: FissionStack;
  /** 单个节点最大裂变生成的子节点数量（默认 5） */
  fissionMaxNodes?: number;
  /** 裂变黑名单关键词（包含这些词的节点跳过裂变） */
  fissionExcludeKeywords?: string[];

  // 🚫 节点名白名单
  /** 全局节点名白名单关键词列表（白名单节点不被剔除） */
  whitelistKeywords?: string[];
  /** 全局节点名黑名单关键词列表（节点名包含即拦截，优先于白名单） */
  blockKeywords?: string[];
  /** 服务器字段黑名单列表（server 包含即拦截，优先于白名单） */
  blockServers?: string[];
  /**
   * 节点连接时的 IP 协议栈偏好策略 (Mihomo 原生 ip-version 字段)
   * - "" (默认): 保持节点原有下发状态，不强行注入
   * - "dual": 开启 Happy Eyeballs 双栈并发竞速（推荐）
   * - "ipv6-prefer": 优先连接 IPv6
   * - "ipv4-prefer": 优先连接 IPv4
   * - "ipv6": 仅走 IPv6
   * - "ipv4": 仅走 IPv4
   */
  nodeIpVersion?: '' | 'dual' | 'ipv6-prefer' | 'ipv4-prefer' | 'ipv6' | 'ipv4';
}

// ─────────────────────────────────────────────────────────────────────────────
// 策略组构建模块配置 (mihomo-toolkit)
// ─────────────────────────────────────────────────────────────────────────────

export interface SpecialNodeRule {
  /** 正则表达式字符串或 RegExp 对象 */
  reg: string | RegExp;
  /** 目标重命名名称 */
  targetName: string;
}

export interface ToolkitConfig {
  /** 注入节点分组：关键词 -> 目标应用策略组名称数组 */
  customNodeGroups?: Record<string, string[]>;
  /** 注入节点重命名规则列表 */
  specialNodeRules?: SpecialNodeRule[];
  /** 外部服务配置文件路径 (.js / .yaml / .json) */
  servicesConfigFile?: string;
  /**
   * 通用配置片段挂载：片段与主文件共用同一份 schema，可放任意配置项。
   * 优先级：主文件优先（合并顺序 = include[0] ⊕ … ⊕ 主文件）；数组并集去重、对象深合并、标量覆盖；
   * 支持片段内递归 include（相对路径以所在片段目录为基准，含环路检测与深度上限）。
   * 可读取本地文件，属可信本地字段，`?config=` 远程配置无法写入。
   */
  include?: string[];
  /** 动态自定义服务字典 */
  customServices?: Record<string, any>;
  /** 激活的 AI 服务列表 */
  aiServices?: string[];
  /** 激活的流媒体服务列表 */
  streamingServices?: string[];
  /** 激活的社交平台服务列表 */
  socialServices?: string[];
  /** 激活的游戏平台服务列表 */
  gameServices?: string[];
  /** 激活的系统服务列表 */
  systemServices?: string[];
  /** AI 兜底优选地区列表 */
  aiPreferredRegions?: string[];

  // 🚀 高级分组特性
  /** 是否开启高倍率节点隔离独立分组 */
  isolateHighMulti?: boolean;
  /** 高倍率判定阈值（倍率大于等于此值判定为高倍率，默认 2.5） */
  highMultiThreshold?: number;
  /** 是否开启低倍率/下载专用节点隔离分组 */
  isolateDownload?: boolean;
  /** 是否开启实验节点隔离独立分组（含 测试/实验/备用/测速 字样的节点聚合为「🧪 实验节点」） */
  isolateExperimental?: boolean;
  /** 是否开启家宽/住宅 IP 节点隔离分组 */
  enableResidential?: boolean;
  /** 自定义地区分组阈值（节点数达到此值时独立建组，默认 3） */
  minorNodeThreshold?: number;
  /**
   * 在**只读骨架基线**（`手动选择` / `漏网之鱼` 及其 Emoji 变体）之外**追加**
   * 「即便暂时无节点也不被空组剪枝斩首」的策略组名。
   *
   * 只增不减：基线永远保留；用于让自建常驻组不会因为一次空池而被 DAG 级联清理误删。
   * 该字段无法被 `?config=` 远程配置写入。
   *
   * @example ["🏠 家宽优选", "🧪 实验节点"]
   */
  exemptGroups?: string[];

  // ── 以下字段与只读数据层的字段注册表（src/data/field-registry.js）一一对应 ──
  // 基础全局配置
  /** 流水线总控：设为 false 则跳过策略编排与拓扑构建，仅交付清洗后的节点 */
  enablePipeline?: boolean;
  /** 设备类型: windows | mac | linux | all */
  osType?: string;
  /** 路由偏好：true(海外代理优先) / false(国内直连优先) */
  proxyFirst?: boolean;
  /** 默认代理策略: auto | manual | fallback（特殊: direct / reject） */
  defaultProxyMode?: string;
  /** 全局 IPv6：控制 TUN / DNS 及路由（本地无物理 IPv6 请保持 false） */
  enableIPv6?: boolean;
  /** 标签提取：订阅合并时自动/手动捕捉标签内容 */
  enableAirportTag?: boolean;
  /** 手动指定标签（逗号分隔），为空则自动正则检测 */
  airportTag?: string;

  // 节点清洗
  /** 过滤机场自带的原生说明/流量提示伪节点 */
  removeInfoNodes?: boolean;
  /** 纯文本广告判定长度阈值（无数字/线路特征且长度超过此值判定为广告） */
  adTextThreshold?: number;
  /** 低倍率分流阈值（倍率 <= 此值归入下载策略，设为 0 关闭） */
  lowMultiThreshold?: number;
  /**
   * 节点连接时的 IP 协议栈偏好策略 (Mihomo 原生 ip-version 字段)
   * - "" (默认): 保持节点原有下发状态，不强行注入
   * - "dual": 开启 Happy Eyeballs 双栈并发竞速（推荐）
   * - "ipv6-prefer": 优先连接 IPv6
   * - "ipv4-prefer": 优先连接 IPv4
   * - "ipv6": 仅走 IPv6
   * - "ipv4": 仅走 IPv4
   */
  nodeIpVersion?: '' | 'dual' | 'ipv6-prefer' | 'ipv4-prefer' | 'ipv6' | 'ipv4';

  // 策略组建组与 UI 面板
  /** 地区组行为: url-test | select | fallback */
  regionGroupType?: 'url-test' | 'select' | 'fallback';
  /** 地区组是否增加哈希负载均衡策略组 */
  enableRegionHashLB?: boolean;
  /** 是否在面板中隐藏「🗑️ 未知识别」组 */
  hideUnknownGroup?: boolean;
  /** 策略组图标模式: emoji | icon | both */
  groupIconMode?: 'emoji' | 'icon' | 'both';
  /** 在线图标仓库前缀 (Orz-3) */
  iconRepoOrz?: string;
  /** 在线图标仓库前缀 (Koolson) */
  iconRepoKoolson?: string;
  /** 在线图标仓库前缀 (lige47) */
  iconRepoLige47?: string;

  // 核心分流开关
  /** 广告拦截分流 */
  enableAdBlock?: boolean;
  /** AI 助手独立分流 */
  enableAI?: boolean;
  /** Telegram 独立分流 */
  enableTelegram?: boolean;
  /** 流媒体服务分流 */
  enableStreaming?: boolean;
  /** 游戏平台分流 */
  enableGame?: boolean;
  /** 系统服务分流 */
  enableSystemServices?: boolean;
  /** 中国分流独立策略组 */
  enableDomesticGroup?: boolean;

  // 扩展分流开关
  /** 独立成组的社交应用（其余合并到「💬 社交平台」） */
  independentSocial?: string[];
  /** 激进广告拦截规则集 (anti-AD) */
  enableAntiAD?: boolean;
  /** GitHub 极速分流 */
  enableGitHub?: boolean;
  /** 学术资源分流 */
  enableScholar?: boolean;
  /** 海外社交分流 */
  enableSocial?: boolean;
  /** 加密货币分流 */
  enableCrypto?: boolean;
  /** 金融支付分流 */
  enablePayPal?: boolean;
  /** WebRTC 专项分流 */
  enableWebRTC?: boolean;
  /** 家宽节点注入映射：键=地区("all" / "hk" / "us")，值=目标策略组列表 */
  residentialNodeGroups?: Record<string, string[]>;

  // 网络测速与规则集
  /** 自动健康检查测速间隔（秒） */
  testInterval?: number;
  /** 自动选择组切换延迟容忍度（毫秒，防止频繁颠簸） */
  testTolerance?: number;
  /** 是否使用 Mihomo Rule-Set 极速二进制格式 (MRS) */
  useMRS?: boolean;
  /** 延迟测速地址 */
  testURL?: string;
  /** 规则集 CDN 前缀（与 geositeRepo / geoipRepo 组成完整 URL） */
  ruleProviderCDN?: string;

  // 规则集与图标仓库来源
  /** geosite 域名规则集仓库路径（默认 MetaCubeX/meta-rules-dat@meta/geo/geosite） */
  geositeRepo?: string;
  /** geoip 网段规则集仓库路径（默认 MetaCubeX/meta-rules-dat@meta/geo/geoip） */
  geoipRepo?: string;
  /** dev 分类下启用的服务 key 列表（默认 ["github", "scholar"]） */
  devServices?: string[];

  // 进程分流名单（P2P 下载软件防封号）
  /** Windows 强制直连进程名单 */
  processDirectWin?: string[];
  /** macOS 强制直连进程名单 */
  processDirectMac?: string[];
  /** Linux 强制直连进程名单 */
  processDirectLin?: string[];
  /** Windows 强制走下载策略的进程名单 */
  processProxyWin?: string[];
  /** macOS 强制走下载策略的进程名单 */
  processProxyMac?: string[];
  /** Linux 强制走下载策略的进程名单 */
  processProxyLin?: string[];

  // 自定义规则入口
  /** 注入到 MATCH 之前的自定义分流规则（优先级最高） */
  customRules?: string[];
  /** 自定义 Rule-Provider 定义（name → { type, behavior, url, path… }） */
  customRuleProviders?: Record<string, any>;

  // 安全与资源配额
  /**
   * 节点防环注入模式：smart(智能主域聚合，推荐) | exact(逐项保留) | off(不注入)。
   * 属于本机 DNS 安全面，`?config=` 远程配置无法写入。
   */
  fakeIpFilterNodes?: 'smart' | 'exact' | 'off';
}

// ─────────────────────────────────────────────────────────────────────────────
// 用户全局配置 (UserConfig)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserConfig extends PureConfig, ToolkitConfig {
  /** 订阅源列表 */
  subscriptions?: SubscriptionConfig[];
  /** 最终配置输出文件路径（CLI 模式使用） */
  output?: string;
  /** 日志等级：silent | error | warn | info | debug */
  logLevel?: LogLevel;
  /** 日志脱敏等级：off (本地开发) | partial (生产推荐) | full (分享日志) */
  redactLevel?: RedactLevel;

  // ⚡ 缓存与代理
  /** 是否启用本地内存缓存（默认 true；缓存键按配置整体结构化摘要，不同配置不会互相命中） */
  enableCache?: boolean;
  /** 新鲜缓存有效时间（秒，默认 300）；此窗口内请求秒级命中 Fresh 缓存 */
  cacheTtl?: number;
  /** SWR 陈旧缓存最大容忍时间（秒，默认 86400 即 24 小时）；超过 freshTtl 但未超此窗口时返回旧快照并异步重构，超期则同步重构 */
  cacheStaleMaxAge?: number;
  /** 本地订阅抓取代理端口（如 7890） */
  fetchProxyPort?: number;
  /** 本地订阅抓取代理策略：direct (直连) | proxy (代理) | auto (自动重试) */
  fetchProxyStrategy?: ProxyStrategy;
  /** 订阅拉取失败自动重试次数（默认 2，即最多尝试 3 次；超时/网络抖动/5xx 会重试，4xx 不重试） */
  fetchRetry?: number;
  /** 单次订阅拉取超时秒数（默认 15） */
  fetchTimeout?: number;
  /** 上次成功内容兜底保留小时数（默认 24；设为 0 关闭"失败复用旧数据"降级） */
  fetchStaleTtl?: number;
  /** 多订阅到期时间聚合策略：min (临近到期优先预警，默认) | max (最晚到期) | first (首个订阅优先) */
  expireAggregation?: 'min' | 'max' | 'first';
  /** 请求与资源配额（服务端/常驻模式主要用于防御滥用） */
  security?: RequestLimits;

  // 🔤 简繁中文转换
  /** 是否开启简繁中文全链路转换（需 opencc-js 依赖） */
  enableChineseConvert?: boolean;
  /** 简繁转换输出模式：s2t (输出繁体) | t2s (输出简体) */
  chineseConvertMode?: ChineseConvertMode;
  /** 交付输出形态：'config' (默认完整配置) | 'nodes' (纯节点) | 'report' (审计报告) */
  outputMode?: OutputMode;

  // 📡 DNS 策略与安全沙箱
  /** DNS 覆写总开关 */
  overwriteDns?: boolean;
  /** 进程直连防漏开关（P2P/BT 应用强制直连，见 processDirectWin/Mac/Lin） */
  enableProcessDirect?: boolean;
  /** 流量审计：非标端口流量强制直连 */
  enableTrafficAudit?: boolean;
  /** 屏蔽海外 UDP 443 (QUIC)，强制降级 TCP */
  enableQUICReject?: boolean;
  /** 覆写 TUN 配置 */
  overwriteTun?: boolean;
  /** 覆写 Sniffer 域名嗅探器配置 */
  overwriteSniffer?: boolean;
  /** 覆写核心内核性能调优与指纹伪装 */
  enableCoreOptimize?: boolean;
  /** DNS 本地监听地址与端口（默认 127.0.0.1:1053） */
  dnsListen?: string;
  /**
   * 是否允许 dns.listen 绑定非回环地址（默认 false）。
   * 安全铁律 INV-8：非回环监听会让内核对外提供开放 DNS 解析服务；
   * 仅软路由等确需对外提供 DNS 的场景才应显式开启。
   */
  dnsAllowNonLoopback?: boolean;
  /** 是否允许私网/保留地址作为解析器（默认 false，需配合 trustedPrivateCidrs 显式信任） */
  allowPrivateDns?: boolean;
  /** 显式信任的私网解析器网段，例如 ["192.168.1.0/24"] */
  trustedPrivateCidrs?: string[];
  /**
   * 在**只读安全基线**（`github.com` / `paypal.com` / CA 与公共 DNS 域名等 60 余个域）之外
   * **追加**禁止被 hosts 覆盖的域名。
   *
   * 只增不减：基线永远保留，写 `[]` 不会清空保护；条目会按域名规则归一化
   * （小写、剥离 `+.` / `*.` / 首尾点），非法条目被丢弃并告警。
   * 该字段属于本机安全面，`?config=` 远程配置无法写入（会自动剥夺）。
   *
   * @example ["mybank.example", "internal.company.com"]
   */
  protectedDomains?: string[];
  /** 基础引导 DNS（纯 IP 格式，防死锁） */
  dnsDefault?: string[];
  /** 直连域名 DoH */
  dnsDirect?: string[];
  /** 代理域名 DoH */
  dnsProxy?: string[];
  /** 节点域名专用直连解析器（纯 IP 格式，直连无死锁） */
  dnsServer?: string[];
  /** 自定义静态 Hosts 映射（受保护域名与内网重定向默认被拒绝） */
  hosts?: Record<string, string | string[]>;
  /** 允许 hosts 豁免受保护域名清单的域名（如 "my-internal-cdn.com"） */
  trustedHostDomains?: string[];
  /** 是否允许 hosts 指向内网/保留地址（默认 false） */
  allowInternalHosts?: boolean;
  /** 自定义 Nameserver Policy 分流映射（保留键 rule-set:cn-domain / rule-set:non-cn 不可覆盖） */
  nameserverPolicy?: Record<string, string | string[]>;
  /** 自定义 Fake-IP 过滤名单 */
  fakeIpFilter?: string[];

  // 🔗 节点资产闭包强度
  /**
   * 订阅声明的节点专属 DNS 依赖（Hosts / Nameserver-Policy / Fake-IP-Filter）继承强度：
   * standard (默认，按节点域名继承) | strict (仅继承 assetDomainAllowlist) | off (完全不继承)。
   * 注意：节点 server 字段由订阅控制，「自己的节点域名」可被伪造，故标准模式依赖受保护域名清单兜底。
   */
  assetClosure?: 'standard' | 'strict' | 'off';
  /** strict 模式下允许被继承的域名列表 */
  assetDomainAllowlist?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 代理节点与清洗统计元数据
// ─────────────────────────────────────────────────────────────────────────────

export interface ProxyNode {
  name: string;
  type: string;
  server: string;
  port: number;
  cipher?: string;
  password?: string;
  uuid?: string;
  alterId?: number;
  tls?: boolean;
  sni?: string;
  servername?: string;
  network?: string;
  udp?: boolean;
  [key: string]: any;
}

export interface PureStats {
  total: number;
  outputCount: number;
  dedupeCount: number;
  discardedCount: number;
  unknownCount: number;
  infoCount: number;
  fissionCount: number;
}

export interface PureMeta {
  buckets: Record<string, number[]>;
  stats: PureStats;
}

export interface BuildOptions {
  /** 交付输出模式: "config" (默认) | "nodes" (纯节点) | "report" (审计报告) */
  mode?: OutputMode;
  /** 是否开启调试模式（输出详尽日志） */
  debug?: boolean;
  /** 生产环境模式（严格禁止 redactLevel=off） */
  production?: boolean;
  /** 强制跳过内存缓存，实时抓取远端 */
  noCache?: boolean;
  /** 导出统计报告路径 */
  report?: string;
  /** 指定配置文件路径 */
  config?: string;
  /** 指定输出文件路径 */
  out?: string;
}

export interface BuildResult {
  /** 生成的 Clash / Mihomo YAML 配置文件文本 */
  yamlStr: string;
  /** 数据清洗与分桶元数据报告（当 outputMode: "report" 时包含） */
  meta?: PureMeta;
  /** 结构化审计与健康报告（当 outputMode: "report" 时包含） */
  report?: Record<string, any>;
  /** 解析后的原生 JavaScript 配置对象 */
  config?: Record<string, any>;
  /**
   * config 交付模式下，对最终 DNS 块执行的 INV 不变式自检结果（无违规时为空数组）。
   * 违反项不会阻断交付，但会同步打印告警，便于 CI 断言与问题定位。
   */
  invariantViolations?: Array<{ id: string; detail: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心模块函数导出声明
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 端到端全流程构建函数：负责订阅抓取、安全校验、节点清洗与策略组组装
 * @param userConfig 用户配置对象或 YAML 解析后的配置
 * @param options CLI 或运行时覆盖参数
 */
export function buildProfile(
  userConfig: UserConfig,
  options?: BuildOptions
): Promise<BuildResult>;

/**
 * 全流程流水线总调度引擎 (Pipeline Engine)
 */
export function runPipelineEngine(
  userConfig?: UserConfig,
  options?: BuildOptions
): Promise<BuildResult>;

/**
 * URL 脱敏辅助函数（去除查询参数与路径凭证）
 * @param url 待脱敏的原始 URL
 */
export function redactUrl(url: string): string;

/**
 * 安全校验 URL 是否属于公网合法地址（防 SSRF）
 * @param urlString 待校验的 URL
 */
export function isAllowedUrl(urlString: string): boolean;

/**
 * 请求与资源配额（全部为可选，未配置项使用内置默认值）
 */
export interface RequestLimits {
  /** 单次请求允许的最大订阅 URL 数（默认 20） */
  maxSubscriptionUrls?: number;
  /** ?config= 远程配置最大字节数（默认 1MB） */
  maxRemoteConfigBytes?: number;
  /** 单个订阅响应体最大字节数，流式截断（默认 8MB） */
  maxSubscriptionBytes?: number;
  /** 单次构建允许的最大节点总数（默认 5000） */
  maxTotalNodes?: number;
  /** 单个订阅最多允许的节点数（默认 3000） */
  perSubscriptionMaxNodes?: number;
}

/**
 * 安全 HTTP 抓取选项
 */
export interface SafeFetchOptions {
  /** 最大重定向跳数（默认 5，每一跳都会重新做 SSRF 校验） */
  maxRedirects?: number;
  /** 整体超时毫秒数（默认 15000） */
  timeoutMs?: number;
  /** 日志中是否展示完整 URL（默认 false，仅保留协议与主机） */
  showFullUrl?: boolean;
  /** 本地回环代理地址（只允许 127.0.0.1 / localhost / ::1） */
  proxyUrl?: string;
  /** 响应体字节上限，超出即中止（0 表示不限制） */
  maxBytes?: number;
}

export interface SafeFetchResult {
  text: string;
  response: any;
  finalUrl: string;
}

/**
 * 带 SSRF 防护、超时、限长与手动重定向校验的文本抓取
 */
export function safeFetchText(url: string, options?: SafeFetchOptions): Promise<SafeFetchResult>;

/**
 * 深度 SSRF 校验：协议白名单、私网/回环/CGNAT/云元数据与 DNS 解析结果拦截
 */
export function validateUrlSsrf(urlString: string): Promise<true>;

/**
 * 校验请求与资源配额，返回 null 表示通过
 */
export function validateRequestLimits(input: {
  subscriptionUrls?: string[];
  remoteConfigSize?: number;
  totalNodes?: number;
  perSubCounts?: Record<string, number>;
  limits?: RequestLimits;
}): Error | null;

/**
 * 不可信配置中被禁止的字段清单（能力剥夺名单）
 */
export const REMOTE_CONFIG_FORBIDDEN_KEYS: string[];

/**
 * 不可信远程配置加固：剥夺其触碰本机资源与改写 DNS 控制面的能力。
 *
 * `buildProfile` 的 userConfig 参数按契约视为**可信**输入；若配置来自网络或他人分享
 * （如服务端 `?config=`），必须先经本函数降级，`ok=false` 时应整体拒绝该配置。
 */
export function hardenRemoteConfig(rawConfig: Record<string, any>): {
  ok: boolean;
  reason?: string;
  config: Record<string, any>;
  strippedKeys: string[];
};

/**
 * 解析各种格式的订阅内容（Base64, Clash YAML, 多行 URI 等）
 * @param content 原始文本内容
 * @param defaultName 默认节点名称前缀
 */
export function parseContent(content: string, defaultName?: string): { proxies: ProxyNode[]; [key: string]: any };

/**
 * 完整配置装配流水线 (config pipeline)
 */
export function runConfigPipeline(params: {
  sourceSkeleton?: Record<string, any>;
  cleanProxies?: ProxyNode[];
  classifiedNodes?: any[];
  collectedSubInfos?: any[];
  userConfig?: UserConfig;
  logger?: any;
}): {
  yamlStr: string;
  outputData: Record<string, any>;
  userInfo: {
    upload: number;
    download: number;
    total: number;
    expire: number;
  };
};

/**
 * 纯节点清洗与打标流水线 (nodes pipeline)
 */
export function runNodesPipeline(
  proxies: ProxyNode[],
  userConfig?: PureConfig
): Promise<ProxyNode[] | { proxies: ProxyNode[]; meta: PureMeta }>;

/**
 * 生成结构化审计与健康报告 (report pipeline)
 */
export function buildAuditReport(
  meta?: any,
  proxies?: ProxyNode[],
  options?: Record<string, any>
): Record<string, any>;

/**
 * 策略组与分流拓扑流水线 (strategy pipeline)
 */
export function runStrategyPipeline(
  sourceSkeleton: Record<string, any>,
  userConfig?: ToolkitConfig,
  pipelineContext?: Record<string, any>
): Record<string, any>;

/**
 * 交付形态字面量小写归一化（缺省为 "config"）。
 * 仅做小写与缺省兜底，不做别名映射；调用方需自行校验是否为 config | nodes | report。
 */
export function normalizeOutputMode(rawMode?: string): string;

/**
 * 解析 Vless 协议 URI
 */
export function parseVlessUri(uri: string): ProxyNode | null;

/**
 * 解析 VMess 协议 URI (Base64)
 */
export function parseVmessUri(uri: string): ProxyNode | null;

/**
 * 解析 Trojan 协议 URI
 */
export function parseTrojanUri(uri: string): ProxyNode | null;

/**
 * 解析 Shadowsocks 协议 URI (SIP002 / SIP001)
 */
export function parseSsUri(uri: string): ProxyNode | null;

/**
 * 解析 Hysteria2 / Hy2 协议 URI
 */
export function parseHysteria2Uri(uri: string): ProxyNode | null;

/**
 * 解析 TUIC 协议 URI
 */
export function parseTuicUri(uri: string): ProxyNode | null;

/**
 * 解析 SOCKS5 / SOCKS 协议 URI
 */
export function parseSocksUri(uri: string): ProxyNode | null;

/**
 * 解析 HTTP / HTTPS 代理协议 URI
 */
export function parseHttpUri(uri: string): ProxyNode | null;

/**
 * 根据协议前缀分发解析单条 URI 节点链接
 */
export function parseUri(uri: string): ProxyNode | null;

/**
 * 解析多行 URI 链接列表
 */
export function parseUriList(content: string): { proxies: ProxyNode[] } | null;

/**
 * 注册自定义协议解析器
 */
export function registerParser(
  schemes: string | string[],
  parserFn: (uri: string) => ProxyNode | null
): void;

/**
 * 获取指定协议解析器
 */
export function getParser(scheme: string): ((uri: string) => ProxyNode | null) | undefined;

/**
 * 检查协议是否已注册
 */
export function hasParser(scheme: string): boolean;

/**
 * 获取所有已注册的协议 Schemes 列表
 */
export function getRegisteredSchemes(): string[];

