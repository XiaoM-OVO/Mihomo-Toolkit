# M3.B 实施记录（10.10 – 10.19）

> 历史记录，保留「为什么这样做」与已否决方案；当前生效规格仍是 [ROADMAP.md](../../ROADMAP.md) 的 10.1–10.9，用户面契约见 [CONFIGURATION.md](../../CONFIGURATION.md)。

**10.10 方向（分流 / 回国）必须显式——已实施（2026-10-20）**

旧实现是两个布尔量的隐式组合（`enableDomesticGroup` × `proxyFirst`），一次同时改变 **6 处**行为：规则顺序、国内规则目标、海外规则目标、「中国分流」成员顺序、「漏网之鱼」兜底顺序、DNS 上游 / QUIC 目标 / WebRTC 分支。`domestic=true && proxyFirst=false` 会把整个方向翻转，而开关名只说了「国内组」，属静默语义。

决定（已落地）：

- **规则层面**：顺序与目标由 `routing` 表表达。`domestic` 预设固定展开 `non-cn` → `cn-domain` → `cn-ip`（两侧规则集互不相交，内部顺序只影响文本）；目标由 `trafficDirection` 与条目 `to` 决定：`split` 时海外走代理、国内走 `to ?? DIRECT`，`return` 时国内走代理、海外走 `to ?? DIRECT`。`proxyFirst` / `enableDomesticGroup` 不再是规则生成的输入。
- **组层面**：`中国分流` 组由引用激活（10.3）——只有某条生效规则以它为 `to` 时才生成（`buildProxyTopology` 的 `ruleTargets`）。
- **方向层面**：显式字段 `trafficDirection: 'split' | 'return'`（默认 `split`），只影响与规则无关的行为：DNS 上游（`src/strategy/dns.js`）、QUIC 拦截目标（`src/strategy/routing.js` 的 `expandQuic`）、WebRTC 成员编排（`src/strategy/topology.js` 的 specialized 分支）。
- **迁移**：`enableDomesticGroup` 与 `proxyFirst` 已直接删除，不留兼容别名（`test/security/data-baseline.test.js` 的 `REMOVED_BY_DESIGN` 记录在案）；10.7 对照表写明替代写法。
- **验收**：`test/pipeline/routing-expansion.test.js` 的「流量方向与国内侧目标」4 条用例覆盖 `split` / `return` / `to: 中国分流` / `return + to`；基线用例中 3 个旧组合已改写为显式方向语义（`_doc` 说明）。

**残留（已由 10.18 收敛）**：`trafficDirection` 曾推导两处「展示性默认」——「中国分流」组成员顺序与「漏网之鱼」兜底顺序。现已改为 `SKELETON_GROUP_DEFS` 的方向变体声明，拓扑层只取变体、不推导顺序。

**10.11 单一路径与默认值即配置（已实施）**

> 2026-10-20 落地。结论：不为「旧配置还能跑」保留分支，也不为「行为没变」在代码里写双路。

- `routing` 是规则生成的**唯一来源**：`buildRoutingRules`（段序按开关串联）与 `assembleServiceCategory` 已整段删除，不存在「没写 routing 就走旧引擎」的分支。未写时取自 `DEFAULT_ROUTING`，默认值本身就是配置数据。
- 退役清单已全部删除（字段注册表 + `index.d.ts` + 示例配置 + golden）：14 个分流开关 + `enableQUICReject` + 6 个服务清单字段（`aiServices` / `streamingServices` / `socialServices` / `gameServices` / `systemServices` / `devServices`）；`enableDomesticGroup` / `proxyFirst` 已在 10.10 删除。批量开关由 `routing` 的 `preset` / `disabled` 表达，单项由 `service` 表达。
- 建组改为「规则引用驱动」：`buildBuiltinAppRecipes` 只按「规则目标名集合」决定建哪些组，开关不再参与建组；`registries.groups` 与 `{ ref }` 声明继续作为显式建组入口。
- 默认值改动**直接改数据**（`src/data/default-routing.js`、`src/data/field-registry.js`、`src/config/catalog.js` 条目），按 10.8 第 1 条更新基线并说明。
- 验收：`grep` 生产代码已无 `enableAdBlock` 一类字段读取（仅存在于迁移文档与「已删除字段」清单）；625 条测试全绿，默认产物零漂移。

