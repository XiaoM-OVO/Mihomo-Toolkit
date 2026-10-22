# 🗺️ Mihomo-Toolkit 演进路线图 (ROADMAP)

本文档制定 Mihomo-Toolkit 的**真实版本发布里程碑、技术债务治理清单与功能演进路线**。  
全篇以**“稳定性先行、大动作排后、以代码实际运行为唯一事实来源”**为核心准则。

---

## 🧭 当前项目状态定级

- **当前版本**：`v4.0.0-alpha`（M1 与 M2 全量债务清零，研发代号由内部 2.0 正式升格为 4.0）
- **真实研发完成度**：**约 60% ~ 65%**
- **当前核心成果**：纯计算内核稳固、宿主健壮性与生产级加固全量闭环（平滑停机与后台预热双重排空、DNS 并发流控与 DoH 竞速/代理支持、CLI --dry-run 诊断模式、/healthz 缓存命中率与订阅健康度、版本代际时序原语 GenerationSource、直连建连期 IP Pinning、678 个单元测试全绿）。
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
│ 🔵 Milestone 3: 声明式策略拓扑与配置解耦 (已完成 ✅)        │
│ • 打破双硬编码：解耦 SSOT 元数据与 topology 组装机制         │
│ • 声明式策略组：groups 声明即激活（ref + 自定义同表）       │
│ • 资产规范化：统一 IconRegistry，解决 Emoji 与图标二义性     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 🟣 Milestone 4: v4.0-GA 正式发布与合流 (未来展望)           │
│ • 合并至 main 分支，发布 v4.0.0 正式版，3.x 大脚本转入维护  │
│ • 发布验证：默认产物基线、CLI/HTTP 回归与迁移说明           │
│ • 已否决：离线 IP/ASN 标签库、Sub-Store 原生适配（不排期）  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📅 里程碑详细规划

### 🟢 Milestone 1: v2.0-Alpha 稳定性加固与核心债务清零（已闭环）
> **阶段目标**：清理核心逻辑缺陷、协议解析边界问题与架构坏味道。

- ✅ **闭环结论**：分流优先级倒挂、SSRF 白名单绕过、`IO -> Core` 反向依赖、三类协议解析器边界、原地突变与死代码清理全部收敛。
- 🔒 **仍生效的约束**：清洗 / 优化阶段禁止原地改节点；地区事实源单一；凭证脱敏必须覆盖全部协议。

### 🟡 Milestone 2: v2.0-Beta 宿主健壮性与生产级加固（已闭环）
> **阶段目标**：加固 HTTP Server 与 CLI 的生产可用性，增强运行期容灾与排障体验。

- ✅ **闭环结论**：Graceful Shutdown（连接全关 ∧ 任务排空）、DNS 并发上限 16、DoH 代理与双路竞速、`--dry-run` / `--validate`、`/healthz` 扩展、include 去 cwd 依赖、缓存代际原语 `src/io/generation.js`。
- 🔒 **仍生效的约束**：停机必须等排空 + 连接全关；诊断模式绝不写盘且失败关闭；代际超限抛错、不回绕。

> 逐条验收项与实现细节见 [M1 / M2 完成记录](docs/history/milestones-v2-alpha-beta.md)。

---

### 🔵 Milestone 3: 声明式策略拓扑与配置解耦 (大动作核心 · 已闭环 ✅)
> **阶段目标**：破除元数据与装配机制双硬编码耦合，实现数据驱动的声明式拓扑引擎。

- ✅ **已完成**：声明式拓扑引擎、图标模型统一、服务编目纯声明化、策略组双范式收敛（Phase B 批次 1–4）。
  早期实现中的 `customGroups`、组内 `rules`、服务清单字段等写法已被 10.12 收口取代，逐条明细见 [M3 前期完成记录](docs/history/m3-early-completions.md)。

- ✅ **安全进阶防御（已完成）**：
  - 直连抓取在建连阶段固定已校验 IP（`src/io/pinned-agent.js` 的 `connect.lookup`），消除请求前校验与建连解析之间的 DNS Rebinding (TOCTOU) 窗口。代理模式因解析发生在代理侧，本机无法固定 IP，残余风险保留并需由代理侧 ACL 兜底（见 `src/io/ssrf.js` 文件头）。

