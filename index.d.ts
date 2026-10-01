/**
 * Mihomo-Toolkit TypeScript 类型定义文件
 * 适用于 Node.js、Sub-Store 以及各类二次开发场景
 */

// ─────────────────────────────────────────────────────────────────────────────
// 基础枚举与联合类型
// ─────────────────────────────────────────────────────────────────────────────

export type OutputMode = 'config' | 'nodes' | 'report' | 'full' | 'cleaner' | 'meta';
export type TargetType = OutputMode;
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';
export type RedactLevel = 'off' | 'partial' | 'full';
export type ProxyStrategy = 'direct' | 'proxy' | 'auto';
export type FissionStack = 'all' | 'v4' | 'v6';
export type IpEnrichMode = 'missing' | 'all';
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
  /** 是否启用该订阅项（默认为 true，支持 enable 或 enabled: false 禁用） */
  enable?: boolean;
  /** 是否启用该订阅项（默认为 true，设为 false 临时停用） */
  enabled?: boolean;
  /** 是否停用该订阅项（设为 true 临时停用） */
  disabled?: boolean;
  /** 抓取代理开关：true 走代理，false 强制直连，省略则继承全局 fetchProxyStrategy */
  proxy?: boolean;
  /** 自定义请求头（如 User-Agent、Authorization 等） */
  headers?: Record<string, string>;
  /** 自定义 User-Agent 字符串 */
  userAgent?: string;
  /** 订阅解析失败重试次数（覆盖全局 fetchRetry，默认继承全局值） */
  retry?: number;
  /** 每月重置日（1-31），用于自动计算"距离重置剩余 X 天" */
  resetDay?: number;
  /** 是否标记为主订阅源（用于主权仲裁与优先看板基准） */
  master?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 节点清洗模块配置 (pure-nodes)
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomRegexRule {
  /** 规则名称 */
  name: string;
  /** 正则表达式字符串或 RegExp 对象 */
  pattern: string | RegExp;
  /** 匹配成功后赋予的地区 ID 或标签 */
  target?: string;
}

export interface PureConfig {
  /** 是否启用「📊 订阅与状态看板」独立展示策略组（展示流量/到期/重置，不污染主力节点池） */
  enableDashboard?: boolean;
  /** 是否开启物理参数去重（默认为 true） */
  enableDedupe?: boolean;
  /** 严格地区匹配模式：为 true 时仅匹配完全确信的地区名 */
  strictRegionMatch?: boolean;
  /** 是否在节点名中显示特征 Emoji 图标（如 🚀, 🏠, 🛰️） */
  showFeatureIcon?: boolean;
  /** 是否开启节点重命名格式化 */
  enableNodeRename?: boolean;
  /** 节点重命名模板（如 "{flag} {name} {index}"） */
  nodeRenamePattern?: string;
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
  /** 单个节点最大裂变生成的子节点数量（默认 4） */
  fissionMaxNodes?: number;
  /** 裂变黑名单关键词（包含这些词的节点跳过裂变） */
  fissionExcludeKeywords?: string[];

  // 🔍 IP 检测与地理位置
  /** 是否开启外部 IP API 补充检测（默认为 false） */
  enableIpEnrich?: boolean;
  /** IP 检测模式：missing (仅未知地区), all (所有节点) */
  ipEnrichMode?: IpEnrichMode;
  /** IP 检测安全熔断阈值（有效节点数超过此值自动跳过防超时，默认 80） */
  ipEnrichThreshold?: number;
  /** IP 检测总体超时时间（毫秒，默认 15000） */
  ipEnrichTimeout?: number;
  /** IP API 批量查询批次大小（默认 100） */
  ipApiBatchSize?: number;
  /** IP API 批次请求间隔延时（毫秒，防 429 限流，默认 4000） */
  ipApiBatchDelay?: number;
  /** 自定义 IP API 端点（默认 http://ip-api.com/batch） */
  ipApiEndpoint?: string;

  // 🏷️ 特征打标
  /** 是否开启 IPv6 节点打标识别 */
  enableIpv6Tag?: boolean;
  /** 是否开启家宽/住宅 ISP 节点打标识别 */
  enableResidentialTag?: boolean;
  /** 是否开启蜂窝/移动网络节点打标识别 */
  enableCellularTag?: boolean;