**10.12 DSL 收口：四字段 → 两字段（已实施，2026-10-21）**

> 目标：把用户面的「组」与「规则」彻底分成两个字段，不留第二条注入路径。

- **最终形态**：`groups` 只声明组的成员与呈现（`name` / `type` / `match` / `exclude` / `proxies` / `preferredRegions` / 图标 / `ref` / `disabled`）；`routing` 是规则唯一来源（`preset` / `service` / `rule` + `to` / `disabled`）。
- **删除的字段**：`customRules`（并入 `routing` 的 `{ rule, to }`）与 `customGroups`（并入 `groups`），二者进入 `REMOVED_FIELDS`，解析期 fail-closed 并给出新写法。
- **组声明不再携带规则**：目录条目历史遗留的 `rules` / `providers` / `process` 在 `{ ref }` 展开时剥离，`matcher.js` 的组字段白名单同步收窄——组里再写这些字段会被顶层白名单拒绝。
- **规则集简写换代**：原「组里写 `geosite:x` 字符串」的能力改为 `routing` 条目 `{ rule: 'geosite:x', to: <组> }`（自动登记同名 Provider），能力不减、位置唯一。
- **节点级标注改名**：订阅/清洗阶段的节点级 `customGroups` 元数据改名 `groupTags`（`node-trust` 可信键同步），与用户面字段彻底解耦。
- 验证：630 条测试全绿；`lint` / `verify:arch` / `verify:docs` 通过；默认产物两个 golden 零漂移。

**10.13 隔离组按「特性门」处理（已实施，2026-10-21）**

> 目标：让节点隔离类开关与分流表共存——开关决定特性开不开，条目只表达意图。

- **定位**：`enableResidential` / `isolateHighMulti` / `isolateExperimental`（连同只管剔除的 `isolateDownload`）不是「分流开关」，而是**节点分池特性门**。分流仍 100% 由 `routing` 决定，开关只管「这个池建不建」。
- **开关开**：建组（`家宽优选` / `高倍率优选` / `实验节点`）+ 把匹配节点从主力池剔除；`routing` 指向它的条目正常生效。
- **开关关**：不建组、不剔除；指向它的条目自动跳过并汇总告警。这样用户把条目留在表里，翻开关即可开合，不必逐条注释。
- **开关开但无合格节点**：不建空组（空成员组内核不接受），条目一并跳过。`家宽优选` 原实现「开关开就建组（哪怕空）」已对齐为「且桶非空」。
- **不变量（新增）**：`prune.js` 阶段 4 的清理口径从「目标组刚被淘汰」升级为**「规则目标必须真实存在（策略组 ∪ 物理节点 ∪ 内置目标）」**，不满足则整条跳过并 `warn` 汇总。该不变量同时兜住了「开关关闭」「空桶」「被 DSE 剪掉」三种悬空来源，替代了此前缺失的「规则目标校验」。
- **边界**：条件合法只针对这三个真实组名；拼错仍 fail-closed。隔离组不支持 `{ ref }`（自动桶不是目录条目），自定义隔离组用 `match: { tag: 'experimental' }` 自己声明。
- 验证：636 条测试全绿（新增 `test/pipeline/isolation-groups.test.js` 4 例、`prune` 悬空目标 1 例）；默认产物 golden 零漂移。

**10.14 低倍率池与下载口径收敛（已实施，2026-10-21）**

> 目标：把 `下载策略` 身上粘着的三种身份拆开——池（哪些节点便宜）、出口（下载走哪）、BT 指向（BT 流量去哪）。