#### 🧩 M3.B 策略组双范式分层收敛设计（Phase B · 已实施）

> **决策背景**：M3 引入声明式策略组 DSL 后，`proxy-groups` 的构成实际由**两条路径**汇入——A 类开关驱动的内置配方（`buildBuiltinAppRecipes`）与用户 DSL（现 `groups`，设计当时称 `customGroups`）。前者是「全硬编码时代」为开放有限可调项而设计的产物，但其语义（组的存废与成员）已被 DSL 覆盖，形成第二真相源；而 DSL 语义上无法表达「节点分池」与「地区折叠」。本方案把二者按关注点分层，最终形态为**统一 `groups` 清单：声明即激活，关闭靠 `disabled`**。

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

> **目录不得复制**：`ref` 必须指向 catalog 的**现有条目**，只为其补齐缺失字段（如 `name` / `proxies`）。在本该消灭第二真相源的任务里再造一份平行目录，是直接违反不变量 4。

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
| `{ ref: <键> }` | 引用目录里的**单条完整组声明**，原样插入（只含成员与呈现字段），并允许**条目内覆写任意字段** |
| 完整声明 | 目录之外的组，字段与目录条目**完全同构**（`name` / `type` / `match` / `exclude` / `proxies` / `icon` / …） |

**关于「一束产物」的澄清（重要）**：不需要发明「`ref` 输出组 + 规则 + Provider」这类概念。`ref` 只负责建组，目录条目只承载组声明；规则一律来自 `routing` 表，二者通过组名关联。

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
| `enableDomesticGroup` | 中国分流组 | 否 | **删除** | `routing` 的 `domestic` 条目写 `to: 中国分流`（组随引用生成） |
| `enableGitHub` / `enableScholar` | 仅具备「关闭」语义的畸形开关 | 否 | **删除** | `groups` 列出对应 `ref` |
| `aiServices` / `streamingServices` / `socialServices` / `gameServices` / `systemServices` / `devServices` | 内置组条目清单 | 否 | **全部删除** | 无需字段：要哪个服务就列哪条 `ref` |
| `independentSocial` | 独立成组的社交应用 | 否 | **删除** | 下沉为目录条目属性（该服务是否独立成组） |
| `aiPreferredRegions` / `residentialNodeGroups` | 内置组成员编排参数 | 否 | **待删除** | 目标为下沉为目录条目默认值；当前 `topology` 仍读取这两个字段，属于未收口残差 |
| `customServices` | 行内自定义服务字典（按六维分类填写） | 否 | **删除** | 等价于 `groups` 中的一条完整自定义声明 |
| `enableResidential` | 家宽节点分流 + 出主力池 | 是 | **删除** | 并入 `enableIsolation`（三个内置隔离池总开关）；家宽节点不再单独门控 |

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
| `enableIsolation` / `pools` / `highMultiThreshold` | 隔离池总开关、自定义池定义与高倍率阈值；决定入桶与是否从主力池剔除，纯分池语义 |

> **配套安全要求**：`enableIsolation` 或自定义池的 `isolate: true` 把节点移出主力池后，必须保证用户仍有组承接这些节点，不得出现「节点被剔除后无处可去」。内置隔离池启用时总会建组，低倍率池恒存在（`hidden: true`）供下载策略引用。

**六、宏的终态定位修正 + Phase A 补修**

- **定位修正**：`@residential` / `@domesticGroup` / `@nonCnRegions` / `@activeRegions` 保留，但文档需明确其定位为**跨层桥**（引用分池层产物或目录条目），而非「硬编码开关的副产品」。宏语义不再随开关增减而漂移。
- **Phase A 补修（回退一处先前判断）**：未知宏的处置应由「运行期告警并跳过」改为**校验期 fail-closed 并报出字段路径**——项目在 CONFIGURATION.md 已宣称「严格阻断」，运行期告警属「配了等于没配」的软失败，违反不变量 6。实现方式：在配置校验阶段用宏白名单（单一真相源）比对 `@xxx`；引擎内部配方走另一条路径，不受影响。**该补修已覆盖「未知宏」；`groups[].proxies` 中的 `@pool:<池名>` 未知池名也已改为装载期 fail-closed（「池已声明但当前为空 / 未启用」仍按设计跳过），见「候选改进 5」。**

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
3. ✅ **批次 3（已实施，2026-10-20 / 收口 2026-10-21）**：按第十节「两表模型规格」实施——删除全部 A 类开关与 6 个清单字段，`customGroups` 更名为 `groups`，新增 `routing` 表与 `src/data/default-routing.js` 默认顺序表；随后**四字段收口为两字段**（`customRules` / `customGroups` 删除，组不再携带规则，见 10.12）。**本批会改写用户配置，属于用户面不可逆迁移**；实施规格见第十节（已定稿），迁移对照表见 10.7。
4. ✅ 批次 4（随批次 3 完成）：文档与类型声明已对齐（CONFIGURATION / DEFAULTS / README / index.d.ts）；迁移对照表见 10.7，随发版说明给出。

