# 🗺️ Mihomo-Toolkit 演进路线图 (ROADMAP)

本文档制定 Mihomo-Toolkit 的**真实版本发布里程碑、技术债务治理清单与功能演进路线**。  
全篇以**“稳定性先行、大动作排后、以代码实际运行为唯一事实来源”**为核心准则。

---

## 🧭 当前项目状态定级

- **当前版本**：`v2.0.0-alpha`
- **真实研发完成度**：**约 40% ~ 45%**
- **当前核心成果**：纯计算内核基本稳固（节点清洗、特征与线路提取、8 种协议指纹去重、两阶段命名仲裁、DAG 剪枝破环、430 个单元测试全绿）。
- **治理原则**：**先保稳定性与现有功能闭环，再做拓扑大重构**。在未彻底解决现存安全漏洞、逻辑倒挂、反向依赖和代码重复之前，不盲目推进大范围功能扩张。

---

## 🎯 里程碑演进阶梯 (Milestone Pipeline)

```text
┌─────────────────────────────────────────────────────────────┐
│ 🟢 Milestone 1: v2.0-Alpha 稳定性加固与核心债务清零 (当前)   │
│ • 优先排障：修复 customRules 优先级倒挂、isAllowedUrl 穿透   │
│ • 架构纯化：消除 IO->Core 反向依赖、干掉原地突变与死代码     │
│ • 健壮性补全：协议解析参数截断修复、日志脱敏补齐、重复代码收敛│
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 🟡 Milestone 2: v2.0-Beta 宿主健壮性与生产级加固 (稳固下半场) │
│ • 优雅停机：HTTP Server 平滑退出 (Graceful Shutdown) 与排空 │
│ • 运行安全：DNS 裂变并发流控池、配置文件热重载防抖并发保护   │
│ • 诊断可观测：CLI --dry-run 诊断模式、/healthz 运行时监控指标 │
└──────────────────────────────┬──────────────────────────────┘
                               │ (在底层与宿主绝对稳定后，再动大架构)
┌──────────────────────────────▼──────────────────────────────┐
│ 🔵 Milestone 3: v2.0-GA 声明式策略拓扑与配置解耦 (大动作核心)│
│ • 彻底打破硬编码：支持声明式自定义策略组 DSL 与拓扑引擎     │
│ • 服务编目单点激活：消除双重配置负担                         │
│ • 资产规范化：统一 IconRegistry，解决 Emoji 与图标二义性     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 🟣 Milestone 4: v2.1+ 深度能力与生态扩展 (未来展望)         │
│ • 本地离线 IP/ASN 标签库 ({isp}, {asn})                      │
│ • Sub-Store 节点清洗与打标流水线适配模块                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📅 里程碑详细规划

### 🟢 Milestone 1: v2.0-Alpha 稳定性加固与核心债务清零 (当前阶段 · 优先执行)
> **阶段目标**：清理审查中发现的所有核心逻辑缺陷、协议解析边界问题与架构坏味道，确保内核纯净与稳定。

- [ ] **高危逻辑与配置意图对齐**：
  - [x] 修复 `customRules` 分流优先级与文档倒挂（从末尾提前至匹配首位，确保自定义私域规则不被内置规则拦截）；
  - 修复 `isAllowedUrl` 同步白名单绕过问题，服务端预检引入完整主机名与 IP 安全校验。
- [x] **架构分层反向依赖清理**：
  - [x] 下沉基础网络与流量工具至独立基础设施层 (`src/infra/`)，彻底解决 `scripts/verify-architecture.js` 报出的 `IO -> Core: ❌ 2` 违规。
- [x] **协议解析器健壮性与边界修复**：
  - [x] Shadowsocks 解析器修复：改用 `indexOf(':')` 提取密码（防密码包含冒号被截断），插件参数防等号截断并兼容 SIP003 内联插件；
  - [x] VMess 解析器修复：兼容 `tls: 1 / true` 多种真值形式，补齐 `net: tcp` 搭配 `type: http` 伪装头（Host/Path）提取；
  - [x] VLESS / Trojan 解析器修复：gRPC 路径兼容读取 `service-name` 与 `path` 别名。
- [x] **纯函数原则重塑与原地突变消除**：
  - [x] 消除 `cleaner.js:classifyNode` 中原地修改 `proxy.server / port / name` 的副作用；
  - [x] 消除 `kernel.js:applyCoreOptimize` 中原地修改代理节点属性的副作用；
  - [x] 修正机场订阅 Tag 隐式豁免广告清洗的逻辑越权缺陷（`subTagLower === k`）。
- [ ] **代码去重与死代码清理**：
  - [ ] 消除 `ingestion.js` 中 `ingestSubscriptions` 与 `ingestUrls` 之间超 130 行的重复代码；
  - [x] 剔除 `rename.js` 中未被业务调用的遗留死代码 `resolveNameCollisions`；
  - [x] 统一 `metadata.js` 与 `regions.js` 的地区事实源，统一看板节点假 IP 定义（`1.0.0.1` vs `127.0.0.1`）。
- [x] **安全隐私与凭证脱敏加固**：
  - [x] 补全终端 Logger 对 Hysteria 2 (`hy2://`)、TUIC (`tuic://`)、Socks 与 VMess 节点敏感凭据的脱敏正则。

