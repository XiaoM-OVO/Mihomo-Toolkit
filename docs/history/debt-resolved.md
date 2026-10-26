# 全量技术债务与坏味道治理归档（47 项已闭环）

> 历史归档：全部条目均已修复或确认收敛，不再作为活跃跟踪表维护；主线规划见 [ROADMAP.md](../../ROADMAP.md)。

### 1. 核心架构与功能性缺陷
| 缺陷项 | 归属模块 | 严重级别 | 现状与治理方向 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| `IO -> Core` 反向引用 (已修复) | `src/io/ssrf.js`, `parsers/index.js` | 🟡 中 | 依赖 Core 的基础工具函数，下沉公共基础模块 | M1 阶段 |
| customRules 分流优先级倒挂 (已修复) | `src/strategy/rules.js` | 🔴 高 | 文档声明最高但代码放在最后，自上而下首命中导致失效，需提至首位 | M1 阶段 |
| 策略组装配与元数据双硬编码耦合 (已修复) | `src/strategy/topology.js` | 🔴 高 | 引入声明式 DSL 配方与拓扑引擎，破除双硬编码与业务强耦合 | M3 阶段 |
| SSRF TOCTOU 窗口 (已修复) | `src/io/ssrf.js`, `src/io/pinned-agent.js` | 🟡 中 | 直连模式在建连阶段由 `connect.lookup` 完成同一次解析内的地址校验并固定已校验 IP，消除校验与建连之间的 DNS Rebinding 窗口；代理模式解析发生在代理侧，残余风险保留 | M3 阶段 |

### 2. Data & Config 层问题清单 (第 1 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 分类开关判定遗漏与不一致 (已修复) | `src/config/catalog.js` | 逻辑缺陷 | `getActiveServices('dev')` 与策略层动态联动；支持 `enableGitHub`/`enableScholar` 及扩展 | M1 阶段 |
| 绕过 Logger 的裸控制台输出 (已修复) | `src/config/index.js` | 坏味道 | `applyAdditiveFields` 支持注入分级 `logger`，且在 `logLevel: 'silent'` 下静默 | M1 阶段 |
| 循环内重复排序静态字典 (已修复) | `src/data/cleaner-rules.js` | 性能坏味道 | `CARRIER_COMBO_MAP` 预排序常量化为 `SORTED_CARRIER_COMBOS`，消除循环内排序开销 | M1 阶段 |
| 字段注册表元数据分类错位 (已修复) | `src/data/field-registry.js` | 规范/遗留 | `include` 归入基础配置挂载；`devServices` 归入扩展分流开关并支持自定义 dev 服务 | M1 阶段 |
| 注册表兜底机制双轨制 (已确认收敛) | `src/data/field-registry.js` | 规范确认 | 明确区分出厂配置面（DEFAULT_CONFIG）与运行期调度入参（DEFAULTLESS_FIELDS），由 config-surface 回归测试刚性守卫 | M2 阶段 |
| include 原始对象二次传参穿透 (已修复) | `src/config/include.js` | 边界缺陷 | `WeakSet` 仅缓存展开后对象，二次传入同字面量无法阻断二次读盘 | M1 阶段 |
| resolveConfig 浅拷贝覆盖风险 (已修复) | `src/config/index.js` | 坏味道 | 改用 `deepMerge` 深合并 + `structuredClone` 断链出厂默认引用，杜绝嵌套子属性丢失与跨调用突变污染 | M2 阶段 |
| 外部配置装载隐式 cwd 依赖 (已修复) | `src/config/index.js` | 环境敏感 | SDK 调用时默认回退至 `process.cwd()`，存在跨目录解析偏差 | M1 阶段 |
| 外部脚本未沙箱化执行 | `src/config/mounts.js` | 安全隐患 | `.js` / `.cjs` 配置文件通过 `require()` 直接执行，未做沙箱隔离 | M3 阶段 |

