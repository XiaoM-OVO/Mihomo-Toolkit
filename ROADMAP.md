# 🗺️ Mihomo-Toolkit 演进路线图 (ROADMAP)

本文档制定 Mihomo-Toolkit 的**真实版本发布里程碑、技术债务治理清单与功能演进路线**。  
全篇以**“稳定性先行、大动作排后、以代码实际运行为唯一事实来源”**为核心准则。

---

## 🧭 当前项目状态定级

- **当前版本**：`v4.0.0-alpha`（M1 与 M2 全量债务清零，研发代号由内部 2.0 正式升格为 4.0）
- **真实研发完成度**：**约 60% ~ 65%**
- **当前核心成果**：纯计算内核稳固、宿主健壮性与生产级加固全量闭环（平滑停机与后台预热双重排空、DNS 并发流控与 DoH 竞速/代理支持、CLI --dry-run 诊断模式、/healthz 缓存命中率与订阅健康度、版本代际时序原语 GenerationSource、497 个单元测试全绿）。
- **治理原则**：**先保稳定性与现有功能闭环，再做拓扑大重构**。在未妥善解决现存安全漏洞、逻辑倒挂、反向依赖和代码重复之前，不盲目推进大范围功能扩张。

---

## 🎯 里程碑演进阶梯 (Milestone Pipeline)

```text
┌─────────────────────────────────────────────────────────────┐
│ 🟢 Milestone 1: 稳定性加固与核心债务清零 (已完成 ✅)         │
│ • 优先排障：修复 customRules 优先级倒挂、isAllowedUrl 穿透   │
│ • 架构纯化：消除 IO->Core 反向依赖、干掉原地突变与死代码     │
│ • 健壮性补全：协议解析参数截断修复、日志脱敏补齐、重复代码收敛│
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 🟢 Milestone 2: 宿主健壮性与生产级加固 (已完成 ✅)           │
│ • 优雅停机：HTTP Server 平滑退出 (Graceful Shutdown) 与排空 │
│ • 运行安全：DNS 裂变并发流控池、配置文件热重载防抖并发保护   │
│ • 诊断可观测：CLI --dry-run 诊断模式、/healthz 运行时监控指标 │
└──────────────────────────────┬──────────────────────────────┘
                               │ (底层与宿主已充分稳固，全面启动大架构)
┌──────────────────────────────▼──────────────────────────────┐
│ 🔵 Milestone 3: 声明式策略拓扑与配置解耦 (推进中 🚀)        │
│ • 打破双硬编码：解耦 SSOT 元数据与 topology 组装机制         │
│ • 声明式策略组：支持 customGroups (match 配方 + 黑名单)     │
│ • 资产规范化：统一 IconRegistry，解决 Emoji 与图标二义性     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 🟣 Milestone 4: v4.0-GA 正式发布与生态扩展 (未来展望)       │
│ • 合并至 main 分支，发布 v4.0.0 正式版，3.x 大脚本转入维护  │
│ • 本地离线 IP/ASN 标签库 ({isp}, {asn})                      │
│ • Sub-Store 节点清洗与打标流水线适配模块                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📅 里程碑详细规划

### 🟢 Milestone 1: v2.0-Alpha 稳定性加固与核心债务清零 (当前阶段 · 优先执行)
> **阶段目标**：清理审查中发现的所有核心逻辑缺陷、协议解析边界问题与架构坏味道，确保内核纯净与稳定。

- [x] **高危逻辑与配置意图对齐**：
  - [x] 修复 `customRules` 分流优先级与文档倒挂（从末尾提前至匹配首位，确保自定义私域规则不被内置规则拦截）；
  - [x] 修复 `isAllowedUrl` 同步白名单绕过问题，服务端预检引入完整主机名与 IP 安全校验。
- [x] **架构分层反向依赖清理**：
  - [x] 下沉基础网络与流量工具至独立基础设施层 (`src/infra/`)，解决 `scripts/verify-architecture.js` 报出的 `IO -> Core: ❌ 2` 违规。
- [x] **协议解析器健壮性与边界修复**：
  - [x] Shadowsocks 解析器修复：改用 `indexOf(':')` 提取密码（防密码包含冒号被截断），插件参数防等号截断并兼容 SIP003 内联插件；
  - [x] VMess 解析器修复：兼容 `tls: 1 / true` 多种真值形式，补齐 `net: tcp` 搭配 `type: http` 伪装头（Host/Path）提取；
  - [x] VLESS / Trojan 解析器修复：gRPC 路径兼容读取 `service-name` 与 `path` 别名。
- [x] **纯函数原则重塑与原地突变消除**：
  - [x] 消除 `cleaner.js:classifyNode` 中原地修改 `proxy.server / port / name` 的副作用；
  - [x] 消除 `kernel.js:applyCoreOptimize` 中原地修改代理节点属性的副作用；
  - [x] 修正机场订阅 Tag 隐式豁免广告清洗的逻辑越权缺陷（`subTagLower === k`）。
- [x] **代码去重与死代码清理**：
  - [x] 消除 `ingestion.js` 中多订阅与单 URL 两条路径之间超 130 行的重复代码；
  - [x] 剔除 `rename.js` 中未被业务调用的遗留死代码 `resolveNameCollisions`；
  - [x] 统一 `metadata.js` 与 `regions.js` 的地区事实源，统一看板节点假 IP 定义（`1.0.0.1` vs `127.0.0.1`）。
- [x] **安全隐私与凭证脱敏加固**：
  - [x] 补全终端 Logger 对 Hysteria 2 (`hy2://`)、TUIC (`tuic://`)、Socks 与 VMess 节点敏感凭据的脱敏正则。