---

### 🟡 Milestone 2: v2.0-Beta 宿主健壮性与生产级加固 (稳固下半场)
> **阶段目标**：加固 HTTP Server 与 CLI 的生产可用性，增强运行期容灾与排障体验。

- [ ] **生产级 HTTP 服务平滑退出与并发保护**：
  - 注册 `process.on('SIGTERM')` 与 `SIGINT` 信号监听，实现 Graceful Shutdown，等待进行中任务排空后再关闭；
  - 配置文件热重载增加防抖与并发读写保护，避免多请求并发解析或读取到编辑器未写完的中间态。
- [ ] **资源流控与并发限制**：
  - `dns-resolver.js` 引入并发限制队列（如 p-limit / 信号量），解决域名裂变瞬间并发数百 DNS 查询导致套接字耗尽的问题；
  - DoH 查询增加代理支持与并发竞速，消除 AliDNS 与 Google DNS 串行超时卡顿。
- [ ] **运维诊断与监控增强**：
  - CLI 新增 `--dry-run` / `--validate` 模式：仅测试配置语法、订阅连通性与 DNS 不变式，不写入磁盘；
  - 完善 `/healthz` 监控端点：输出当前 `activeBuilds`、Profile 缓存命中率与各订阅健康度。
- [ ] **运行环境与基准兼容**：
  - 消除 `engine.js` 展开 include 时硬编码依赖 `process.cwd()` 的缺陷，支持 SDK 跨目录配置传递；
  - 抽象并统一 `ProfileCache` 与 `SubStaleCacheMap` 的版本淘汰时序逻辑。

---

### 🔵 Milestone 3: v2.0-GA 声明式策略拓扑与配置解耦 (大动作核心)
> **阶段目标**：在内核与宿主绝对稳固的前提下，打破代码硬编码，实现灵活的拓扑 DSL 引擎。

- [ ] **声明式策略拓扑引擎 (Declarative Topology Engine)**：
  - 将 `src/strategy/topology.js` 中的大段硬编码重构为数据驱动的声明式规则；
  - 允许用户在 `config.yaml` 中像原生 Mihomo 一样自定义策略组（自定义组名、类型、节点筛选表达式、嵌套层级），由 DAG 引擎统一管理生命周期。
- [ ] **服务编目单点激活**：
  - 优化 `src/config/catalog.js`：用户在 `customServices` 中声明即默认激活，消除必须在 `aiServices` 等列表二次声明的冗余。
- [ ] **图标系统模型统一重构 (Icon Registry)**：
  - 消除 `icon` 字段概念混淆（国旗 Emoji vs 本地图片 vs 远程 URL），建立统一的图标资产管理规范；
  - 支持策略组骨架组图标自定义配置覆盖；
  - 策略组与节点命名模式联动，支持完全去除 Emoji 的纯净模式。