### 3. Core 核心算法与安全沙箱层问题清单 (第 2 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 节点分类函数原地突变对象 (已修复) | `src/core/cleaner.js` | 坏味道 | `classifyNode` 直接修改入参对象的 `server/port/name`，违背纯函数原则 | M1 阶段 |
| 机场订阅 Tag 隐式豁免广告清洗 (已修复) | `src/core/cleaner.js` | 逻辑缺陷 | 白名单包含 `subTagLower === k`，匹配时整机场节点被提权跳过清洗 | M1 阶段 |
| 地区元数据双重事实源 (已修复) | `src/core/metadata.js` | 冗余/漂移 | 手写 40+ 地区 `REGION_METADATA_MAP`，与 `regions.js` 并行存在易漂移 | M1 阶段 |
| 废弃名称消歧函数残留死代码 (已修复) | `src/core/rename.js` | 遗留代码 | `resolveNameCollisions` 已被命名计划取代，业务代码无调用点 | M1 阶段 |
| 日志脱敏遗漏现代代理协议 (已修复) | `src/core/logger.js` | 安全缺陷 | 仅脱敏 SS/VLESS/Trojan，遗漏 Hysteria2、TUIC、VMess 的密码凭证 | M1 阶段 |
| 简繁同步按逗号盲目替换组名 (已修复) | `src/core/chinese-sync.js` | 坏味道 | 引入括号感知分词器与 TARGET 精准定位，杜绝同名参数与规则关键字误伤 | M2 阶段 |
| 弱引用信任凭据克隆易断裂 (已修复) | `src/core/node-trust.js` | 设计脆弱性 | 提供 `copyTrustedProxy` 浅拷贝/克隆凭据完整复制，解决 WeakSet/WeakMap 凭据断裂 | M2 阶段 |
| 简易根域推导规则覆盖有限 (已修复) | `src/core/security/resolver-plan.js` | 边界局限 | 扩充常见 PaaS、DDNS 动态域名与各类国家/地区复合公共后缀（含省级 ccTLD）泛化聚合防御 | M2 阶段 |
| 基础网络/流量工具放置错层 (已修复) | `src/core/shared/ip.js`, `sub-info.js` | 架构债务 | 纯基础工具错置于 Core 层，导致 `IO -> Core` 反向引用违规 | M1 阶段 |
| 图标系统模型二义性与硬编码散落 (已修复) | `src/strategy/presentation.js`, `catalog.js` | 设计坏味道 | 规范化资产并支持 groupIcons 覆盖与 groupIconMode: none 纯净模式 | M3 阶段 |

### 4. IO 边界层与协议解析器问题清单 (第 3 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 同步 isAllowedUrl 绕过 DNS 校验 (已修复) | `src/io/ssrf.js`, `targets/server.js` | 安全隐患 | `isAllowedUrl` 为纯同步方法，面对解析至内网的域名时完全失效 | M1 阶段 |
| 域名并发解析无流控与排队池 (已修复) | `src/io/dns-resolver.js` | 资源耗尽风险 | `resolveProxiesDomains` 引入自实现信号量（上限 16）以固定并发批量解析，消除全量并发打爆套接字 | M2 阶段 |
| DoH 查询不支持代理且串行阻塞 (已修复) | `src/io/dns-resolver.js` | 健壮性缺陷 | `queryDoh` 引入 AliDNS 与 Google 双路并发竞速（首个非空胜出），且支持经本地代理转发与分发器复用 | M2 阶段 |
| Shadowsocks 密码与插件多值截断 (已修复) | `src/io/parsers/shadowsocks.js` | 兼容性缺陷 | 明文凭证用 `split(':')`，密码含冒号被截断；插件参数用 `split('=')` 同理截断 | M1 阶段 |
| VMess 字段兼容狭窄与伪装头丢失 (已修复) | `src/io/parsers/vmess.js` | 兼容性缺陷 | TLS 仅严格匹配字符串 `'tls'`；`tcp+http` 混淆伪装头时丢弃了 host/path | M1 阶段 |
| gRPC 协议路径多别名兼容缺失 (已修复) | `src/io/parsers/vless.js`, `trojan.js` | 兼容性缺陷 | 仅获取 `serviceName`，未兼容通用的 `service-name` 或 `path` 参数 | M1 阶段 |
| HTTP 重试状态码一刀切判死 4xx (已修复) | `src/io/fetcher.js` | 健壮性坏味道 | `err.retryable = res.status >= 500` 导致 HTTP 429 与 408 直接放弃重试 | M1 阶段 |
| 订阅内容 Base64 盲解码性能开销 (已修复) | `src/io/parsers/index.js` | 性能坏味道 | `isLikelyBase64` 字符特征预检跳过非 Base64 文本，结构化 Plain YAML/JSON 优先解析 | M2 阶段 |
| 订阅容灾与构建结果双轨缓存割裂 (已修复) | `src/io/cache.js`, `fetcher.js` | 设计坏味道 | 抽出共享原语 `GenerationSource` 与 `isSuperseded`，统一版本代际时序分配与超限抛错策略 | M2 阶段 |

