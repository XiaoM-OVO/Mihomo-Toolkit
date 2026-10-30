# 🗺️ Mihomo-Toolkit 演进路线图 (ROADMAP)

本文档制定 Mihomo-Toolkit 的**真实版本发布里程碑、候选改进与功能演进路线**。  
全篇以**“稳定性先行、大动作排后、以代码实际运行为唯一事实来源”**为核心准则。

---

## 🧭 当前状态与待办

- **当前版本**：`v4.0.0-alpha`
- **真实开发完成度**：**约 80%**
- **当前待办**：
  1. **可发现性改进**：`list` 子命令（✅ 已落地）、错误消息内联可用选项（✅ 已落地）、`--explain` 激活摘要（✅ 已落地）。
  2. **默认值复审**：确认默认分流顺序、组名与展示仍合理，结论写入文档。

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
  - 直连拉取在建连阶段固定已校验 IP（`src/io/pinned-agent.js` 的 `connect.lookup`），消除请求前校验与建连解析之间的 DNS Rebinding (TOCTOU) 窗口。代理模式因解析发生在代理侧，本机无法固定 IP，残余风险保留并需由代理侧 ACL 兜底（见 `src/io/ssrf.js` 文件头）。


#### 📦 M3.B 规格（已归档）

M3.B 的设计不变量、两表 DSL 契约、迁移对照与验收标准（10.1–10.9）已随 M3 闭环归档，见 [M3.B 已闭环规格](docs/history/m3-spec.md)；10.10–10.19 的实施过程见 [M3.B 实施记录](docs/history/m3b-implementation.md)。当前用户面契约以 [CONFIGURATION.md](CONFIGURATION.md) / [DEFAULTS.md](DEFAULTS.md) 为准。


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

## 🛡️ 生产安全与可观测性候选

1. **接入鉴权硬化（P1）**
   - 现状：日志已对 `token` 脱敏，但 `/?token=***` 仍可能落入反代访问日志、浏览器历史、Referer 与外部监控系统。
   - 候选：默认仅监听 `127.0.0.1`，生产统一置于反代之后并走 HTTPS；鉴权优先使用 `Authorization` 头；补充限流、令牌轮换与 IP 白名单 / 防火墙。
2. **Host 注入与缓存投毒防护（P1）**
   - 现状：按 Host 组装的产物参与 L2 缓存键与产物组装。
   - 候选：对 Host 做白名单校验，避免任意 Host 触发缓存膨胀或生成错误产物。
3. **失败状态措辞收敛（P2）**
   - 目标：把 `disabled / failed / backoff / stale` 收敛为单一状态机口径，看板、汇总树与 `/healthz` 共用同一枚举。
   - 现状：终态订阅已进入 6h→24h 长冷却；仍需把「无可用缓存时是否返回部分产物」明确成显式策略，而不是仅靠降级标记推断。
4. **告警与结构化日志（P2）**
   - 候选：在现有文本日志之外提供 JSON 结构化输出，补充 request id、每源耗时、HTTP 状态码与退避原因。
   - 候选：对连续失败、可用节点数骤降、剥离字段异常提供 Webhook / 指标告警。
5. **沙箱剥离可审计（P2）**
   - 候选：记录订阅内容 hash、剥离字段清单与策略版本；必要时支持剥离规则配置化，降低误杀正常字段的风险。
   - 文档侧需明确提示：订阅自带的 `proxy-groups` / `rules` 会被剥离，策略由工具重新装配。

---

## 🧩 DNS 内核语义对齐候选

1. **INV-7 的 `*.` 口径对齐（P2，来源：映射模式兼容层评审）**
   - 现状：`resolver-plan.js` 的 fake-ip-filter 覆盖判定把 `*.example.com` 当作任意级后缀，而 v1.19.13 的 domain trie 仅匹配严格单层子域（`+.` 才含裸域与任意级，`.` 仅子域、不含裸域）。
   - 风险：可能漏报「节点域名未被 fake-ip-filter 覆盖」的诊断；与本次映射冲突决议无关，且改动可能影响既有 golden tests，故单独立项。
   - 建议：先补「裸域 / 单层子域 / 多层子域」三个测试场景，再统一 `+` / `.` / `*` 语义。

---