---

### 🟡 Milestone 2: v2.0-Beta 宿主健壮性与生产级加固 (稳固下半场)
> **阶段目标**：加固 HTTP Server 与 CLI 的生产可用性，增强运行期容灾与排障体验。

- [x] **生产级 HTTP 服务平滑退出与并发保护**：
  - [x] 注册 `process.on('SIGTERM')` 与 `SIGINT` 信号监听，实现 Graceful Shutdown，等待进行中任务排空后再关闭；
  - [x] 停机退出条件收敛为「连接已全部关闭 ∧ 任务已全部排空」，补齐后台预热/定时刷新的排空等待（避免 `server.close` 回调在无入站连接时提前 resolve，令后台刷新写缓存中途被 kill）；
  - [x] 配置文件热重载增加防抖与并发读写保护，避免多请求并发解析或读取到编辑器未写完的中间态。
- [x] **资源流控与并发限制**：
  - [x] `dns-resolver.js` 引入并发限制队列（自实现信号量，零外部依赖，上限 16），解决域名裂变瞬间并发数百 DNS 查询导致套接字耗尽的问题；
  - [x] DoH 查询增加代理支持（复用 `fetchProxyPort` / `fetchProxyStrategy` 出口策略，经本地回环代理转发；与订阅抓取共用 `fetch-proxy.js` 的回环校验与分发器缓存）与并发竞速（已实现：AliDNS 与 Google DNS 双路并发，首个非空结果胜出，消除串行超时卡顿）。
- [x] **运维诊断与监控增强**：
  - [x] CLI 新增 `--dry-run` / `--validate` 模式：完整校验配置语法、订阅连通性与 DNS 不变式，且绝不写入任何磁盘产物；存在 DNS 不变式违规或订阅全部不可用时以退出码 1 失败关闭（可直接接入 CI）；
  - [x] 完善 `/healthz` 监控端点：在原有 `activeBuilds` / `maxConcurrentBuilds` 基础上新增 Profile SWR 缓存命中率（hits/misses/hitRate）与订阅健康度聚合视图（enabled / lastBuildAt / lastBuildOk / hasFailedSub / hasTerminalFailure）；逐条订阅明细留待 ingestion→engine 贯通为后续增强。
- [x] **运行环境与基准兼容**：
  - [x] 消除 `engine.js` 展开 include 时硬编码依赖 `process.cwd()` 的缺陷，支持 SDK 跨目录配置传递；
  - [x] 抽象并统一 `ProfileCache` 与 `SubStaleCacheMap` 的版本淘汰时序逻辑：抽出共享原语 `src/io/generation.js`（`GenerationSource` 单调递增序号源 + `isSuperseded` 超越判定），收敛两处手写代际机制与分叉的溢出策略（统一为超限抛错、杜绝回绕重号）。

---

### 🔵 Milestone 3: 声明式策略拓扑与配置解耦 (大动作核心 · 推进中 🚀)
> **阶段目标**：破除元数据与装配机制双硬编码耦合，实现数据驱动的声明式拓扑引擎。

- [ ] **声明式策略拓扑与装配解耦 (Declarative Topology Engine)**：
  - 破除双硬编码与强耦合：服务元数据归 `catalog.js`，装配规则归拓扑引擎，解决“修改策略组逻辑需改两处甚至改源码”的痛点；
  - 声明式自定义策略组：允许用户在 `config.yaml` 中通过 `customGroups` 自定义策略组（原生静态字段透传，配合 `match` 动态挑人配方与 `exclude` 黑名单）；
  - 规则与图标联动：支持在组声明中关联 `rules` 与 `emoji`/`icon`，全自动挂载分流与展示层渲染。
- [ ] **图标系统模型统一重构 (Icon Registry)**：
  - 消除 `icon` 字段概念混淆（国旗 Emoji vs 本地图片 vs 远程 URL），建立统一的图标资产管理规范；
  - 支持策略组骨架组图标自定义配置覆盖；
  - 策略组与节点命名模式联动，支持完全去除 Emoji 的纯净模式。
- [ ] **安全进阶防御**：
  - 探索网络抓取建连阶段的 IP 固定（IP Pinning）机制，阻断基于 DNS Rebinding 的 SSRF 窗口。

---