  // 🚫 过滤黑白名单
  /** 全局节点名白名单关键词列表（白名单节点不被剔除） */
  whitelistKeywords?: string[];
  /** 全局节点名黑名单关键词列表（命中一律当作垃圾节点剔除） */
  blockKeywords?: string[];
  /** 全局服务器域名/IP黑名单列表 */
  blockServers?: string[];
  /** 自定义特征识别正则规则列表 */
  customRegexRules?: CustomRegexRule[];
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

export interface ProxyGroupConfig {
  /** 策略组名称 */
  name: string;
  /** 策略组类型 (select | url-test | fallback | load-balance) */
  type: 'select' | 'url-test' | 'fallback' | 'load-balance';
  /** 测速 URL */
  url?: string;
  /** 测速间隔（秒） */
  interval?: number;
  /** 包含的节点或子策略组名称列表 */
  proxies?: string[];
  /** 包含的 Provider 引用 */
  use?: string[];
  /** 容差（毫秒，用于 url-test） */
  tolerance?: number;
  /** 负载均衡策略 (consistent-hashing | round-robin) */
  strategy?: 'consistent-hashing' | 'round-robin';
  [key: string]: any;
}

export interface ToolkitConfig {
  /** 基础模板配置对象（包含 dns, tun, rules 等原生字段） */
  template?: Record<string, any>;
  /** 规则集配置 */
  ruleProviders?: Record<string, any>;
  /** 注入节点分组：关键词 -> 目标应用策略组名称数组 */
  customNodeGroups?: Record<string, string[]>;
  /** 注入节点重命名规则列表 */
  specialNodeRules?: SpecialNodeRule[];
  /** 外部服务配置文件路径 (.js / .yaml / .json) */
  servicesConfigFile?: string;
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
  /** 高倍率判定阈值（倍率大于等于此值判定为高倍率，默认 1.5） */
  highMultiThreshold?: number;
  /** 是否开启低倍率/下载专用节点隔离分组 */
  isolateDownload?: boolean;
  /** 是否开启实验节点隔离独立分组（含 测试/实验/备用/测速 字样的节点聚合为「🧪 实验节点」） */
  isolateExperimental?: boolean;
  /** 是否开启家宽/住宅 IP 节点隔离分组 */
  enableResidential?: boolean;
  /** 是否为 TLS 节点注入客户端指纹与 TCP 并发优化 */
  enableTlsOptimizations?: boolean;
  /** 自定义地区分组阈值（节点数达到此值时独立建组，默认 2） */
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
  /** 自定义附加策略组列表 */
  customProxyGroups?: ProxyGroupConfig[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 用户全局配置 (UserConfig)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserConfig extends PureConfig, ToolkitConfig {
  /** 构建运行模式：full (清洗+策略组), pure (仅清洗), toolkit (仅策略组) */
  type?: TargetType;
  /** 订阅源列表 */
  subscriptions?: SubscriptionConfig[];
  /** 最终配置输出文件路径（CLI 模式使用） */
  output?: string;
  /** 清洗统计报告 JSON 导出路径（可选） */
  meta?: string;
  /** 日志等级：silent | error | warn | info | debug */
  logLevel?: LogLevel;
  /** 日志脱敏等级：off (本地开发) | partial (生产推荐) | full (分享日志) */
  redactLevel?: RedactLevel;

  // ⚡ 缓存与代理
  /** 是否启用本地内存缓存（默认 true；缓存键按配置整体结构化摘要，不同配置不会互相命中） */
  enableCache?: boolean;
  /** 本地缓存过期时间（秒，默认 300）；订阅远端内容的更新仅在 TTL 到期后生效 */
  cacheTtl?: number;
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
  /**
   * @deprecated 保留字段但**尚未实现**：生产 DNS 装配固定为权威覆写（等价 secure）。
   * 节点专属 DoH/Hosts 依赖由资产闭包机制（assetClosure）处理，不依赖本开关。
   */
  dnsMergeMode?: 'secure' | 'merge';
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

  // ⚠️ 已废弃开关（智能节点资产保活沙箱已自动接管，宿主控制面保持纯净）
  /** @deprecated 已废弃。系统已自动启用「智能节点资产依赖保活沙箱」，既保活节点专属 DNS/Hosts，又杜绝控制面夺权污染 */
  passthrough?: boolean;
  /** @deprecated 已废弃。 */
  preserveRawConfig?: boolean;
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

export interface RegionMeta {
  id: string;
  name: string;
  icon: string;
}

export interface NodeMeta {
  rawName: string;
  proxyIndex: number;
  isInfo: boolean;
  isGarbage: boolean;
  isSpecial: boolean;
  isFission: boolean;
  regionMeta?: RegionMeta;
  tags?: string[];
  features?: string[];
}

export interface PureMeta {
  buckets: Record<string, number[]>;
  stats: PureStats;
  humanReport: string;
  nodeMeta: NodeMeta[];
}

export interface BuildOptions {
  /** 构建运行模式覆盖 */
  type?: TargetType;
  /** 是否开启调试模式（输出详尽日志） */
  debug?: boolean;
  /** 生产环境模式（严格禁止 redactLevel=off） */
  production?: boolean;
  /** 强制跳过内存缓存，实时抓取远端 */
  noCache?: boolean;
  /** 导出统计报告路径 */
  meta?: string;
  /** 指定配置文件路径 */
  config?: string;
  /** 指定输出文件路径 */
  out?: string;
}

export interface BuildResult {
  /** 生成的 Clash / Mihomo YAML 配置文件文本 */
  yamlStr: string;
  /** 数据清洗与分桶元数据报告（当 outputMode: "object" 或指定 options.meta 时包含） */
  meta?: PureMeta;
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
  configData?: Record<string, any>;
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
  config: Record<string, any>,
  userConfig?: ToolkitConfig
): Record<string, any>;

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