- [ ] **安全进阶防御**：
  - 探索网络抓取建连阶段的 IP 固定（IP Pinning）机制，彻底阻断基于 DNS Rebinding 的 SSRF 窗口。

---

### 🟣 Milestone 4: v2.1+ 深度能力与生态扩展 (未来展望)
> **阶段目标**：在保持纯 JS、无外部原生依赖的前提下，拓展生态集成能力。

1. **本地离线 IP/ASN 标签库**：
   - 探索轻量静态离线数据库方案，在重命名阶段补充 `{isp}`、`{asn}` 变量，杜绝在线网络查询 API。
2. **Sub-Store 节点处理生态适配**：
   - 提供适用于 Sub-Store 的轻量适配模块，复用核心清洗、打标与重命名能力。

---

## 📋 全量技术债务与代码坏味道治理跟踪表 (已全量归入里程碑)

### 1. 核心架构与功能性缺陷
| 缺陷项 | 归属模块 | 严重级别 | 现状与治理方向 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| `IO -> Core` 反向引用 | `src/io/ssrf.js`, `parsers/index.js` | 🟡 中 | 依赖 Core 的基础工具函数，下沉公共基础模块 | M1 阶段 |
| customRules 分流优先级倒挂 | `src/strategy/rules.js` | 🔴 高 | 文档声明最高但代码放在最后，自上而下首命中导致失效，需提至首位 | M1 阶段 |
| 策略组硬编码不可扩展 | `src/strategy/topology.js` | 🔴 高 | 无法自由建全新策略组，重构为声明式拓扑引擎 | M3 阶段 |
| 服务配置双重声明 | `src/config/catalog.js` | 🟡 中 | 用户需在两个地方配置才能启用自定义服务 | M3 阶段 |
| SSRF TOCTOU 窗口 | `src/io/ssrf.js` | 🟡 中 | 校验与连接使用两次 DNS，评估 IP Pinning 成本 | M3 阶段 |

### 2. Data & Config 层问题清单 (第 1 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 分类开关判定遗漏与不一致 | `src/config/catalog.js` | 逻辑缺陷 | 遍历 `dev` 分类时未检查开关；判定逻辑存在 `=== false` 与 `!` 混用 | M1 阶段 |
| 绕过 Logger 的裸控制台输出 | `src/config/index.js` | 坏味道 | `applyAdditiveFields` 使用 `console.warn`，静默模式下仍会输出 | M1 阶段 |
| 循环内重复排序静态字典 (已修复) | `src/data/cleaner-rules.js` | 性能坏味道 | `CARRIER_COMBO_MAP` 预排序常量化为 `SORTED_CARRIER_COMBOS`，消除循环内排序开销 | M1 阶段 |
| 字段注册表元数据分类错位 | `src/data/field-registry.js` | 规范/遗留 | `include` 错划入扩展分流开关；`devServices` 错划入图标仓库 | M1 阶段 |
| 注册表兜底机制双轨制 | `src/data/field-registry.js` | 设计坏味道 | 存在 12 个 `default: undefined` 字段依赖代码内隐式兜底 | M2 阶段 |
| include 原始对象二次传参穿透 | `src/config/include.js` | 边界缺陷 | `WeakSet` 仅缓存展开后对象，二次传入同字面量无法阻断二次读盘 | M1 阶段 |
| resolveConfig 浅拷贝覆盖风险 | `src/config/index.js` | 坏味道 | 顶层使用 `Object.assign` 浅合并，复杂嵌套配置存在子属性丢失风险 | M2 阶段 |
| 外部配置装载隐式 cwd 依赖 | `src/config/index.js` | 环境敏感 | SDK 调用时默认回退至 `process.cwd()`，存在跨目录解析偏差 | M1 阶段 |
| 外部脚本未沙箱化执行 | `src/config/mounts.js` | 安全隐患 | `.js` / `.cjs` 配置文件通过 `require()` 直接执行，未做沙箱隔离 | M3 阶段 |

