/**
 * Mihomo-Toolkit TypeScript 类型定义文件
 * 适用于 Node.js、Cloudflare Workers、Sub-Store 以及各类二次开发场景
 */

// ─────────────────────────────────────────────────────────────────────────────
// 基础枚举与联合类型
// ─────────────────────────────────────────────────────────────────────────────

export type TargetType = 'full' | 'pure' | 'toolkit';
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';
export type RedactLevel = 'off' | 'partial' | 'full';
export type ProxyStrategy = 'direct' | 'proxy' | 'auto';
export type FissionStack = 'all' | 'v4' | 'v6';
export type IpEnrichMode = 'missing' | 'all';
export type ChineseConvertMode = 's2t' | 't2s';
export type OutputMode = 'clash' | 'surge' | 'loon' | 'singbox' | 'object';

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
  /** 是否启用该订阅项（默认为 true） */
  enable?: boolean;
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
  /** 是否剔除订阅中的说明/流量/到期等非节点信息（默认为 true） */
  removeInfoNodes?: boolean;
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

  // 🚀 高级分组特性
  /** 是否开启高倍率节点隔离独立分组 */
  isolateHighMulti?: boolean;
  /** 高倍率判定阈值（倍率大于等于此值判定为高倍率，默认 1.5） */
  highMultiThreshold?: number;
  /** 是否开启低倍率/下载专用节点隔离分组 */
  isolateDownload?: boolean;
  /** 是否开启家宽/住宅 IP 节点隔离分组 */
  enableResidential?: boolean;
  /** 是否为 TLS 节点注入客户端指纹与 TCP 并发优化 */
  enableTlsOptimizations?: boolean;
  /** 自定义地区分组阈值（节点数达到此值时独立建组，默认 2） */
  minorNodeThreshold?: number;
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
  /** 是否启用本地内存缓存（默认 true） */
  enableCache?: boolean;
  /** 本地缓存过期时间（秒，默认 300） */
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

  // 🔤 简繁中文转换
  /** 是否开启简繁中文全链路转换（需 opencc-js 依赖） */
  enableChineseConvert?: boolean;
  /** 简繁转换输出模式：s2t (输出繁体) | t2s (输出简体) */
  chineseConvertMode?: ChineseConvertMode;

  // 模块专属独立子配置（可选，合并覆盖根级同名字段）
  pureConfig?: PureConfig;
  toolkitConfig?: ToolkitConfig;
  outputMode?: OutputMode;
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
 * 节点清洗核心算子 (pure-nodes)
 * @param proxies 原始代理节点数组
 * @param targetPlatform 目标平台（默认 'clash'）
 * @param userConfig 清洗模块配置
 */
export function operator(
  proxies: ProxyNode[],
  targetPlatform?: string,
  userConfig?: PureConfig
): Promise<ProxyNode[] | { proxies: ProxyNode[]; meta: PureMeta }>;

/**
 * 策略组与分流规则构建主函数 (mihomo-toolkit)
 * @param config 包含 proxies 的基础配置对象
 * @param userConfig 策略组构建配置
 */
export function main(
  config: Record<string, any>,
  userConfig?: ToolkitConfig
): Record<string, any>;

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
 * 解析各种格式的订阅内容（Base64, Clash YAML, 多行 URI 等）
 * @param content 原始文本内容
 * @param defaultName 默认节点名称前缀
 */
export function parseContent(content: string, defaultName?: string): ProxyNode[];

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