- **池只表达身份**：节点标签/特征桶 `download` 更名 `lowMulti`，含义收窄为「倍率低」，不再预先过滤「是否允许下载」。
- **禁止下载独立打标**：`forbidDownload` 成为独立 tag（不进入 `featurePools`），是否排除由使用侧决定。`低倍率池 = 全部低倍率节点`，不再被资格判断污染。
- **使用侧排除**：`⏬ 下载策略` 与 `🔄 负载均衡-轮询` 的成员 = 低倍率池中不带 `forbidDownload` 的节点；池为空时两组都不生成，指向它们的 `download` 规则由 `prune` 阶段 4 一并剪除（沿用「不建空组」口径）。
- **BT 拆段**：`process` 预设只保留「进程直连」；新增 `bt` 预设 = BT 追踪器规则 + `processProxy*` 软件进程，默认目标 `DIRECT`，用户可用 `{ preset: bt, to: <组> }` 整段改道。`download` 预设同样支持 `to`（此前两个预设的 `to` 被静默忽略）。
- **`isolateDownload` 口径修正**：剔除判断从 `download` 标签改为 `lowMulti` 标签，因此标记禁止下载的低倍率节点也会被隔离（此前会漏在主池），下载侧排除与隔离侧剔除现在是两件独立的事。
- **默认产物变更（按 10.8 第 1 条，已重采 golden）**：`IDMan.exe` / `fdm.exe` 目标由 `⏬ 下载策略` 改为 `DIRECT`；追踪器规则从 `process` 段移到 `bt` 段（文本与相对位置不变）。默认样本无低倍率节点，故默认产物不含 `⏬ 下载策略` / `🔄 负载均衡-轮询`，`download-games` / `download-android` 两条规则与同名 Provider 一并被剪：**默认产物从 32 组 / 59 规则 / 42 Provider 变为 31 组 / 57 规则 / 40 Provider**。`social-enabled` 场景相应为 35 组 / 61 规则。
- **池依赖组的缺席不算悬空引用**：`prune` 阶段 4 把 `下载策略` / `负载均衡-轮询` 列为「池依赖目标」，池空时其规则按设计跳过，只记 debug 日志，不触发 `⚠️ 规则目标不存在` 告警（否则每次默认运行都会刷一条噪音）。
- **禁止下载标记可展示**：`FEATURE_ICONS` / `FEATURE_TEXT_MAP` 的 `no_download` 键随标签改名同步为 `forbidDownload`，节点名上重新能看到 `🚫` 与「禁止下载」。
- **后续变更（10.17 已整体移除）**：上面 453 / 454 / 456 / 459 四条随之失效——`forbidDownload` 打标、使用侧排除、`isolate` 剔除口径、`🚫` 展示均已删除。原因是实际机场样本与长期观察中从未出现该标记，资格判断属过度设计；现状为低倍率池与下载组都只按倍率圈定，不再区分「是否允许下载」。
- 验证：638 条测试全绿（新增「禁止下载只在使用侧排除」「空池不建组且规则剪除」2 例）；`lint` / `verify:arch` / `verify:docs` 通过。
- **残留（已由 10.18 收敛）**：10.10 末尾所述 `trafficDirection` 推导「中国分流」成员顺序与「漏网之鱼」兜底顺序的问题，本批次未动，已随方向变体声明落地。

**10.15 语义识别收敛：一套正则库 + 一个识别器（已实施，2026-10-21）**

> 背景：节点语义提取集中到 `core/metadata` 之后仍留下两套并行判定——`core/geo.matchNodeRegion` 与 `core/metadata.detectRegion` 对同一名字给出不同结论（12 个样本 5 个分歧），正则也散落在 data / geo / metadata 三处。