### 3. Core 核心算法与安全沙箱层问题清单 (第 2 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 节点分类函数原地突变对象 | `src/core/cleaner.js` | 坏味道 | `classifyNode` 直接修改入参对象的 `server/port/name`，违背纯函数原则 | M1 阶段 |
| 机场订阅 Tag 隐式豁免广告清洗 | `src/core/cleaner.js` | 逻辑缺陷 | 白名单包含 `subTagLower === k`，匹配时整机场节点被提权跳过清洗 | M1 阶段 |
| 地区元数据双重事实源 | `src/core/metadata.js` | 冗余/漂移 | 手写 40+ 地区 `REGION_METADATA_MAP`，与 `regions.js` 并行存在易漂移 | M1 阶段 |
| 废弃名称消歧函数残留死代码 | `src/core/rename.js` | 遗留代码 | `resolveNameCollisions` 已被命名计划取代，业务代码无调用点 | M1 阶段 |
| 日志脱敏遗漏现代代理协议 | `src/core/logger.js` | 安全缺陷 | 仅脱敏 SS/VLESS/Trojan，遗漏 Hysteria2、TUIC、VMess 的密码凭证 | M1 阶段 |
| 简繁同步按逗号盲目替换组名 | `src/core/chinese-sync.js` | 坏味道 | 路由规则分词替换未限定在第 3 个字段，极端情况可能误伤同名参数 | M2 阶段 |
| 弱引用信任凭据克隆易断裂 | `src/core/node-trust.js` | 设计脆弱性 | 节点受信基于 `WeakSet` 引用，深拷贝或序列化后凭证静默丢失 | M2 阶段 |
| 简易根域推导规则覆盖有限 | `src/core/security/resolver-plan.js` | 边界局限 | `getRootDomain` 采用有限正则，缺少完整 PSL 支持，未知平台可能过度折叠 | M2 阶段 |
| 基础网络/流量工具放置错层 | `src/core/shared/ip.js`, `sub-info.js` | 架构债务 | 纯基础工具错置于 Core 层，导致 `IO -> Core` 反向引用违规 | M1 阶段 |
| 图标系统模型二义性与硬编码散落 | `src/strategy/presentation.js`, `catalog.js` | 设计坏味道 | `icon` 混用为国旗 Emoji、图片与 URL；骨架组硬编码在代码中无法配置 | M3 阶段 |

### 4. IO 边界层与协议解析器问题清单 (第 3 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 同步 isAllowedUrl 绕过 DNS 校验 | `src/io/ssrf.js`, `targets/server.js` | 安全隐患 | `isAllowedUrl` 为纯同步方法，面对解析至内网的域名时完全失效 | M1 阶段 |
| 域名并发解析无流控与排队池 | `src/io/dns-resolver.js` | 资源耗尽风险 | `resolveProxiesDomains` 全量并发，大订阅易耗尽套接字并触发 DNS 限流 | M2 阶段 |
| DoH 查询不支持代理且串行阻塞 | `src/io/dns-resolver.js` | 健壮性缺陷 | `queryDoh` 裸调用全局 `fetch`，不走本地代理；且对 AliDNS 与 Google 串行兜底阻塞 | M2 阶段 |
| Shadowsocks 密码与插件多值截断 | `src/io/parsers/shadowsocks.js` | 兼容性缺陷 | 明文凭证用 `split(':')`，密码含冒号被截断；插件参数用 `split('=')` 同理截断 | M1 阶段 |
| VMess 字段兼容狭窄与伪装头丢失 | `src/io/parsers/vmess.js` | 兼容性缺陷 | TLS 仅严格匹配字符串 `'tls'`；`tcp+http` 混淆伪装头时丢弃了 host/path | M1 阶段 |
| gRPC 协议路径多别名兼容缺失 | `src/io/parsers/vless.js`, `trojan.js` | 兼容性缺陷 | 仅获取 `serviceName`，未兼容通用的 `service-name` 或 `path` 参数 | M1 阶段 |
| HTTP 重试状态码一刀切判死 4xx | `src/io/fetcher.js` | 健壮性坏味道 | `err.retryable = res.status >= 500` 导致 HTTP 429 与 408 直接放弃重试 | M1 阶段 |
| 订阅内容 Base64 盲解码性能开销 | `src/io/parsers/index.js` | 性能坏味道 | 未做字符特征预检，对任意 Plain 文本直接调用解码，造成无效解析尝试 | M2 阶段 |
| 订阅容灾与构建结果双轨缓存割裂 | `src/io/cache.js`, `fetcher.js` | 设计坏味道 | `ProfileCache` 与 `SubStaleCacheMap` 各自手写版本代际防护，机制重复割裂 | M2 阶段 |