**八之二、批次 1 落地记录（含自主决策与残差）**

| 项 | 结论 |
| :--- | :--- |
| 目录落地位置 | 静态声明现位于 `src/data/catalog/`（`services/` 按类别拆分 + `groups.js` / `defaults.js` / `repos.js`），`src/config/catalog.js` 只保留投影与合并函数；批次 1 当时「不新建平行目录」的结论已被后续结构重构取代 |
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
| 残差 2a | `webrtc` 的回国模式成员编排（旧为 `enableDomesticGroup && !proxyFirst`）仍只在内置分支生效、未随目录交付；现已改读显式 `trafficDirection`，但「`ref: webrtc` 与内置配方等价」仍未达成——该改写仍在 `buildBuiltinAppRecipes` 内。批次 3 的组目录化一并收敛。 |
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

**十、已定：两表模型 `groups` + `routing`（批次 3 规格）**

> **状态：已实施（2026-10-20）。** 本节即批次 3 的实施规格；落地结论见 10.11。选型过程、缺陷与已答问题压缩保留在文末附录，便于追溯。

**10.1 职责边界**

| 表 | 只回答 | 不回答 |
| :--- | :--- | :--- |
| `groups` | 有哪些组？每个组怎么选节点（`type` / `proxies` / `match` / `exclude` / 健康检查参数）？ | 什么流量进这个组（规则归 `routing`） |
| `routing` | 哪条匹配式走哪个组？优先级顺序如何？ | 组怎么选节点 |

目录（catalog）退为纯数据源：服务规则集、Provider 路径、默认组配方。六维分类不再是用户面概念，也不再参与任何仲裁。

**10.2 `groups` 规格**

- 条目两型，同构：`{ ref: <目录键> }`（引用内置配方，可覆写任意字段）或完整声明；`disabled: true` 关闭一条（跨 include 片段唯一关闭手段）。
- 可引用判据沿用「条目自带非空 `proxies`」；未知 `ref` fail-closed（含聚合成员键的改引指引）。
- **组条目不再含 `rules` / `providers`**：写了即 fail-closed，错误消息指向 `routing`（「规则属于 `routing`，组只声明结构与配方」）。
- 组名唯一，同名后者胜（沿用）。

**10.3 激活语义（`ref` 组按引用生成）**

- 由 `ref` 派生的服务组，只有被至少一条生效的 `routing` 条目（显式 `rule` / `service`，或启用的 `preset`）作为目标引用时，才实际生成；无引用 = 不生成 → 与今日「开关关闭」等价。**机制迁移本身不应改变默认产物**；默认值的主动调整另按 10.9 走显式变更流程。
- 用户完整自写的组（无 `ref`）始终生成，即使暂无路由引用（允许占位组 / 手选组）。
- 因此批量开启 / 关闭是**一行**：`routing: [{ preset: social }]` 或 `{ preset: social, disabled: true }`，不必逐条增删 `groups`。

**10.4 `routing` 规格**

| 形态 | 写法 | 说明 |
| :--- | :--- | :--- |
| 单条 | `{ rule: 'DOMAIN-SUFFIX,gitlab.example.com', to: 我的工作线 }` | `rule` 只写匹配式（不含目标，目标归 `to`） |
| 批量 | `{ preset: subscription \| ads \| ai \| streaming \| social \| game \| dev \| specialized \| system \| process \| download \| domestic }` | 展开为目录数据里该批全部规则与各自默认目标 |
| 单服务 | `{ service: facebook, to?: <target> }` | 默认目标 = 该服务自身组；`to` 可改指——这是「合并进一个组」的正式表达，取代已删除的聚合机制 |
| 关闭 | `{ rule: '<与默认条目完全相同的匹配式>', disabled: true }`，或 `{ preset / service: X, disabled: true }` | 只删除**默认表**条目；匹配不到 = fail-closed（拼错却静默无效属 fail-open） |

