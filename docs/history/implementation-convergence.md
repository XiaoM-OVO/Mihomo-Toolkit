# 实现路径收敛记录（6 项全部闭环）

> 历史归档：本组改进已在 M3 期间全部落地，保留「改了什么、结果如何」供追溯；当前架构契约见 [ARCHITECTURE.md](../../ARCHITECTURE.md)，路线图见 [ROADMAP.md](../../ROADMAP.md)。

## 📌 候选改进：收敛实现路径（已全部落地）

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

### 6. ✅ 已完成：校验职责收敛为单一 schema 层（装载期 fail-closed）

**现状修正**：组的结构与配方校验原本在 `validateGroups`（`src/strategy/matcher.js`，装配期）；`{ ref }` / `disabled` 结构在 `src/config/groups.js`（装载期）；目标合法性在 `src/strategy/target-registry.js`（解析期）。

**结果**：新增 `src/pipeline/config-schema.js` 作为 `groups` / `routing` 的单一校验入口，在 `runStrategyPipeline` 的 `resolveConfig` 之后、清洗节点与装配之前执行（config 层不反向依赖 strategy，故入口挂在合法的 pipeline 编排层）。`topology.js` 装配期重复调用的 `validateGroups` 已删除；`routing.js` 抽出 `validateRouting`，与 `expandRouting` 共用同一实现。routing 条目补齐字段白名单、`preset / service / rule` 三选一、`disabled` / `direction` 取值、预设与服务存在性、规则目标完整性；`disabled: true` 与方向不符的条目同样全量校验（目标按条目自身 direction 的目标表解析），此前被静默吞掉的拼写错误不再漏网。`topology-engine.js` 的三处 `warn + skip`（未知宏、非法 type 静默降级 `select`、构建异常）全部改为直接抛错。错误消息统一带 `routing[i]` / `routing[i].to` 字段路径，`npm test` 701 项通过。