## 🔎 可发现性与可解释性改进（来源：外部评审）

> 三件事都不改变产物语义，只解决「不知道有什么 / 不知道为什么不生效」。按成本从低到高，顺序 3 → 1 → 2，三项均已闭环。

### 1. `list` 子命令（✅ 已落地）

- 已实现 `list refs / presets / macros / pools / services`（`src/targets/list.js`），数据全部反射现有单一真相源：`registries.groups`、`PRESET_DEFINITIONS`、`MACRO_GROUPS`、`BUILTIN_POOL_DEFS` + `resolvePoolDefinitions()`、分类注册表 / `specialized` / `aggregates` / `ADS_GROUPS`。
- 输出契约：人类可读树形文本 + `--json` 的 `{ domain, configLoaded, count, items }`；内部字段先映射成用户语义（`aggregate` / `standalone`、`direct` / `aggregate-member`、`always` / `onDemand`）再输出，不直接把内部字段名固化成用户 API。
- `refs` 标注「聚合组 / 可独立引用」，`services` 标注聚合成员不可单独 ref 并给出应改引的聚合组。
- 未启用池（`status: inactive` + `gate: enableIsolation`）、隐藏池（`hidden`）、恒在池（`activation: always`）分别展示，与 `@pool:` 报错口径一致。

### 2. `--explain` 激活摘要（✅ 已落地）

- 目标：一次输出组 / 规则 / 池的「激活 / 跳过 / 剪枝 / 为空」及原因，覆盖两个最大黑箱——配了不生效、被剪了不知道为什么。
- 落地方式：新增 `src/strategy/explain.js` 结构化收集器贯穿 engine → routing → topology → prune，只在决策点显式写入记录，不解析日志、与 `logLevel` 解耦；未启用时收集器为 `null`，产物与行为完全不变。
- 输出形态：`--explain` 只读诊断（等同不落盘），另附 `--json` 输出 `{ version, counts, records }` 固定契约，渲染见 `src/targets/explain.js`。记录 `kind` 为 `group` / `rule` / `pool` / `provider`，`status` 为 `active` / `skipped` / `pruned` / `empty`，`code` 为稳定原因码。
- 已覆盖的静默点：routing 条目的 `disabled` / 同键被关闭 / 方向不符 / 未产出规则；池的「未启用（含 `enableIsolation` 门控）」「按需池未被引用」「已启用但暂无成员」；组的空壳与剪枝（不可达 / 破环 / 骨架兜底）；规则按目标聚合的「池依赖跳过」「孤儿目标」；被清理的孤儿规则集提供者。
- 可复用为回归基线：`--explain --json` 的 `records` / `code` 可直接断言，效果等同现有 golden（见 `test/targets/explain.test.js`）。

### 3. 错误消息带可用选项、池引用口径统一（低成本，部分已存在）

- **现状修正**：
  - `routing` 的 `@pool:` 已 fail-closed，并会列出可用内置池（`routing.js`）；
  - `@pool:` 不再被误报为「未知宏」，`matcher` 已放行、由求值期校验池存在性；
  - `groups[].proxies` 与 `routing[].to` 的未知池已统一为装载期 fail-closed（见[实现路径收敛记录](docs/history/implementation-convergence.md)第 5 条）。
- **剩余缺口**：
  - ✅ **已闭环**：`routing` 的 `@pool:` 命中被门控的内置池时报「未启用」并直接给出开关（`enableIsolation: true`），真拼错才报「不存在」；
  - ✅ **已闭环**：两处未知宏报错内联规范宏清单（`formatMacroHints()`），完整别名与求值口径仍指向 CONFIGURATION.md；
  - ✅ **已闭环**：「已启用但暂无成员」属合法运行时跳过，但已在 `--explain` 中作为 `pool` 记录（`status: empty`、`code: no-members`）显式可见，不再静默。

---

## 🗂️ 历史与明细

- [实现路径收敛记录（6 项已闭环）](docs/history/implementation-convergence.md)
- [M3.B 实施记录（10.10–10.19）](docs/history/m3b-implementation.md)
- [v4 取代边界与命名谱系](docs/history/v4-boundary.md)
- [技术债务归档（47 项已闭环）](docs/history/debt-resolved.md)
