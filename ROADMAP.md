# 🗺️ Mihomo-Toolkit 演进路线图 (ROADMAP)

本文档制定 Mihomo-Toolkit 的**真实版本发布里程碑、技术债务治理清单与功能演进路线**。  
全篇以**“稳定性先行、大动作排后、以代码实际运行为唯一事实来源”**为核心准则。

---

## 🧭 当前项目状态定级

- **当前版本**：`v4.0.0-alpha`（M1 与 M2 全量债务清零，研发代号由内部 2.0 正式升格为 4.0）
- **真实研发完成度**：**约 60% ~ 65%**
- **当前核心成果**：纯计算内核稳固、宿主健壮性与生产级加固全量闭环（平滑停机与后台预热双重排空、DNS 并发流控与 DoH 竞速/代理支持、CLI --dry-run 诊断模式、/healthz 缓存命中率与订阅健康度、版本代际时序原语 GenerationSource、565 个单元测试全绿）。
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

- [x] **声明式策略拓扑与装配解耦 (Declarative Topology Engine)**：
  - [x] 破除双硬编码与强耦合：服务元数据归 `catalog.js`，装配规则归拓扑引擎，解决“修改策略组逻辑需改两处甚至改源码”的痛点；
  - [x] 声明式自定义策略组：允许用户在 `config.yaml` 中通过 `customGroups` 自定义策略组（原生静态字段透传，配合 `match` 动态节点筛选配方与 `exclude` 黑名单）；
  - [x] 规则与图标联动：支持在组声明中关联 `rules` 与 `emoji`/`icon`，全自动挂载分流与展示层渲染。
- [x] **图标系统模型统一重构 (Icon Registry)**：
  - [x] 消除 `icon` 字段概念混淆（国旗 Emoji vs 本地图片 vs 远程 URL），建立统一的图标资产管理规范；
  - [x] 支持策略组骨架组图标自定义配置覆盖 (`groupIcons`)；
  - [x] 策略组与节点命名模式联动，支持完全去除 Emoji 的纯净模式 (`groupIconMode: 'none'`)。
- [x] **服务编目纯声明化与元数据全生命周期管理 (Catalog SSOT & Lifecycle)**：
  - [x] 消除魔术字符串与隐式契约：引入 `@download`、`@service`、`@self` 语义宏动态绑定大类聚合目标；
  - [x] 专项服务规则纯声明化：重构 Telegram 等专项规则为静态 `process` 字典与 `rules` 数组，杜绝命令式闭包；
  - [x] 聚合组与专项组全量属性投影：注册表输出 `aggregates` 与 `specialized` 全生命周期属性（含外观、分流规则、Providers、进程列表与拓扑配方），不再绕路读取底层常量；
  - [x] 游戏子规则集声明驱动按需激活与防幽灵组：`gameServices` 精准激活所需 Provider，未声明平台不下载不注入，自定义游戏安全归并聚合组，杜绝未定义策略组污染；
  - [x] 彻底清理向后兼容过渡垫片与遗留别名，全仓贯彻零历史包袱原则。
- [ ] **策略组双范式分层收敛（Phase B · 批次 1 已完成，批次 2-4 待推进）**：
  - 以统一 `groups` 声明清单（内置组逐条 `ref` 引用 + 自定义声明同列一表）替代全部 `enableX` 建组开关与 6 个服务清单字段；声明即激活、注释即关闭（开关只管分池与折叠，DSL 只管组）；
  - 彻底取消用户面「六维」组织概念（降级为引擎内部特征池标签与目录条目属性）；详见下方 **M3.B** 设计。
- [ ] **安全进阶防御**：
  - 探索网络抓取建连阶段的 IP 固定（IP Pinning）机制，阻断基于 DNS Rebinding 的 SSRF 窗口。

#### 🧩 M3.B 策略组双范式分层收敛设计（Phase B · 已定稿，待授权实施）

> **决策背景**：M3 引入声明式策略组 DSL 后，`proxy-groups` 的构成实际由**两条路径**汇入——A 类开关驱动的内置配方（`buildBuiltinAppRecipes`）与用户 DSL（`customGroups`）。前者是「全硬编码时代」为开放有限可调项而设计的产物，但其语义（组的存废与成员）已被 DSL 覆盖，形成第二真相源；而 DSL 语义上无法表达「节点分池」与「地区折叠」。本方案把二者按关注点分层，最终形态为**统一 `groups` 清单：声明即激活，关闭靠 `disabled`**。

**零、设计不变量（判断任何具体提案是否跑偏，只需读这 6 条）**