- **正则唯一产地**：新增 `src/data/name-grammar.js`，集中构造入口、连接符、国旗、倍率三类正则（`REGEX_ENTRY_CITY` / `REGEX_FLAGS` / `REGEX_UNKNOWN_FLAG` / `MULTIPLIER_PATTERNS`）与 `buildRegionRegex`；`cleaner-rules.js` 只保留词表，不再自行编译正则。
- **识别器唯一实现**：新增 `src/core/recognizer.js` 的 `recognizeRegion()`，`core/geo.matchNodeRegion` 与 `core/metadata.detectRegion` 都退化为薄包装，`geo` 与 `metadata` 的落地结论从此一致。
- **入口口径修正**：入口只认国内中转城市（`DOMESTIC_ENTRY_CITIES`），不再把香港 / 日本 / 美国 / 新加坡当入口。修复前 `香港 日本 专线` 的入口是「港」、`日本 香港` 的入口是「日」，纯属误判。
- **落地取「最后出现」**：落地地区按名字中**最后出现**的地区判定（`深-港` → 香港、`香港 转 日本` → 日本、`新加坡 美国` → 美国），不再按「最长匹配」；`geo` 原最长优先在「长名字 + 后置短名字」时会把中转当落地。
- **冲突只标记不丢落地**：多地区 / 国旗与文案不一致时，识别器返回 `hasConflict` + `conflictReason`（`multi-region` / `flag-text` / `multi-flag`）且仍给出落地；`metadata` 旁路契约保持保守——冲突时状态降 `partial`、不认领 `groupKey`，但 `regionDef` 可被需要方使用。
- **无默认产物漂移**：样本节点名均为单地区，默认与 `social-enabled` 两套 golden 零变化；649 条测试全绿（新增 `test/core/recognizer.test.js` 6 例，含「geo 与 metadata 结论一致」对照）。
- **残留**：`recognizeRegion` 目前以「最后出现」为落地启发式，`美->沪 回国专线` 这类「回国」命名会被标为多地区冲突（落地仍正确为中国）；后续若要做「回国专线」的显式语法，应在词表里加方向词而不是回到最长匹配。

**10.16 节点池与隔离机制：`pools` + `enableIsolation`（已实施，2026-10-21）**

> 背景：10.13 的四个「池特性门」仍是四个开关，池的圈选条件写死在 `topology.js` 的节点循环里；`下载策略` 要引用「低倍率节点集合」时只能靠同名桶。把「节点集合」抽成数据后，隔离组与下载组共用一套机制。

- **池是数据，不是组**：新增 `src/data/default-pools.js`（内置池：家宽优选 / 高倍率优选 / 实验节点 / 低倍率节点）与 `src/strategy/pools.js`（自定义池校验、定义合并、谓词编译）。`pools` 条目 = `{ name, match, exclude?, isolate?, hidden?, group?, type? }`，`match` 复用 `groups` 的配方语法（`region / multi / tags / pattern / protocol / airport / custom` 等维度）。
- **引用即激活**：池只有在 `routing` 的 `to`（含 `@pool:<池名>`）指向它、或自身 `group: always` 时才物化成同名策略组；按需池没被引用就不建组。`@pool:` 是显式索要：池未启用时 fail-closed 报错，与直接把池名当目标（未启用则跳过）区分开。
- **隔离 = 池的 `isolate` 标记**：`isolate: true` 的池成员从地区池 / 全量标准池剔除。`enableIsolation` 只门控三个内置隔离池（家宽 / 高倍率 / 实验），自定义池的 `isolate` 自行生效；`低倍率节点` 恒存在但 `hidden: true`，供 `下载策略` / `负载均衡-轮询` 取成员。
- **开关退役**：删除 `enableResidential` / `isolateHighMulti` / `isolateExperimental` / `isolateDownload`，进 `REMOVED_FIELDS`（共 31 项）并在解析期给出各自落点提示；`topology-engine` 的宏上下文兜底从 `enableResidential` 改 `enableIsolation`。
- **剪枝口径**：`prune` 阶段 4 的「池依赖目标」集合 = `下载策略` / `负载均衡-轮询` + 全部内置池名 + 自定义池名；池空或未激活时只记 `🪣` debug，不刷悬空引用告警。
- **默认产物零漂移**：四个旧开关默认全关，默认样本无隔离 / 低倍率节点，两个 golden 文件字节无变化；`default-config.golden.json` 按 10.8 第 1 条显式删 4 个退役键、加 `enableIsolation` / `pools` 两键（59 → 55 键）。
- 验证：656 条测试全绿（新增 `test/strategy/pools.test.js` 6 例、重写 `isolation-groups` 5 例）；`lint` / `verify:arch` / `verify:docs` 通过。
- **残留（已由 10.18 收敛）**：`POOL_SORT_ORDER` 的展示文案曾与池定义分家，现已由 `BUILTIN_POOL_DEFS` 单表派生；地区组仍不改成池（避免与 `activeRegions` 折叠逻辑冲突）。