`to` 解析顺序（全部 fail-closed）：

1. 内置特殊目标：`DIRECT` / `REJECT` / `REJECT-DROP` / `PASS`；
2. `groups` 中的 `ref` 键 → 解析为该组最终 `name`（**含用户覆写，改名不断链**）；
3. `groups` 中的自定义组名 → 必须存在于最终组清单；
4. 其余一律报错；若该名字对应被 `disabled` 或被剪枝的组，错误消息须显式提示（「目标组未声明 / 已关闭」）。

`to` 不接受数组：一组一目标，要多目标就写多条规则（顺序本就由 `routing` 承载）。

**顺序语义**

- `routing` 数组顺序 = 产物 `rules` 顺序 = 匹配优先级，全程不排序。
- 默认表是一份完整的出厂表（`src/data/default-routing.js`）；用户一旦提供 `routing` 就**整表替换**，不与默认表做增量合并。改默认顺序 = 按目标顺序重写整张表。
- `before` / `after` 锚点**未实现**（候选特性）；需要把某条插到默认条目旁时，直接按目标顺序写整表。
- `MATCH` 由 `preset: final` 给出，约定放在表尾；当前不做强制校验。

**关闭与 include（已实现）**

- `disabled: true` 按**条目稳定键**关闭同键条目：键 = `preset:<名>` / `service:<键>` / `rule:<匹配式原文>`，并叠加 `direction`（split / return / both）。
- 同键多次出现时**最后一次出现决定开关状态**，与 `groups` 的「位置靠后者胜」一致。include 仍按并集去重，`disabled` 在合并后的清单上统一结算；合并后片段在前、主文件在后，因此主文件的写法稳定生效。
- 同一匹配式重复出现且都启用时：完全相同的规则由 `dedupe` 收敛；同名匹配式指向不同目标则按表内顺序先匹配先生效。**重复匹配式冲突检查尚未实现**（候选特性）。

**10.5 默认值**

- `DEFAULT_CONFIG.groups`：全部服务 `ref`（含默认关闭的社交 / 专项）。是否生成由 10.3 决定，故「列出来」不影响默认产物。
- `DEFAULT_CONFIG.routing`：默认条目由 `src/data/default-routing.js` 的**显式顺序表**给出（该表是「默认分流顺序」的单一真相源）；条目只写 `preset` / `service` / `rule` 与目标引用，规则文本与 Provider 由 catalog 数据补齐。
- 默认顺序与今日一致：`pre: subscription` → `ads` → `ai` → `streaming` → `social`（默认关）→ `game` → `dev` → `specialized`（telegram 默认开；crypto / paypal / webrtc 默认关）→ `system` → `process` → `bt` → `download` → `domestic` → `final`（`MATCH`）。
- 每个 `preset` 的默认开关沿用今日 A 类开关的默认值（见 10.7）。
- 例外：`preset: ads` 展开为**两条独立规则来源**——`ad-block`（默认开，Provider `geosite/category-ads-all`）与 `anti-ad`（默认关，Provider `https://anti-ad.net/clash.yaml`），二者共享目标组「🚫 广告拦截」。两条目各自可被 `service` 单点引用或 `disabled` 关闭；不合并为一条，以避免把默认关闭的 `anti-ad` 规则强推生效。因此 `ads` 的默认输出仍只有 `RULE-SET,ads` 一条。

**10.6 include 与合并**

沿用 include 数组并集语义：`routing` 按整条内容并集去重；`disabled` 在合并后的清单上按 10.4 的稳定键结算，是跨片段唯一的关闭手段（与 `groups` 一致）。同一键多次出现时最后一次出现决定开关状态。

**10.7 用户面迁移（旧 → 新）**