1. **单一声明入口**：用户面有且只有 `groups` 决定「有哪些组」；不存在「某个开关决定某个组存不存在」的第二条路径。
2. **`ref` 与手写声明同构**：`ref` 引用的东西，和用户自己写的一条组声明**结构完全一致**。`ref` 不引入任何独有概念（尤其不得引入「产物束」），用户只需学一套规则。
3. **无「配了不生效」**：任何配置项与其生效产物一一对应，看一眼即可预测结果；禁止存在「A 配了，还得看 B 才知道 A 生不生效」的耦合。**这是本次收敛的根本动机。**
4. **每层内单一真相源，跨层各管各的关注点**：定义层回答「有什么」，声明层回答「要哪些」，二者分属不同层，不构成第二真相源。
5. **开关只管分池与折叠**：开关允许改变「节点怎么分池、地区怎么折叠」，但不得决定「有哪些组」。
6. **失败姿态统一且可定位**：未知字段 / 未知宏 / 未知 `ref` 键一律 fail-closed，并报出**配置字段路径**。

**一、三层分工契约（目标终态）**

| 层 | 职责 | 载体 | 单一真相源 |
| :--- | :--- | :--- | :--- |
| **代码层（定义）** | 内置组目录：逐组一条**完整组声明**（名称 / 类型 / 成员配方 / 图标 / 规则 / 池归属） | 升级现有 `src/data/catalog` 条目（**不新建平行目录**） | 组「定义」 |
| **配置层（声明）** | 要哪些组：内置引用与自定义声明同列一张清单 | `groups` | 组「声明」 |
| **分池层** | 节点进入哪个桶、是否从主力池剔除 | 配置开关 | 分池规则 |
| **折叠层** | 地区组是否生成、以何种类型生成 | 配置开关 | 折叠规则 |
| **流水线层** | 清洗、重命名、内核、DNS 等与组无关的行为 | 配置开关 | 流水线行为 |

> **目录不得复制**：`ref` 必须指向 catalog 的**现有条目**，只为其补齐缺失字段（如 `rules`）。在本该消灭第二真相源的任务里再造一份平行目录，是直接违反不变量 4。

**二、`groups` 清单形态（目标终态）**

```yaml
groups:
  - { ref: chatgpt }                  # 引用目录里的条目：列了即激活
  - { ref: gemini }
  - { ref: claude, disabled: true }   # 显式关闭（跨 include 时必需，见下）
  - name: 我的专属线路                  # 目录之外的自定义组，字段与目录条目同构
    match: { region: ['hk', 'jp'] }
    proxies: ['@matchedNodes', 'DIRECT']
```

| 条目形态 | 语义 |
| :--- | :--- |
| `{ ref: <键> }` | 引用目录里的**单条完整组声明**，原样插入（含其 `rules` → 自动生成 RULE-SET 与规则集 Provider），并允许**条目内覆写任意字段** |
| 完整声明 | 目录之外的组，字段与目录条目**完全同构**（`name` / `type` / `match` / `exclude` / `proxies` / `rules` / `icon` / …） |