### 5. Strategy 策略与拓扑生成层问题清单 (第 4 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 策略组目标模糊子串匹配风险 | `src/strategy/topology.js` | 逻辑隐患 | `customGroups` 匹配使用双向 `includes`，目标名为“节点”易错误注入 | M1 阶段 |
| 哈希负载均衡组硬编码 Emoji 泄露 | `src/strategy/topology.js`, `presentation.js` | 规范缺陷 | `⚖️ 负载均衡-哈希` 组名硬编码带 Emoji，纯图标模式下无法剥离 | M1 阶段 |
| TUN 路由排除缺少 IPv6 私网网段 | `src/strategy/kernel.js` | 规范缺陷 | 路由排除名单仅写死 IPv4 私网，未包含 `fc00::/7` 与 `fe80::/10` | M2 阶段 |
| 内核优化阶段原地突变代理对象 | `src/strategy/kernel.js` | 坏味道 | 原地修改 `config.proxies` 节点的 `client-fingerprint` 与 `udp` 属性 | M1 阶段 |
| 规则展示层盲目分词替换组名 | `src/strategy/presentation.js` | 坏味道 | 按逗号切分后的所有 token 盲目尝试替换 Emoji，未限定在 TARGET 字段 | M2 阶段 |
| 看板虚拟节点服务 IP 定义冲突 | `src/strategy/dashboard.js`, `core/cleaner.js` | 冗余/漂移 | 看板创建时使用 `1.0.0.1`，而在 cleaner 中又硬编码为 `127.0.0.1` | M1 阶段 |

### 6. Pipeline 编排与 Targets 宿主交付层问题清单 (第 5 批审查)
| 问题项 | 归属模块 | 类别 | 现象与隐患说明 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| 订阅摄入全流程大量代码复制粘贴 | `src/pipeline/ingestion.js` | 代码坏味道 | `ingestSubscriptions` 与 `ingestUrls` 存在超 130 行完全一致的流程代码 | M1 阶段 |
| 策略层同步降级兜底逻辑重复实现 | `src/pipeline/strategy.js`, `nodes.js` | 架构坏味道 | 因 `runStrategyPipeline` 同步性，手写了 60 行同步版清洗逻辑与 `nodes.js` 割裂 | M2 阶段 |
| 服务端缺少优雅退出与平滑停机 | `src/targets/server.js` | 生产级缺陷 | 未监听 `SIGTERM`/`SIGINT`，容器终止时直接强杀，无法等待请求排空 | M2 阶段 |
| 配置文件热重载缺乏防抖并发保护 | `src/targets/server.js` | 健壮性坏味道 | 高并发下检测到变动时并发触发同步重读，遇编辑器中间态易报错回退 | M2 阶段 |
| CLI 缺乏 dry-run 与诊断验证模式 | `src/targets/cli.js` | 运维缺陷 | 缺少在不写盘情况下测试语法、连通性与 DNS 不变式的诊断命令 | M2 阶段 |
| include 展开默认基准目录隐式依赖 cwd | `src/pipeline/engine.js` | 环境敏感 | 展开 `expandIncludes` 时硬编码传入 `process.cwd()`，跨目录 SDK 调用有偏差 | M1 阶段 |
| 健康检查端点监控指标粗糙 | `src/targets/server.js` | 运维缺陷 | `/healthz` 缺乏活跃构建数、缓存容量与异常订阅等运行时指标 | M2 阶段 |