| 旧写法 | 新写法 |
| :--- | :--- |
| `enableAI` + `aiServices` | 默认全开；关单项 `{ service: chatgpt, disabled: true }`，关整批 `{ preset: ai, disabled: true }` |
| `enableSocial` / `socialServices` / `independentSocial` | 开启 `{ preset: social }` 一行；四服务各成一组，合并用 `{ service: facebook, to: 我的社交组 }` |
| `enableGame` + `gameServices` | `{ preset: game }`；`game-service` / `game-download` 随引用生成 |
| `enableTelegram` / `enableCrypto` / `enablePayPal` / `enableWebRTC` | `{ service: telegram }` 等，或整批 `{ preset: specialized }` |
| `enableStreaming` / `streamingServices`、`enableSystemServices`、`enableGitHub` / `enableScholar`、`enableAdBlock` / `enableAntiAD`、`enableProcessDirect` | 同上：整批 `preset` 或单项 `service`；广告两条规则源变为 `preset: ads` 的两个默认条目 |
| `enableDomesticGroup` + `proxyFirst`（旧组合出回国模式） | 国内侧走向写 `{ preset: domestic, to: '中国分流' }`；方向写 `trafficDirection: return`（不再由两个开关推断，10.10 已实施） |
| `customRules` | `routing: [{ rule, to }]`（位置即优先级，写在哪条预设前后就排在它前后）；**字段已删除**，旧配置在解析期报「已删除字段」并指向新写法 |
| `customGroups` | `groups: [...]`（字段更名，但**不再接受 `rules` / `providers` / `process`**：规则一律写 `routing`）；字段已删除，同上 fail-closed |
| `customServices` | 保留字段名，改为**扁平**服务字典（不再按六维嵌套），新增服务用 `{ service: <键> }` 路由引用 |

**10.8 验收标准（批次 3 完成判据）**

1. **默认产物基线（允许变更，但必须显式）**：`test/pipeline/default-output-golden.test.js` 仍比对 `proxies` / `proxy-groups` / `rules` / `rule-providers` / `dns` / `tun` / `sniffer`，规则顺序参与比较。基线**不是「不可变的真理」**——默认值本来就是可修的对象；它的职责是让**每一次变化显式可见**：任何默认产物差异只能通过 `node scripts/gen-default-output-golden.js` 更新，且必须在该笔提交信息中逐条说明「变了什么、为什么、影响谁」；未说明的差异一律视为回归。计划内的默认值调整（修正规则顺序、增删默认组、改默认开关等）单独成笔，不与机制迁移混提，保证可单独回滚。
2. **顺序可测**：新增「调换两条 `routing` 条目 → 命中目标随之改变」的回归测试。
3. **改名不断链**：`{ ref: X, name: Y }` 后 `routing` 目标随动；目标指向不存在组 → 配置期 fail-closed。
4. **批量一行**：`{ preset: X }` 与 `{ preset: X, disabled: true }` 各一条集成测试。
5. **组合场景回归**：默认 / 停用单项 / 停用整批 / 覆盖同名组 / include 片段 / 悬空目标 / 重复匹配式 / 空节点池。
6. **结构性字段核对**：`coreRegions` / `minorNodeThreshold` / `regionGroupType` / `enableRegionHashLB` 逐项确认只影响分池与折叠。
7. **合并表达**：`{ service: facebook, to: <自定义组> }` 产出的规则目标与组清单一致（取代聚合机制的回归守卫）。

**10.9 默认值审查（批次 3 附带，不阻塞机制迁移）**

机制迁移完成后单独一笔「默认值复审」，逐项确认（可判定「维持现状」并要求在文档记录）：

- A 类开关的默认值：现默认开 = AI / 流媒体 / 游戏 / 系统服务 / 专项 telegram / GitHub / 学术 / 广告 / 进程直连；默认关 = 社交 / 加密 / PayPal / WebRTC / QUIC 拒绝 / 国内组 / anti-ad。
- 默认 `routing` 顺序是否仍然合理（例如 `ads` 与 `lan-domain` 的先后、`domestic` 是否应在 `non-cn` 之前）。
- 默认组名 / 展示（含 emoji）是否仍合适。
- `CONFIGURATION.md` 的默认值表与代码默认值是否一致。

每项变更走 10.8 第 1 条的显式基线流程；「已审、维持」也写进结论，避免下次重新讨论。

> **M3.B 实施记录**：10.10–10.19 的落地过程、否决方案与选型依据见 [M3.B 实施记录](docs/history/m3b-implementation.md)，不再占用路线图主线。

---

