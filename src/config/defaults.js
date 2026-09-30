/**
 * Mihomo-Toolkit 全局默认配置
 *
 * 维护系统各模块（清洗、策略组、分流、DNS、内核优化）的基础默认开关与参数。
 */

const DEFAULT_CONFIG = {
  // 【1. 基础全局配置】
  enableScript: true,          // 🟢 脚本总控：设为 false 则原样输出订阅内容
  logLevel: "info",            // 📋 日志级别: silent | error | warn | info | debug
  osType: "windows",           // 💻 设备类型: "windows", "mac", "linux", "all"
  proxyFirst: true,            // 🧭 路由偏好：true(海外代理优先)，false(国内直连优先)
  defaultProxyMode: "auto",    // 🔀 默认代理策略: auto(自动) / manual(手动) / fallback(故障转移) [⚠️特殊: direct / reject]
  enableIPv6: false,           // 🌐 全局 IPv6：控制 TUN、DNS 及路由（本地无物理 IPv6 请务必设为 false！）
  enableAirportTag: false,     // 🏷️ 标签提取：订阅合并时自动/手动捕捉标签内容
  airportTag: "",              // 🏷️ 手动指定标签（需要节点名字自带标签，逗号分隔），为空则自动正则检测
  airportTagReg: /^\[([^\]]{1,8})\]/i, // 🧩 自定义标签提取正则 (默认提取首部方括号内容)
  showFeatureIcon: true,       // 🎨 特征图标：true(模板{features}填Emoji如📺), false(填文字如"流媒体")

  // 【2. 节点清洗与处理】
  enableDedupe: false,         // 🧽 节点去重：开启后自动剔除底层完全重复的“注水”节点
  enableDashboard: true,       // 📊 订阅看板: 开启后为流量/到期等信息建立独立的「📊 订阅与状态看板」策略组
  removeInfoNodes: true,       // 🗑️ 过滤原生说明节点: 开启后剔除机场自带的原生说明/流量提示伪节点
  renameTemplate: "[{airport}] {icon} {region} {index} {features} | {in} {city} {line} {multi} {ip_stack} · {transport}", // 🔤 节点重命名模板
  renameSeparators: ["|", "-", "·", "/", "~", ":", ",", ";", "_", "=", "+", "*", ">", "<", "➩", "=>", "->"], // 🧹 允许自动清理的悬空符号
  whitelistKeywords: [],       // ⚪ 白名单关键词: 包含即放行并保留原名，不参与清洗
  specialNodeRules: [],        // 💡 自定义重命名: 例: { reg: /url.test|测速/i, targetName: "🚀 节点测速" }
  customNodeGroups: {},        // 🎯 自定义节点分组: 指定节点进入哪些应用组
  indexPrefixMap: {},          // 🔢 序号前缀映射: 键=订阅标签, 值=前缀
  enableNodeRename: true,      // 🔄 二次重命名：设为 false 则直接继承原节点名
  strictRegionMatch: false,    // 🌏 未知地区匹配：true(严格字典匹配)，false(宽松国旗捕获)
  adTextThreshold: 6,          // 🔠 纯文本广告判定阈值：无数字/线路特征且长度大于此值的节点视为广告
  lowMultiThreshold: 0.99,     // ⏬ 低倍率分流阈值：倍率 <= 此值的节点自动归入下载策略 (设为 0 关闭)
  isolateDownload: false,      // ⏬ 低倍率节点隔离：设为 true 从普通大区池中剔除
  highMultiThreshold: 2.5,     // 🚩 高倍率阈值：倍率超过此值排序自动下沉
  isolateHighMulti: false,     // 🚀 高倍率节点隔离：设为 true 将超过 highMultiThreshold 的节点独立成组
  isolateExperimental: false,  // 🧪 实验节点隔离：设为 true 将测试/实验节点独立成组

  // 【3. 策略组建组与 UI 面板】
  minorNodeThreshold: 3,       // 📊 小众地区建组阈值：节点数 >= 此值则独立建组，否则折叠至大区组
  regionGroupType: "url-test", // ⚙️ 地区组行为: "url-test", "select", "fallback"
  enableRegionHashLB: false,   // ⚖️ 地区散列: 在达到阈值的地区组增加哈希负载均衡策略组
  hideGarbageGroup: false,     // 🗑️ 隐藏垃圾桶：无论是否有未知识别节点，强制不在面板显示
  groupIconMode: "emoji",      // 🎨 策略组图标: "emoji"(仅保留Emoji), "icon"(仅在线图标), "both"(同时保留)
  iconRepoOrz: "https://fastly.jsdelivr.net/gh/Orz-3/mini@master/Color/",
  iconRepoKoolson: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/",
  iconRepoLige47: "https://fastly.jsdelivr.net/gh/lige47/lige_icon@main/icon/",

  // 【4. 核心分流开关】
  enableAdBlock: true,         // 🚫 广告拦截：去除网页及 APP 广告
  enableAI: true,              // 🤖 AI 助手：OpenAI, Gemini, Claude, Copilot 等
  enableTelegram: true,        // ✈️ 社交通讯：Telegram 独立分流
  enableStreaming: true,       // 📺 流媒体服务：具体平台在 STREAMING_SERVICES 中增删
  enableGame: true,            // 🎮 游戏平台：具体平台在 gameServices 中增删
  enableSystemServices: true,  // 🪟 系统服务：Microsoft, Apple, Google 框架服务
  enableDomesticGroup: false,  // 🇨🇳 中国分流：开启后增加专门的"中国"策略组

  // 【5. 扩展分流开关】
  servicesConfigFile: "",      // 🧩 外部服务定义配置文件路径 (.js / .yaml / .json)
  customServices: {},          // 🧩 行内自定义服务字典
  aiServices: ["chatgpt", "gemini", "claude", "copilot"],
  streamingServices: ["youtube", "netflix", "bilibili", "disney", "spotify", "tiktok", "bahamut", "pixiv", "twitch"],
  socialServices: ["twitter", "facebook", "instagram", "discord"],
  independentSocial: ["twitter"],
  gameServices: ["steam", "epic", "riot", "blizzard", "nintendo", "playstation", "xbox", "ubisoft", "origin", "ea"],
  systemServices: ["microsoft", "apple", "google"],
  aiPreferredRegions: ["us", "jp", "tw", "sg", "kr", "eu"],
  enableAntiAD: false,         // ☢️ 激进广告拦截：启用 anti-AD 规则集
  enableGitHub: true,          // 🐱 开发者选项：GitHub, GitLab 等
  enableScholar: true,         // 🎓 学术研究：Google Scholar 等
  enableSocial: false,         // 💬 海外社交
  enableCrypto: false,         // 🪙 加密货币
  enablePayPal: false,         // 💳 金融支付
  enableResidential: false,    // 🏠 家宽分流：自动提取住宅/ISP节点作为高级备用
  enableWebRTC: false,         // 🗣 WebRTC 专项分流
  residentialNodeGroups: {},   // 🏠 家宽节点注入

  // 【6. 网络测速与规则集配置】
  testInterval: 300,           // 🕒 测速间隔: 单位秒
  testTolerance: 50,           // ⚖️ 切换阈值: 延迟差低于此值不频繁切换 IP
  useMRS: true,                // 🚀 极速规则模式: true(MRS格式), false(YAML格式)
  testURL: "https://cp.cloudflare.com/generate_204", // 🔗 延迟测速地址
  ruleProviderCDN: "https://fastly.jsdelivr.net/gh", // 🔗 规则集 CDN 节点

  // 【7. DNS 服务器配置】
  dnsListen: "127.0.0.1:1053",
  dnsDefault: ["223.5.5.5", "119.29.29.29"],
  dnsDirect:  ["https://223.5.5.5/dns-query", "https://120.53.53.53/dns-query", "223.5.5.5", "119.29.29.29"],
  dnsProxy:   ["https://8.8.8.8/dns-query", "https://1.1.1.1/dns-query"],
  dnsServer:  ["223.5.5.5", "119.29.29.29"],

  // 【8. 安全防漏与底层内核覆写】
  enableProcessDirect: true,   // 🛑 进程直连防漏
  enableTrafficAudit: true,    // 🛡️ 流量审计
  enableQUICReject: false,     // ⚡ QUIC 智能分流
  overwriteTun: true,          // 🖧 覆写 TUN 配置
  overwriteDns: true,          // 📡 覆写 DNS 总开关
  dnsMergeMode: "secure",      // 📡 DNS 覆写模式: secure | merge (自动识别并保护节点专属依赖)
  overwriteSniffer: true,      // 🔎 覆写 Sniffer 配置
  enableCoreOptimize: true     // ⚡ 覆写核心内核优化
};

module.exports = {
  DEFAULT_CONFIG
};