**10.17 下载组声明化：`下载策略` / `负载均衡-轮询` 改为数据表（已实施，2026-10-21）**

> 背景：10.16 把「节点集合」抽成池之后，低倍率池是唯一仍然「在代码里被使用侧临时过滤」的池——`topology.js` 自己算 `forbidDownloadNames`、自己拼 `下载策略` 成员，池定义不完整，两个下载组也不在数据层。

- **池定义纯净**：`低倍率节点` 为 `match: { tags: ['lowMulti'] }`、`group: 'always'`、`hidden: true`——纯粹按倍率圈定，不再做多余业务过滤；池恒物化（有成员时）。
- **组定义下沉配置编目**：收录于 `src/config/catalog.js` 的 `DOWNLOAD_GROUPS`：`下载策略`（`select`，成员 `DIRECT` / `负载均衡-轮询` / `自动选择` / `@pool:低倍率节点`）与 `负载均衡-轮询`（`load-balance` + `round-robin`，成员 `@pool:低倍率节点`，`hidden: true`）。
- **`groups[].proxies` 支持 `@pool:<池名>`**：`topology-engine` 的 `resolveGroupProxies` 在宏解析之前处理 `@pool:`，把池成员展开到成员列表；池为空或不存在时告警跳过（`⚠️ [TopologyEngine] 节点池「X」不存在或为空，引用已跳过`）。
- **装配条件留在拓扑**：低倍率池非空才把 `DOWNLOAD_GROUPS` 交给 `evaluateCustomTopology` 装配（池空即整组缺席，指向它们的下载规则由 `prune` 按池依赖跳过）；`fallbackProxies` 的 `下载策略` 项同步改为「池存在才追加」（10.18 起该段推导已删除，改由 `@downloadGroup` 宏承接）。
- **默认产物零漂移**：默认样本无低倍率节点，`下载策略` / `负载均衡-轮询` 本就不出现，两套 golden 字节无变化；有低倍率节点的场景里，`下载策略` / 轮询出口的成员从「铺开节点」改为「引用 `低倍率节点` 组」，语义等价。
- 验证：656 条测试全绿（`aggregate-ownership` 与 `feature-policy-decouple` 的相关用例按新语义重写）。
- **意义**：这是 10.6「骨架组声明化」的第一刀——`下载策略` 与 `负载均衡-轮询` 不再由 `topology.js` 手写，而是数据层声明 + 拓扑装配。

**10.18 收口残差：方向骨架组声明化 + 池标签同源（已实施，2026-10-21）**

> 背景：10.10 / 10.14 / 10.16 留下的两条「引擎里还有手写/硬编码」的尾巴。只收敛表达方式，不改变默认产物。