### 🟣 Milestone 4: v4.0-GA 正式发布与合流 (未来展望)
> **阶段目标**：完成主分支合流与正式发版，不再引入新功能面，确保发布可验证、可回滚。

1. **合并合流与 3.x 归档**：
   - 合并至 `main` 分支发布 `v4.0.0` 正式版；3.x 单脚本正式转入维护模式。
2. **发布验证与迁移收尾**：
   - 锁定默认产物基线，完成 CLI / HTTP 回归与文档、配置契约核对；提供从 v1.3.2 到 v4 的迁移说明。
3. **已否决目标（不排期）**：
   - 本地离线 IP/ASN 标签库、Sub-Store 原生流水线适配已从 M4 移除：可行性不足且会扭曲决策方向与排期。
   - 现有 `nodes` 模式仍可作为 Sub-Store 等外部二次加工入口，但不再承诺原生适配模块。

---

## 🔎 候选改进：可发现性与可解释性（未排期，来源：外部评审）

> 三件事都不改变产物语义，只解决「不知道有什么 / 不知道为什么不生效」。按成本从低到高，建议顺序 3 → 1 → 2。

### 1. `list` 子命令（低成本，高收益）

- `list refs / presets / macros / pools / services`，反射现有结构：`registries.groups`、`PRESET_DEFINITIONS`、`MACRO_ALIASES`、`resolvePoolDefinitions()`。
- 前置约束：先定输出契约（人类可读 + `--json`），内部字段名不得直接固化成用户 API；`refs` 需标注「聚合组 / 可独立引用」，`services` 需标注「聚合成员不可单独 ref」。
- 未启用池、隐藏池、恒在池都要能区分展示，避免 `list` 与 `--explain` 口径不一致。

### 2. `--explain` 激活摘要（中高成本）

- 目标：一次输出组 / 规则 / 池的「激活 / 跳过 / 剪枝 / 为空」及原因，覆盖两个最大黑箱——配了不生效、被剪了不知道为什么。
- 成本在中间态：engine → routing → prune 目前不回传决策记录。应以「结构化 trace 收集器」贯穿，而不是解析日志；与 `logLevel` 解耦，默认只读不产出。
- 可复用为回归基线：断言激活摘要不漂移，效果等同现有 golden。

### 3. 错误消息带可用选项、池引用口径统一（低成本，部分已存在）

- **现状修正**：
  - `routing` 的 `@pool:` 已 fail-closed，并会列出可用内置池（`routing.js`）；
  - `@pool:` 不再被误报为「未知宏」，`matcher` 已放行、由求值期校验池存在性。
- **剩余缺口**：
  - `groups[].proxies` 中的「池不存在 / 池为空」仍是 `warn + skip`（`topology-engine.js`），与 `routing` 的 fail-closed 口径不一致——未知池名应配置期报错；
  - 已知但未启用的内置池在 `routing` 被报成「不存在」，应改为「池未启用（`enableIsolation: false`）」并给出开关提示；
  - 宏报错目前只指向文档，可内联「可用宏」清单（`MACRO_ALIASES` 现成）；
  - 「已启用但暂无成员」仍属合法运行时跳过，但应在 `--explain` 里可见，而不是静默。

## 📌 候选改进：收敛实现路径（当前基线设计成熟，实现仍存在多路径冗余，留作长期演进）

### 1. ✅ 已完成：目录条目拆分，解除「一身二职」的隐式补丁

**结果**：`registries.groups` 现在只投影组声明（`name` / `type` / `match` / `exclude` / `proxies` / `preferredRegions` / `hidden`）；规则来源分别归位到分类条目、`registries.aggregates`（聚合组新增 `rules` / `providers`）与 `ADS_GROUPS`。`resolveGroupDeclarations` 不再需要展开期 `delete rules / providers / process`，routing 通过 `findService` 从源条目取规则。

### 2. ✅ 已完成：建组激活收编为数据表

**结果**：`buildBuiltinAppRecipes` 改为消费 `BUILTIN_RECIPE_SOURCES`（`src/strategy/topology.js`）。每个分类只登记四件事——条目来源、缺省 `proxies` 模板、是否回传 `preferredRegions`、必要的条目覆写；八段手写 `if` 与重复的 `recipes.push` 字段组装已删除，新增分类只需在表中追加一项。

### 3. ✅ 已完成：组身份内部键化，名字只做标签