### 🟣 Milestone 4: v4.0-GA 正式发布与生态扩展 (未来展望)
> **阶段目标**：在保持纯 JS、无外部原生依赖的前提下，拓展生态集成能力并完成主分支合流。

1. **合并合流与 3.x 归档**：
   - 合并至 `main` 分支发布 `v4.0.0` 正式版；3.x 单脚本正式转入维护模式。
2. **本地离线 IP/ASN 标签库**：
   - 探索轻量静态离线数据库方案，在重命名阶段补充 `{isp}`、`{asn}` 变量，杜绝在线网络查询 API。
3. **Sub-Store 节点处理生态适配**：
   - 提供适用于 Sub-Store 的轻量适配模块，复用核心清洗、打标与重命名能力。

---

## 谱系与取代边界（v4 统一内核取代 3.x 单脚本线）

> **决策背景**：`next` 分支上的统一内核将取代 `main` 的单脚本构建流程（builder 模式），取代动作在正式发版时一次性完成。本节固化边界与命名口径。

### 能力边界：保留 / 砍掉 / 收敛

| 3.x 单脚本线 | v4 统一内核 | 处理方式 |
| :--- | :--- | :--- |
| `cli.js` / `server.js` | `src/targets/cli.js` / `server.js` | 保留能力，实现重写 |
| `worker.js` 与 esbuild 打包（`build:worker`） | 无对应产物 | **砍掉**：不再提供 Cloudflare Worker 部署产物 |
| 三产物构建 `build:full` / `build:pure` / `build:toolkit` | 单产物 `build` / `build:nodes` / `build:report` | **砍掉**：不再按产物分裂构建 |
| `scripts/inject-shared.cjs` 跨产物注入共享逻辑 | `src/` 分层单一事实源 | **收敛**：共享字段不再逐产物复制，脚本职责单一化 |
| `substore/` 适配脚本 | 待 Milestone 4 重写 | **资产保留**：能力在新内核上重建，不沿用旧注入产物 |

### 用户侧影响（发版说明中需显式交代）

1. **Cloudflare Worker 部署路径退场**：不再提供 Worker 产物，依赖该路径的用户需改用 CLI 或 server 宿主。
2. **入口文件位置变更**：根目录 `cli.js` / `server.js` 迁入 `src/targets/`，引用 `main` 分支原始文件路径的脚本与文档链接会失效。

### 发布命名谱系与版本代际共识

1. **单脚本时代 tag 冻结与 LTS 维护**：`v1.x`、`v2.0.0`–`v2.8.0`、`v3.0.0`–`v3.3.3`、`builder/`、`pure/`、`toolkit/` 历史 tag 永久保留作为追溯锚点。当 `next` 分支合并至 `main` 后，3.x 单脚本正式转入维护模式（仅限重大安全与缺陷修复，不再承载新架构特性）。
2. **统一内核确立为 4.x 代际**：为彻底避免与历史 `v2.x`/`v3.x` 标签撞车，并符合破坏性架构重构升级的语义化版本规范，新 7 层洋葱架构统一内核正式确立为 **v4.0.0** 代际（内部研发代号 `v2.0.0-alpha` 正式归档并升格为 `v4.0.0-alpha`）。
3. **版本单点真值（SSOT）**：`package.json`、`src/pipeline/config.js` (`pkgVersion`)、`src/pipeline/report.js` (`VERSION`) 与文档统一同步为 `4.0.0-alpha`；待 M3 拓扑 DSL 引擎与全链路验收完成合入 `main` 时，正式切为 `v4.0.0`。

---

## �📋 全量技术债务与代码坏味道治理跟踪表 (已全量归入里程碑)

### 1. 核心架构与功能性缺陷
| 缺陷项 | 归属模块 | 严重级别 | 现状与治理方向 | 目标里程碑 |
| :--- | :--- | :---: | :--- | :---: |
| `IO -> Core` 反向引用 (已修复) | `src/io/ssrf.js`, `parsers/index.js` | 🟡 中 | 依赖 Core 的基础工具函数，下沉公共基础模块 | M1 阶段 |
| customRules 分流优先级倒挂 (已修复) | `src/strategy/rules.js` | 🔴 高 | 文档声明最高但代码放在最后，自上而下首命中导致失效，需提至首位 | M1 阶段 |
| 策略组装配与元数据双硬编码耦合 | `src/strategy/topology.js` | 🔴 高 | 元数据与组装机制割裂，修改策略组逻辑需改多处，重构为声明式拓扑引擎 | M3 阶段 |
| SSRF TOCTOU 窗口 | `src/io/ssrf.js` | 🟡 中 | 校验与连接使用两次 DNS，评估 IP Pinning 成本 | M3 阶段 |

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
| 图标系统模型二义性与硬编码散落 | `src/strategy/presentation.js`, `catalog.js` | 设计坏味道 | `icon` 混用为国旗 Emoji、图片与 URL；骨架组硬编码在代码中无法配置 | M3 阶段 |

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