- **方向骨架组声明化**：`src/config/catalog.js` 新增 `SKELETON_GROUP_DEFS`，「中国分流」与「漏网之鱼」在 `split` / `return` 两个方向下各有一份完整的成员顺序声明；`topology.js` 只按 `trafficDirection` 取变体并交给统一求值器，删掉 `cnProxies` / `fallbackProxies` 两段现场推导。用户看声明即可预测顺序。
- **两个宏承接动态成员**：`@cnCoreGroups`（`@cnCore`）= 当前活跃的大中华核心地区组，顺带消除了原实现把「澳门节点」等未建组写进成员列表的悬空；`@downloadGroup` = 低倍率池有成员时 `['下载策略']`，否则为空（与 `@residentialGroup` 同一模式）。
- **池定义与归组说明同源**：`src/data/default-pools.js` 收敛为单张 `BUILTIN_POOL_DEFS`（池身份 / 圈选条件 / 物化规格 / 归组说明同表），`buildDefaultPools` 与 `POOL_SORT_ORDER` 都由它派生；归组判定优先级保留为独立的桶序表（家宽 > 高倍率 > 低倍率 > 实验）。
- **emoji 留在展示层**：池定义只写纯组名，调试输出的展示名统一经 `presentation.decorateGroupName()` 附加 emoji，不再在数据层复制一份带图标的文案（原 `高倍率节点` / `⏬ 低倍率节点` 这类与真实组名不一致的硬编码标签随之消失）。
- **默认产物零漂移**：两套 golden 字节无变化；660 条测试全绿（新增方向变体顺序 1 例、引用激活 1 例）；`lint` / `verify:arch` / `verify:docs` 通过。
- **仍未做**：10.15 的「回国专线」方向词属命名语法特性（会改变冲突判定口径），不属于本次表达收敛，保留为待决策项。

**10.19 方向限定条目（已实施，2026-10-21）**

> 背景：方向此前只由全局 `trafficDirection` + 默认值表达。同一匹配式要在两个方向落到不同名字的组时，没有单份配置内的表达方式。

- **实施**：`routing` 条目新增 `direction: split | return`。方向不符时整条不生成，缺省 = 双向生效；对 `preset` / `service` / `rule` 三类条目统一生效。同一规则需要两个方向各自落地时写两条，每条只保留一个目标。
- **否决「条目双方案」（`to` + `returnTo`）**：`preset` / `service` 的批量语义未定义；未生效侧的目标无法 fail-closed，违背「配了就得有效」；与 `disabled` / include 并集叠加后容易出现「配了等于没配」的静默分支。
- **`groups` 同样支持 `direction`**：同名组各写一条方向声明，过滤后只生成当前方向那一条，**不引入同名仲裁**（过滤发生在装配之前）。自定义组的「一个名字、两套成员」因此不需要双方案字段。
- **校验与副作用**：
  - `validateGroups` 对**全量声明**（含未生效方向）执行，非法 `direction`、未知字段、未知宏不会等到切方向才报错；
  - `disabled: true` 仍是全局关闭，不做方向限定（跨 include 的关闭语义保持单一）；
  - 规则指向「本方向不生效」的组时，在配置期 fail-closed 报「未声明或不存在」——想让规则也分方向，同一条规则写两条各带 `direction`；
  - 默认表不含 `direction`，默认产物零漂移；新增方向测试 5 例，全量 665 条全绿。

**附：选型过程（历史，已归档为结论）**

- **背景**：六维分类诞生于硬编码时期，「一次关掉一整批」只能靠分类开关实现，故分类同时承担「用户组织方式」与「批量激活」。目录解耦后分类作为用户面必填结构应当消失，但批量关闭是真实需求，必须在新模型里有位置。判据：**新增一个服务 / 类别，是只加数据，还是又得加一段特判。**
- **否决单表**：单表把「组」与「分流」压进一张表，导致顺序语义隐式（实测：调换清单顺序会改变命中目标）、`ref` 覆写 `name` 后规则断链、聚合仲裁 326 行特判、冲突不可判。两表把顺序、目标、批量关闭三件事各归其位。
- **已确认缺陷**：P1 改名断链（`rules.js:227-228` 三段式规则原样透传）→ 由 10.4 的 `to` 解析在根上消除；P2 `meta` 指引错误与 P4 提示表二次投影 → 已修复；P3 广告开关硬编码 → 批次 3 随 `preset: ads` 数据化消除。
- **原待拍板问题的答案**：① 愿意重写配置（发版给 10.7 对照表）；② 批量关闭保留为一等公民（`preset`）；③ `customServices` 保留但扁平化；④ 聚合语义交给 `routing` 的 `service` + `to`；⑤ include 移除用 `disabled: true`。

---