**关于「一束产物」的澄清（重要）**：不需要发明「`ref` 输出组 + 规则 + Provider」这类概念。目录条目本身就是一条带 `rules` 的普通组声明，而 `rules` → `RULE-SET` + 规则集 Provider 的通道**现已存在**（[rules.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/rules.js#L195-L221)）。复用即可，符合不变量 2。

**关于 `disabled` 字段（为什么必须有）**：`include` 的数组语义是**并集去重**（[include.js](file:///e:/CODE/mihomo-toolkit-next/src/config/include.js#L66-L76)），片段的条目会被并集加回，因此「注释掉即关闭」**只在单文件内成立**。要跨片段关闭，必须有一个显式表达。优雅解是加一个 `disabled: true` 字段，而不是去改 `include` 的通用数组语义（那是更大的补丁）。

**激活单元 = 单个组**（`ref: chatgpt`），而非分类批次（`ref: ai`）。批次粒度会让「分类」概念从后门复活。

**三、A 类开关与清单字段的消亡对照表（全部删除，无一新增）**

| 现字段 | 现语义 | 是否改变分池 | 处置 | 新写法 |
| :--- | :--- | :---: | :--- | :--- |
| `enableAI` | AI 助手独立分流（批次，一次生成 4 组） | 否 | **删除** | `groups` 逐条列出 `ref: chatgpt` / `ref: gemini` / … |
| `enableStreaming` | 流媒体服务分流 | 否 | **删除** | `groups` 逐条列出对应 `ref` |
| `enableSocial` | 海外社交分流 | 否 | **删除** | 同上（合并语义下沉为目录条目属性） |
| `enableGame` | 游戏平台分流 | 否 | **删除** | 同上 |
| `enableSystemServices` | 系统服务分流 | 否 | **删除** | 同上 |
| `enableTelegram` | Telegram 独立分流 | 否 | **删除** | `groups` 列出 `ref: telegram` |
| `enableAdBlock` / `enableAntiAD` | 广告拦截组 | 否 | **删除** | `groups` 列出对应 `ref`（其规则与 Provider 随条目一起交付） |
| `enableCrypto` / `enablePayPal` / `enableWebRTC` | 专项分流组 | 否 | **删除** | `groups` 列出对应 `ref` |
| `enableDomesticGroup` | 中国分流组 | 否 | **删除** | `groups` 列出 `ref: domestic` |
| `enableGitHub` / `enableScholar` | 仅具备「关闭」语义的畸形开关 | 否 | **删除** | `groups` 列出对应 `ref` |
| `aiServices` / `streamingServices` / `socialServices` / `gameServices` / `systemServices` / `devServices` | 内置组条目清单 | 否 | **全部删除** | 无需字段：要哪个服务就列哪条 `ref` |
| `independentSocial` | 独立成组的社交应用 | 否 | **删除** | 下沉为目录条目属性（该服务是否独立成组） |
| `aiPreferredRegions` / `residentialNodeGroups` | 内置组成员编排参数 | 否 | **删除** | 下沉为目录条目的**默认值**；用户要改就在该条 `ref` 内覆写（可调能力不丢失） |
| `customServices` | 行内自定义服务字典（按六维分类填写） | 否 | **删除** | 等价于 `groups` 中的一条完整自定义声明 |
| `enableResidential` | 家宽节点分流 + **出主力池** | **是** | **保留（分池面）** | 建组面由 `groups` 列出 `ref: residential` 表达 |

**四、六维概念处置（最终结论：用户面彻底消失）**

现状：`catalog` 的「六维内置服务（AI / 流媒体 / 社交 / 游戏 / 开发学术 / 系统服务）」同时承担三种角色，其中第一种已外溢到用户面：

| 角色 | 现状表现 | 处置 |
| :--- | :--- | :--- |
| **用户面分类** | `customServices` 要求按维填写；`aiServices` 等按维拆成 6 个独立字段；文档要求用户理解「六大分类」 | **彻底取消**：上述字段全部消亡，用户面不再出现「维 / 批次 / 分类」任何组织概念 |
| **引擎内部特征池** | `buckets.ai` / `buckets.streaming` … 决定节点进入哪个桶 | **保留但内部化**：池名降级为引擎实现细节，由目录条目自带属性承载 |
| **内置组组织方式** | 六维服务字典按维组织内置组 | **由目录接管**：目录为扁平「组清单」（逐组一条），不再用「维」组织 |

**结论**：「维」不是能力，只是代码组织方式外溢到配置面的副产品。用户只需认识 `ref` 键名与自定义组字段。

**五、必须保留的 C 类开关及理由**

| 字段 | 保留理由（DSL 表达不了，符合不变量 5） |
| :--- | :--- |
| `coreRegions` | DSL 是「在已有拓扑上叠加组」，无法表达「我只要这几组、别自动建地区组」 |
| `minorNodeThreshold` | 决定小地区节点是否并入「其他节点」，属折叠规则而非组成员 |
| `regionGroupType` / `enableRegionHashLB` | 决定地区组的原生类型，属折叠规则 |
| `isolateHighMulti` / `isolateDownload` / `isolateExperimental` / `highMultiThreshold` | 决定节点入桶与是否从主力池剔除，纯分池语义 |
| `enableResidential`（分池面） | 家宽节点出主力池的行为，DSL 无法表达 |

> **配套安全要求**：分池开关把节点移出主力池后（如 `isolateHighMulti`、`enableResidential`），必须保证用户仍有组承接这些节点，不得出现「节点被剔除后无处可去」。

**六、宏的终态定位修正 + Phase A 补修**

- **定位修正**：`@residential` / `@domesticGroup` / `@nonCnRegions` / `@activeRegions` 保留，但文档需明确其定位为**跨层桥**（引用分池层产物或目录条目），而非「硬编码开关的副产品」。宏语义不再随开关增减而漂移。
- **Phase A 补修（回退一处先前判断）**：未知宏的处置应由「运行期告警并跳过」改为**校验期 fail-closed 并报出字段路径**——项目在 CONFIGURATION.md 已宣称「严格阻断」，运行期告警属「配了等于没配」的软失败，违反不变量 6。实现方式：在配置校验阶段用宏白名单（单一真相源）比对 `@xxx`；引擎内部配方走另一条路径，不受影响。

**七、验收标准**

1. 删净 A 类开关与全部清单字段后，默认 `groups` 清单产出的 `proxy-groups`、路由规则与规则集 Provider，与今日默认配置**逐字节等价**（建立回归基线快照作为守卫）。
2. 用户面只有 `groups` 一个声明入口；不引入任何组织性概念。
3. 不变量 2 有测试守卫：`{ ref: X }` 的展开结果与「把目录里那条声明原样手写进来」结果**完全一致**。
4. `groups` 的 `ref` 键必须与目录条目一一对应，键不存在时 **fail-closed 抛错**并报字段路径。
5. 未知配置字段、未知宏同样 fail-closed 报字段路径；不存在任何「配了不生效」的字段（不变量 3 有测试守卫）。
6. 配置校验与拓扑引擎的 type 校验路径**收敛为同一条**，删除引擎内「非法 type 静默降级 select」的兼容分支。
7. `CONFIGURATION.md` 中「配置开关 ↔ 内置组」对应表删除，改为「内置组目录 + `groups` 清单」说明。

**八、实施顺序（分批，每批独立可验收）**

1. ✅ **批次 1（试点 · AI 类别）已完成**：`groups` + `{ ref }` + `rules` 全链路贯通，不变量 2 / 3 / 6 均已有测试守卫（详见下方「批次 1 落地记录」）。
2. ✅ **批次 2 已完成**（流媒体 / 开发学术 / 系统服务 / 专项服务）：按同构方式迁移，逐个补齐 catalog 条目的 `match` / `proxies` / `type`；`specialized` 条目（telegram 等）一并解决 `process` 进程名单随组交付（详见下方「批次 2 落地记录」）。
   2b. ✅ **批次 2b 已完成**（聚合语义与广告拦截组迁移）：`game` 两个聚合组、`social` 合并组、`ads` 双开关共享组名三类一并下沉到目录条目（详见下方「批次 2b 落地记录」）。
3. ⏸ **批次 3（待决 · 不得启动）**：删除全部 A 类开关与 6 个清单字段，`customGroups` 更名为 `groups`，同步 [rules.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/rules.js#L196-L198) 的读取处；同时把 `groups` 归一化结果直接落在 `groups` 字段（拆掉当下并入 `customGroups` 的过渡合流），并把分类打标门禁从「开关或 ref」简化为「有 ref 即打标」。**本批会改写用户配置，属于用户面不可逆迁移**——启动前置条件是「十、待决」中的模型选定并落地，未选定前不实施。
4. ⏸ 批次 4（随批次 3 待决）：文档与类型声明对齐 + 迁移对照表随发版说明给出。

**八之二、批次 1 落地记录（含自主决策与残差）**

| 项 | 结论 |
| :--- | :--- |
| 目录落地位置 | 实际写入 `src/config/catalog.js`（ROADMAP 此前文字写作 `src/data/catalog`；服务字典真实所在即此处），**不新建平行目录**，仅为其投影出 `registries.groups` 扁平目录 |
| `ref` 可引用条件 | 条目自身必须是「完整组声明」（`match` + `proxies` 齐备），否则不入目录 → 引用即 fail-closed，杜绝空壳组。当前仅 AI 大类（`chatgpt`/`gemini`/`claude`/`copilot`）达标 |
| 宏单一真相源 | 新增 [macros.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/macros.js)：别名 → 求值器同表登记，引擎求值与校验器白名单共用，**同时落地第七节 Phase A 补修**（未知宏改为校验期 fail-closed 并报字段路径） |
| 新增组声明字段 | `providers`（规则集 Provider 映射）与 `preferredRegions`（`@preferredRegions` 宏展开源）。二者是「`ref` ≡ 手写声明」同构性的必要条件 |
| AI 成员配方表达 | 内置配方由 `buckets[tag]` 捷径改为目录条目的 `match: { pool: <键> }` + `proxies` 模板；`@preferredRegions` 承接原 `aiPreferredRegions` 覆写口径 |
| 过渡合流 | `groups` 归一化结果暂并入 `customGroups`（引擎/规则/展示层当下的唯一内部入口），批次 3 拆除 |
| 默认输出影响 | **零改动**：`groups` 不设默认值，A 类开关与内置配方仍驱动默认输出；因此今日默认产物可作为批次 3 的回归基线快照 |
| 已知残差 1 | 规则注入位置：`groups` 路径走 customGroups 段（早于广告拦截 / AI 段），开关路径在其后 → 现以「规则集合等价」而非顺序敏感比较守卫，批次 3 收敛后收紧 |
| 已知残差 2 | 成员的 `match: { pool }` 与旧 `buckets[tag]` 在「节点级 `customGroups` 标注节点」这一边界上存在理论差异（此类节点不再被排除）；默认配置与现有测试未见实际分歧 |

**八之三、批次 2 落地记录（含自主决策与残差）**

| 项 | 结论 |
| :--- | :--- |
| 可引用判据修正 | 由批次 1 的「`match` **且** `proxies` 齐备」修正为「条目自带**非空 `proxies`**」。`match` 降为可选字段——它只负责说明 `@matchedNodes` 从哪个特征池取节点，并非「组能否独立成立」的判据。成员完全由 `proxies` 列清（如 bahamut / bilibili / google / apple / microsoft / github 的地区组清单）的条目同样是一条完整、可独立成立的声明，无需为过闸而硬塞一个用不上的 `match`（那才是「配了不生效」）。判据落在 [catalog.js](file:///e:/CODE/mihomo-toolkit-next/src/config/catalog.js) 的 `ServiceCatalog#isRefableGroup` 与 `toRegistries()` 的目录投影条件，两处共用同一条件。 |
| 迁移范围 | 流媒体 9 条（`youtube`/`netflix`/`disney`/`tiktok`/`spotify`/`bahamut`/`pixiv`/`twitch`/`bilibili`）、开发学术 2 条（`github`/`scholar`）、系统 3 条（`google`/`apple`/`microsoft`）、专项 4 条（`crypto`/`paypal`/`webrtc`/`telegram`）。专项条目此前被目录投影整体排除（`cat === 'specialized'` 直接跳过），本次纳入目录。 |
| 成员配方承接方式 | 原内置配方里的 `buckets[pool]` 桶注入改为条目自带 `match: { pool: <键> }` + `proxies` 中的 `@matchedNodes` 承接；地区/标准选项仍由 `@preferredRegions` / `@standardOptions` 等宏承接。`buildBuiltinAppRecipes` 各分支随之退化为「按开关挑条目 → 原样透传 `match`/`exclude`/`proxies`/`preferredRegions`」，两条路径共用同一份定义（不再是「目录一份、内置一份」）。 |
| `process` 随组交付 | 专项的进程名单此前只在内置分支展开，`ref` 后 `PROCESS-NAME` 规则会静默丢失。本次在 [rules.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/rules.js) 的 `customGroups` 段新增 `process` 展开（复用 `expandProcessRules`），目录投影随组携带 `process`，校验器 [matcher.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/matcher.js) 白名单扩容 `process` 并做结构 fail-closed（未知平台键 / 非 string[] 一律报字段路径）。 |
| 专项 `@preferredRegions` 展开 | 删掉内置分支里手工预展开（`spec.preferredRegions` + `flatMap`），改由拓扑引擎按条目 `preferredRegions` 统一展开 —— 与 `ref` 路径共用同一实现，杜绝两条展开口径漂移。 |
| 默认输出影响 | **非零漂移（属修正）**：`tiktok` 的声明里本就写着 `@matchedNodes`，但内置分支此前未把 `match` 传给引擎，该宏恒展开为空 → 只有 `@nonCnRegions` 起作用；`match` 补齐后声明按其字面意图生效。同理，流媒体未显式声明 `proxies` 的条目（`youtube`/`netflix`/`disney`/`spotify`/`pixiv`/`twitch`）现由 `@matchedNodes` 承接特征池成员（此前由内置分支用 `buckets[pool]` 注入，等价）。仅节点名命中服务正则时才会实际多出成员，现有 590 条测试全绿。批次 3 的回归基线快照须在批次 2 之后重新采集。 |
| 验证 | `npm test` 590 pass / 0 fail（新增 4 条测试：可引用判据、`process` 结构 fail-closed、四类「ref ≡ 内置开关」逐字段等价、`process` 随组交付）；`npm run lint` 零警告；`npm run verify:arch` 零环路零违规；`npm run verify:docs` 通过。 |
| 残差 2a | `webrtc` 的回国模式成员编排（`enableDomesticGroup && !proxyFirst` 时改写为 `DIRECT` 优先）仍只在内置分支生效、未随目录交付 → 该组合下 `ref: webrtc` 与内置配方不等价（等价性测试亦避开了该组合）。批次 3 随 `enableDomesticGroup` 一并收敛。 |
| 残差 2b | **聚合语义未迁移**：`game` 的「游戏服务 / 游戏下载」是「成员服务各带规则、目标指向聚合组」的结构，`social` 的「社交平台」是「非独立服务合并为一组」的合并语义，`ads` 则是两个规则级开关共享同一组名。三者都要求「成员清单 / 合并策略」下沉到目录条目，属批次 2b（列在实施顺序第 2b 项）。 |
| 残差 2c | 因此 `facebook` / `steam` 等聚合成员条目暂无 `proxies`，当下不可 `ref`。**批次 2b 决策：成员不为其备 `proxies`（保持不可独立引用）**，改为由所属聚合条目统一承载成员规则与 Provider，并将成员键的报错升级为「应改引哪个聚合组」的指引（详见「批次 2b 落地记录」）。 |

**八之四、批次 2b 落地记录（含自主决策与残差）**

| 项 | 结论 |
| :--- | :--- |
| 聚合条目入目录 | `registries.groups` 新增 `game-service` / `game-download` / `social-platform` 三个聚合键。聚合条目与分类条目**完全同构**——都是「自带非空 `proxies` 的组声明」，区别只在它的 `rules`/`providers` 是**成员规则的合并结果**；`rules` 经既有 `rules → RULE-SET + 规则集 Provider` 通道生成（**不引入「产物束」这类新概念**，保持不变量 2），从而杜绝「ref 聚合组只给组不给成员规则」的断裂规则。 |
| 成员清单 / 合并策略下沉 | 聚合条目在**定义层**声明成员：`game` 未显式声明（默认 = 该分类全量服务，不自建第二份清单，避免与 `BUILTIN_SERVICES` 漂移）；`social.combined` 显式声明 `members: ['facebook','instagram','discord']`（`twitter` 独立成组、`meta` 是 facebook 规则集的别名条目不随合并组默认激活，故均不在其中）。规则归属算法：成员规则按「已解析目标组名」归属；**自路由规则**（目标 = 成员自身组名，如 social 条目的 `rules: 'facebook'`）在聚合语义下改指聚合组名；成员被多个聚合组声明时归属**分类默认聚合组**（game 的 `@service` → `游戏服务`），避免同一条规则被改写成多个目标。`providers` 由成员规则里出现的 `RULE-SET` 名经「分类级 Provider 名 → 路径」映射解析，与内置开关路径同一口径。**（该成员推断/仲裁机制已于同批后续删除，见「机制简化」条。）** |
| 伪宏退役 | `@buckets.game`（未登记宏、仅由内置分支手工替换）退役：game 两个聚合组改为 `match: { pool: 'game' }` + `proxies` 中的 `@matchedNodes`，与其它类别同构；[topology.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/topology.js) 的游戏分支退化为「按分类挑聚合条目 → 原样透传」。 |
| 广告拦截模型 | **拆为两条目**：`ad-block`（← `enableAdBlock`，默认开）与 `anti-ad`（← `enableAntiAD`，默认关），二者声明**同一个组名**「广告拦截」（同名后者胜语义合并为一个组），但规则来源与默认开关各自独立、可逐项等价。**未采用「单条目多 Provider/Rule」**：单条目会把 `anti-ad` 规则一并强推为默认生效，破坏「默认输出逐字节等价」验收标准。内置拓扑分支与规则段改为读目录条目，不再各写一份字面量。 |
| 成员不可单独引用（决策） | 聚合成员（`steam`/`epic`/`facebook`…）**不为其备 `proxies`**、不单独成组。理由：成员的规则目标指向聚合组，单独成组只会得到「无人路由的空转组」；若改成自路由规则，则会与聚合组规则就同一流量互相遮蔽（命中取决于声明顺序），两种结果都不直观。引用成员键仍 **fail-closed**，但报错升级为**指引**：`「steam」是聚合组「游戏服务」的成员条目，不单独成组，请改为 { ref: game-service }`（映射由 `buildMemberHints()` 给出，判据是「该条目的规则目标落在哪个聚合组」，不再依赖分类推断）。这正是 ROADMAP 早先并列的「引用期一致性校验 fail-closed」分支。 |
| 社交合并语义 | 合并组的组名与成员配方改由聚合条目单一给出。此前内置分支按「非独立成员数量」动态决定组名（1 个时用该成员名、多个时用「社交平台」），规则段的目标名同步解耦为聚合组名 —— 两条路径在任何成员数下都一致；唯一漂移是「恰好 1 个非独立成员」的旧动态命名，而该组合只能通过批次 3 将删除的 `socialServices` / `independentSocial` 触达。 |
| 展示层 | [presentation.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/presentation.js) 的分类遍历新增跳过 `groups`：目录条目与分类/聚合/专项投影同源，展示信息已由各自投影给出；「广告拦截」的 🚫 与图标仍由骨架组基线 `SKELETON_GROUPS` 提供，行为不变。 |
| 默认输出影响 | **零漂移**：`groups` 仍不设默认值，A 类开关继续驱动默认输出。2b 落地当时以「HEAD 与工作区逐字节对比」人工抽查确认（14 组配置组合，11 组完全一致，3 组为已披露的单成员社交命名变化）；**全量产物基线守卫于 2b 之后补入**（`test/pipeline/default-output-golden.test.js`，见第十节验收标准）。 |
| 验证 | `npm test` 591 pass / 0 fail（新增「游戏聚合 / 社交合并 / 广告拦截」三场景的 `ref` ≡ 内置开关等价性：策略组清单逐字段、规则集合、`rule-providers` 对象三者皆等价；并扩展目录投影断言与成员键 fail-closed 指引断言）；`npm run lint` 零警告；`npm run verify:arch` 零环路零违规；`npm run verify:docs` 通过。 |
| 残差 2b-1 | 规则注入位置差异（批次 1 残差 1）依旧存在，等价性仍以「集合等价」而非顺序敏感比较守卫，批次 3 收敛后收紧。 |
| 残差 2b-2 | 内置聚合条目的规则派生自**内置成员**；用户经 `customServices` 新增的游戏/社交服务仍走内置 `assembleServiceCategory`（含 `onService` 伴生 Provider 注入），故 `ref` 路径不含用户新增成员。该字段随批次 3 删除，无需迁移。 |
| 残差 2b-3 | 成员条目（`steam`/`facebook`…）在批次 3 将成为「无 `ref` 可达」的条目——它们只作为聚合条目的成员清单被引用，用户无法把它们拆成独立组（同上决策）。若后续确有此需求，须先给出「自路由 vs 聚合」的规则遮蔽语义，再谈放开。 |
| **机制简化（同批后续）** | **取消聚合成员机制**：删除 `members`、`declareCount`、`defaultAggregate` 多聚合仲裁，以及 `getGroupMemberHints()` 的分类推断；归属改由**服务条目自身的规则目标**决定（social 声明 `target: '@combined'`），聚合条目只收集「目标指向自己」的规则。收益：新增聚合成员 = 加一条 `target`（数据）；新增聚合组 = 加一条定义 + 把目标指过去（数据）——都不改代码。同时 BT/下载规则抽为数据表（`BT_TRACKER_RULES` / `DOWNLOAD_RULESETS`），新增下载规则集只加一行。默认产物零漂移（golden 守卫），新增 4 条回归测试。 |
| **进一步简化：取消社交合并组** | 按「聚合机制先简化」原则**删除「社交平台」合并组**：社交服务一服务一组（与 AI / 流媒体同构），每个社交服务自带 `proxies`、规则目标即自身组名，可单独 `ref`、单独排序；同时删除 `independentSocial` 字段，以及 `meta` 条目（facebook 规则集别名，与 facebook 同源会制造重叠规则）。`customServices.social` 新增服务默认自成一组；若确实需要合并，需显式把规则目标指过去——该「合并表达」留给两表模型的 `routing`。收益：社交不存在第二套合并机制，「独立/合并」的二分与相关仲裁全部消失。默认产物零漂移（`default` 场景不含社交），社交场景 golden 更新为 4 组逐服务规则。 |

**九、已定稿的决策（仅覆盖批次 1 / 2 / 2b 已落地部分；批次 3 的模型选择尚未定稿，见第十节）**

1. **目录位置**：不新建 `src/data/baseline-groups.js`，改为**升级现有 `src/data/catalog` 条目**为完整组声明（补齐 `rules` 等缺失字段），避免平行目录。
2. **引用书写形态**：统一为对象 `{ ref: chatgpt }`。不接受裸字符串简写（否则 `groups` 出现两种元素类型，校验与报错分支翻倍）。
3. **默认清单策略**：`DEFAULT_CONFIG.groups` 将在**批次 3** 给出全量引用（等价于今日全部 `enableX` 默认为 `true` 的效果）；批次 1-2 期间 `groups` 不设默认值，以保证默认输出零漂移、可作批次 3 的回归基线。（该策略随批次 3 一并未定稿：若改为两表模型，默认值由 `groups` 与 `routing` 共同给出。）
4. **同名覆盖**：同一内置组既被 `ref` 引用又被完整声明覆盖时，沿用现有「同名后者胜」语义。
5. **迁移披露**：允许破坏性变更；发版说明需给出「旧开关 → 新写法」完整对照。

> **已消解项**：
> - 原「`activeGroups` 激活清单」→ 被统一 `groups` 取代，字段不存在。
> - 原「清单类字段是否保留」→ 6 个清单字段全部消亡。
> - 原「激活粒度 = 批次」→ 否决，采用逐组引用。
> - **原「是否需要 `enabled: false`」→ 判断更正：需要，以 `disabled: true` 回归**（原因见第二节 include 并集语义）。

**十、待决：组声明与分流的边界（批次 3 的前置阻塞）**

> **状态：未拍板，不得据此实施批次 3。** 本节只记录「已验证的事实」「已确认的缺陷」与「尚待回答的产品问题」；结论出来后再并入第九节。

**背景（为什么会走到这一步）**：六维分类诞生于硬编码时期——当时「一次关掉一整批」只能靠分类开关实现，因此分类同时承担了「用户组织方式」与「批量激活能力」两个角色。目录解耦之后，分类作为**用户面必填结构**应当消失（这一步是对的），但「批量关闭」是真实需求，必须在新模型里有位置，不能随分类一起删掉。判据不是「字段多不多」，而是：**新增一个服务/类别，是只加数据，还是又得加一段特判。**

**两个候选模型**：

| 维度 | 甲：单表 `groups`（现路线） | 乙：`groups` + `routing` 两表 |
| :--- | :--- | :--- |
| 声明内容 | 组结构 + 该组的规则（引用即带出规则） | `groups` 只回答「有哪些组」；`routing` 只回答「哪条规则指向哪个组」 |
| 顺序语义 | 清单顺序隐式决定规则优先级（实测：声明规则注入在分类规则之前，先到先得；调换清单顺序会改变命中目标） | `routing` 顺序即优先级，显式且可测 |
| 覆写 `name` | 规则里写死的目标名失配（见缺陷 P1） | 目标按引用解析，改名安全 |
| 批量关闭 | 逐条 `disabled`，或依赖目录条目 | `routing` 用 `preset` 表达「整批」，能力保留 |
| 聚合语义 | 归属已改为「规则目标驱动」（无成员清单/仲裁）；但规则仍须在目录内**派生**并随组交付 | 成员规则就是若干条 `routing` 记录，目录无需派生任何规则 |
| 主要代价 | 用户要理解「引用一个组会连带出规则」；改名/顺序是隐式陷阱 | 多一个顶层字段；默认值需内置到两处 |

**无论选哪个模型都必须满足的验收标准**：

1. **默认产物全量基线**：`test/pipeline/default-output-golden.test.js`（固定节点样本 → `proxies` / `proxy-groups` / `rules` / `rule-providers` / `dns` / `tun` / `sniffer` 逐字段比对，规则数组顺序参与比较）。基线更新只能通过 `node scripts/gen-default-output-golden.js` 显式进行，并在提交信息中说明「默认产物为什么变」。
2. **顺序语义显式且可测**：要么由 `routing` 顺序承载，要么在文档中钉死「清单顺序即优先级」并加回归测试。
3. **改名不断链**：`{ ref: X, name: Y }` 之后规则目标必须随动，或在配置期 fail-closed 拒绝。
4. **批量关闭能力保留**：一行关闭一整批。
5. **组合场景回归**：默认 / 停用单项 / 覆盖同名组 / include 片段 / 空节点池。
6. **结构性配置逐项核对**：`coreRegions` / `minorNodeThreshold` / `regionGroupType` / `enableRegionHashLB` 是否只影响分池与折叠——需逐项确认它们是否还影响组生成、路由目标或宏展开，不能统称「只影响分池」。

**已确认的缺陷（与模型选型无关，先修）**：

| 编号 | 问题 | 证据 | 建议修法 |
| :--- | :--- | :--- | :--- |
| P1 | `ref` 覆写 `name` 后规则目标不随动 | 文档示例 `{ ref: copilot, name: 我的 Copilot 线路 }` 产出两个组、规则仍指向旧名；开关关闭时规则指向不存在的组。根因：[rules.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/rules.js#L227-L228) 对三段式规则原样透传，仅两段式会重写目标 | 目录条目 `rules` 一律不写死目标（两段式），或声明期重写目标并 fail-closed 校验 |
| P2 | 成员键报错指引对 `meta` 错误 | ~~`ref: meta` 提示改引 `social-platform`，但该聚合组只含 facebook / instagram / discord，不含 meta 规则~~ | ✅ 已修复：指引改由**规则目标**派生（`buildMemberHints`），meta 的目标是自身组名 Meta，不再被错误指引 |
| P3 | 广告开关仍为硬编码 | [topology.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/topology.js#L246) 写死 `enableAdBlock \|\| enableAntiAD`，而 [rules.js](file:///e:/CODE/mihomo-toolkit-next/src/strategy/rules.js#L254) 已按 `ADS_GROUPS` 数据驱动 | 新增第三条规则源时只需加数据，不再改代码 |
| P4 | 成员提示表二次投影 | ~~`getGroupMemberHints()` 内部重跑 `toRegistries()`~~ | ✅ 已修复：改为 `buildMemberHints(merged.registries)`，复用已构建的注册表 |

**待拍板的产品问题（按顺序回答，前一个决定后一个）**：

1. 用户是否愿意为升级重写配置（`enableX` → `ref` 清单）？
2. 「一行关掉一整批」是保留为一等公民（`preset`），还是接受逐条 `disabled`？
3. `customServices` 随六维一起删除，还是改为扁平的服务定义区？
4. 游戏 / 社交的聚合语义，是继续由目录仲裁，还是交给 `routing` 表达？
5. include 并集语义下，「移除一个片段里启用的 ref」用什么表达（`disabled: true` 是否足够）？

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
| 策略组装配与元数据双硬编码耦合 (已修复) | `src/strategy/topology.js` | 🔴 高 | 引入声明式 DSL 配方与拓扑引擎，破除双硬编码与业务强耦合 | M3 阶段 |
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