### 5. Strategy 策略与拓扑生成层问题清单 (第 4 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 策略组目标模糊子串匹配风险 (已修复) | `src/strategy/topology.js` | 逻辑隐患 | `customGroups` 匹配使用双向 `includes`，目标名为“节点”易错误注入 | M1 阶段 |
| 哈希负载均衡组硬编码 Emoji 泄露 (已修复) | `src/strategy/topology.js`, `presentation.js` | 规范缺陷 | `⚖️ 负载均衡-哈希` 组名硬编码带 Emoji，纯图标模式下无法剥离 | M1 阶段 |
| TUN 路由排除缺少 IPv6 私网网段 (已修复) | `src/strategy/kernel.js` | 规范缺陷 | TUN `route-exclude-address` 补齐 IPv6 私网与链路本地网段 (`fc00::/7` 与 `fe80::/10`) | M2 阶段 |
| 内核优化阶段原地突变代理对象 (已修复) | `src/strategy/kernel.js` | 坏味道 | 原地修改 `config.proxies` 节点的 `client-fingerprint` 与 `udp` 属性 | M1 阶段 |
| 规则展示层盲目分词替换组名 (已修复) | `src/strategy/presentation.js` | 坏味道 | 规则组装与更名限定在 TARGET 字段，杜绝误伤规则类型、参数或同名域名关键字 | M2 阶段 |
| 看板虚拟节点服务 IP 定义冲突 (已修复) | `src/strategy/dashboard.js`, `core/cleaner.js` | 冗余/漂移 | 看板创建时使用 `1.0.0.1`，而在 cleaner 中又硬编码为 `127.0.0.1` | M1 阶段 |
| `disabled` 语义经下划线隐式通道传递 (已修复) | `src/config/groups.js`, `src/config/index.js` | 设计坏味道 | `disabled` 曾原地写 `directory[refKey]._disabled` 传递关闭状态，违反「禁止在对象上挂 `_` 前缀隐式通道」约定；include 并集下两种书写顺序分别导致「组仍生成但 routing 报已禁用」与「`_disabled` 被浅拷贝进声明、校验报未知字段」。现改为 `resolveGroupDeclarations` 显式返回 `{ declarations, refKeys, disabledRefs }`，同键多次出现按位置靠后者胜，关闭状态由配置字段下传 routing | M3 收口 |
| `routing` 的 `disabled` 与规格不一致 (已修复) | `src/strategy/routing.js`, `ROADMAP.md` | 逻辑缺陷 | `disabled` 曾只跳过自身，include 并集时无法关闭片段中的同键条目；ROADMAP 10.4 承诺的 `before` / `after` 锚点与重复匹配式冲突检查未实现。现按稳定键（`preset` / `service` / `rule` 原文 + `direction`）在合并后统一结算，同键最后一次出现决定开关；ROADMAP / CONFIGURATION 已对齐为「整表替换、无锚点、冲突检查为候选」 | M3 收口 |

### 6. Pipeline 编排与 Targets 宿主交付层问题清单 (第 5 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 订阅摄入全流程大量代码复制粘贴 (已修复) | `src/pipeline/ingestion.js` | 代码坏味道 | `ingestSubscriptions` 与 `ingestUrls` 存在超 130 行完全一致的流程代码 | M1 阶段 |
| 策略层同步降级兜底逻辑重复实现 (已修复) | `src/pipeline/strategy.js`, `nodes.js` | 架构坏味道 | 抽出 `cleanAndClassifyNodesSync`，统一由 `nodes.js` 承载同步清洗打标流水线，`strategy.js` 消除 60 行重复代码 | M2 阶段 |
| 服务端缺少优雅退出与平滑停机 (已修复) | `src/targets/server.js` | 生产级缺陷 | 监听 `SIGTERM`/`SIGINT`，退出条件收敛为连接关闭 ∧ 任务排空，覆盖后台预热与定时刷新 | M2 阶段 |
| 配置文件热重载缺乏防抖并发保护 (已修复) | `src/targets/server.js` | 健壮性坏味道 | 热重载实现单飞合并（co-flight）与 0 字节临时写入防抖容错，杜绝并发竞争与脏读 | M2 阶段 |
| CLI 缺乏 dry-run 与诊断验证模式 (已修复) | `src/targets/cli.js` | 运维缺陷 | 新增 `--dry-run` / `--validate` 模式，完整校验配置语法、订阅连通性与 DNS 不变式且绝不落盘 | M2 阶段 |
| include 展开默认基准目录隐式依赖 cwd (已修复) | `src/pipeline/engine.js` | 环境敏感 | 展开 `expandIncludes` 时硬编码传入 `process.cwd()`，跨目录 SDK 调用有偏差 | M1 阶段 |
| 健康检查端点监控指标粗糙 (已修复) | `src/targets/server.js` | 运维缺陷 | `/healthz` 完善 `activeBuilds`、`maxConcurrentBuilds`、Profile SWR 缓存命中率与订阅健康度聚合快照 | M2 阶段 |