**现状修正**：骨架组不在用户 `ref` 目录中，没有可用的 `ref` 键；组名允许被用户 `{ ref, name }` 覆写，因此「静态 `refKey → 规范组名` 映射表」不足以支撑全程 ID 化。全仓命中里约四成是合理单一真相源（图标表、组声明、池表），真正需要键化的身份判定点约 25–30 处。

**阶段 1（已落地）**：新增 `src/data/catalog/identity.js` 作为内部身份单一真相源（`GROUP_KEYS` / 规范名 / `skeleton` / `poolDependent`，未知键 fail-closed）；`target-registry` 的 14 项骨架组与池依赖名单改为投影该表；`topology` / `topology-engine` / `rules` / `security-baselines` / `macros` / `routing` / catalog 组声明 / `presentation` 图标表全部消费身份键；装饰剥离规则收敛为同一实现，展示层仍以组名为终末契约。默认输出逐字节不变，`npm test` 692 项通过。

**阶段 2（已落地）**：`verify:arch` 新增「组身份字面量」静态校验，扫描 `src/` 内所有已登记规范名，仅豁免身份表、池名来源与两处语义无关的用户面词元（`matcher` 的 DSL 词、`routing` 预设标签）；命中即退出非零，防止逻辑层回退到中文名判定。`routing` 的 `expandFinal` 与 `config` 的退役字段提示同步改为身份键投影。

### 4. ✅ 已完成：目标解析：四种写法与多份白名单收敛为单一 TargetRegistry

**结果**：新增 `src/strategy/target-registry.js`，把内核内置目标、14 项骨架组、池名、`负载均衡-哈希 (…)` 派生组、地区组、大洲组、按方向过滤的用户组、组目录（含 `disabledRefs`）与服务键收敛成一张按优先级登记的目标表。`resolveTo` / `isValidTargetName` 与 `prune.js` 的内置目标、池依赖判定均改为消费同一份事实，`routing.js` 内的骨架白名单与 `prune.js` 的两份独立白名单已删除。派生哈希组名改由 `regions#getHashLbGroupNames` 统一派生，routing 白名单与展示层徽标登记同源，新增一类目标只需在注册表登记一处。顺带补齐「大洲组名（如 `欧洲节点`）此前不被识别为合法目标」的缺口。

### 5. ✅ 已完成：池引用口径统一（`@pool:` 装载期 fail-closed）

**结果**：`resolveConfig` 在装载期校验 `groups[].proxies` 与 `routing[].to` 中的 `@pool:<池名>`，必须指向内置池表或用户 `pools` 中已声明的池，否则报出字段路径（`groups[0].proxies[1]` / `routing[2].to`）并中止；「池已声明但当前为空 / 未启用」仍属合法运行期跳过。`topology-engine.js` 中「节点池不存在或为空」的 `warn + skip` 分支已删除，装配层只保留空成员跳过；`CONFIGURATION.md` 的「两套口径」说明同步移除。

### 6. 校验职责：schema 校验散在三处、执行阶段不统一

**现状**：组的结构与配方校验在 `validateGroups`（`src/strategy/matcher.js#L582`，装配期执行）；`{ ref }` / `disabled` 的结构校验在 `src/config/groups.js`（装载期）；目标合法性在 `src/strategy/target-registry.js`（解析期）。池引用已在装载期统一（见第 5 条），但其余字段的校验阶段仍是三套。

**风险**：新增 DSL 字段要跨三个模块同步，最容易出现「一边已校验、一边仍放行」的软失败；错误发生的阶段（装载期 / 装配期）与错误消息风格不统一，用户排查时很难判断某条配置到底在哪一层被丢弃。

**修复方案**：收敛为单一配置 schema 校验层（装载期执行），装配层只消费已通过校验的对象、不再重复判类型；`topology-engine.js` 中未知宏的 `warn + skip` 兜底随之删除。

**验收口径**：任何非法 `groups` / `routing` 配置都在装载期报错并给出字段路径；`topology-engine.js` 中不再存在类型 / 存在性判断的 `warn + skip` 分支。

---

## 🗂️ 历史与明细

- [M3.B 实施记录（10.10–10.19）](docs/history/m3b-implementation.md)
- [v4 取代边界与命名谱系](docs/history/v4-boundary.md)
- [技术债务跟踪表](docs/debt.md)