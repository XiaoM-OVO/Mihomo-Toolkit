# 🏗️ Mihomo-Toolkit 架构设计白皮书与系统契约

本文档详尽阐述 Mihomo-Toolkit 的**核心架构哲学、分层隔离契约、全链路数据流转、核心拓扑算法机理及二次开发扩展规范**，作为系统演进与维护的技术标准。

---

## 🧭 一、 架构哲学与分层隔离铁律

本系统基于**洋葱模型 (Onion Architecture)** 与**无副作用函数式计算 (Pure Computational Core)** 思想设计，严格区分「纯算法内核」与「外围 IO/环境胶水」。

```text
┌────────────────────────────────────────────────────────────────┐
│ 1. Targets (多端宿主适配层)                                    │
│    CLI (mtk) │ Server (HTTP 订阅中继服务)                      │
└──────────────────────────────┬─────────────────────────────────┘
                               │ 驱动调用 (无业务逻辑，仅做参数映射)
┌──────────────────────────────▼─────────────────────────────────┐
│ 2. Pipeline (流程编排引擎)                                     │
│    config.js (全量配置) │ nodes.js (纯节点) │ report.js (审计) │
└──────────────┬──────────────────────────────────┬──────────────┘
               │                                  │
       ┌───────▼────────────┐             ┌───────▼──────────┐
       │ 3. Strategy        │             │ 4. Core          │
       │    策略组拓扑装配  │             │    节点清洗/打标 │
       │    分流规则与注册表│             │    物理去重/裂变 │
       │    DAG级联剪枝     │             │    地区/城市识别 │
       │    状态看板虚拟化  │             │    简繁中文转换  │
       └───────┬────────────┘             └───────┬──────────┘
               │                                  │
               └──────────────┬───────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 5. IO (外部世界边界 - 唯一允许副作用的底层)                      │
│    SSRF 深度拦截 │ 容灾抓取与 Stale 缓存 │ 协议 URI 与 YAML 解析 │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 6. Config (配置策略层 - 合并语义与运行期兜底)                     │
│    默认配置投影(派生自注册表) │ 配置合并器 │ 领域服务编目          │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 7. Data (只读运行基础 - 程序所有 / 用户只读)                      │
│    字段注册表(有哪些字段/默认值/合并语义/信任级) │ 安全基线词典   │
└──────────────────────────────────────────────────────────────────┘
```

### 📦 Data 与 Config 的分工（「有什么」与「改什么」）

| 层 | 回答的问题 | 归属 | 可否被 `config.yaml` / `?config=` 改写 |
| :--- | :--- | :--- | :--- |
| `src/data/` | 程序里**有什么字段**、**什么算危险** | 程序所有，随版本发布 | **不可**。基线只能被追加，永不能被削减或替换 |
| `src/config/` | 这次**调用什么、改什么** | 操作者所有 | 可信来源可改；`trust: 'local'` 的字段对 `?config=` 一律剥夺 |

这样切分的直接收益：安全基线与「危险的定义」不再参与 `Object.assign(DEFAULT_CONFIG, userConfig)` 的合并，
因此**不存在「把受保护域名清单写进配置就被远程链接摘掉」这类结构性风险**。

### 📏 配置面设计约束（四条尺子）

任何新增配置项、新增配置文件、新增文档字段，都先过这四条：

1. **唯一入口**：用户只需要认识 `config.yaml` 一个文件。需要拆的时候，用**通用的 `include`** 挂载片段，
   片段与主文件共用**同一份 schema**，不额外发明「层」的概念、也不给片段起专属文件名。
   先例：nginx `include` / git `include.path` / systemd drop-in / ESLint `extends` / 以及 **mihomo 自己的 `rule-providers`**。
   *反面教材：为一个新功能单独发明 `xxxFile` 字段并赋予它一层新的语义身份——那会让「定义有什么」这件事出现第二个真相源。*
2. **不自创词汇**：能从 mihomo 原生字段名直接透传的（`type` / `tolerance` / `interval` / `icon` / `behavior`），不要再起别名。
   判据很硬：**如果一个组的定义比直接写 mihomo 的 group 还长，这层就是负价值。**
3. **文档即真相**：`config.example.yaml` 与 `index.d.ts` 只能是**已实现字段的投影**，
   不得承诺任何尚未实现的能力。新增字段必须先在 `src/data/field-registry.js` 登记，再写文档与示例；
   反之，删掉一个实现前，先把文档里的承诺删掉。
4. **基线只读且只增不减**：安全基线归 `src/data/`，用户只能在基线之上追加，永不能削减或替换。

> 落实状态：第 4 条由 `test/data-baseline.test.js` 强制；**第 1/2/3 条由 `test/config-surface.test.js` 强制**——
> 该套件会静态扫描 `src` 的字段读取、`config.example.yaml` 的键与 `index.d.ts` 的配置接口，
> 任何「隐形字段」「空承诺」「类型缺口」都会直接让测试失败。
> 第 1 条的通用 `include` 已落地（`src/config/include.js` + `src/config/mounts.js`），
> 其回归用例同样收在 `test/config-surface.test.js`（优先级 / 并集去重 / 递归 / 环路 / fail-closed / 缓存指纹 / 远程剥夺）。

### 📎 外挂配置文件（通用 `include` 挂载）

外挂入口现已泛化为通用的 `include: ["./a.yaml", "./b.yaml"]`：片段与主文件**共用同一份 schema**，
任何配置项都能放进片段；`servicesConfigFile`（可写 `servicesConfig` 别名）作为单一文件入口继续保留。
装载逻辑集中在 [`src/config/mounts.js`](src/config/mounts.js)（路径 / 读取 / 摘要）
与 [`src/config/include.js`](src/config/include.js)（展开 / 合并）。四条基础语义已经定型：

| 语义 | 行为 | 为什么 |
| :--- | :--- | :--- |
| **路径基准** | 相对路径一律相对**引用它的文件所在目录**，在读取配置的现场转成绝对路径 | 旧实现按 `process.cwd()` 解析，换个目录启动（systemd / 定时任务）即静默失效 |
| **失败姿态** | 文件缺失 / 扩展名不支持 / 解析失败 → **显式抛错** | 旧实现静默返回 `{}`，用户只会看到「自定义服务凭空消失」 |
| **热更新** | `.js` / `.cjs` 装载前清理 `require` 缓存 | 否则长驻服务永远读不到 `.js` 挂载文件的改动 |
| **缓存参与** | 构建缓存键包含挂载文件的**内容摘要**（sha256，含递归片段） | 旧实现键里只有路径字符串，改文件在 `cacheTtl` 内不生效 |

`include` 在基础语义之上补充：

| 语义 | 行为 |
| :--- | :--- |
| **主文件优先** | 合并顺序 = `include[0] ⊕ include[1] ⊕ … ⊕ 主文件自身`，越靠后优先级越高 |
| **数组合并** | 并集去重（保留先出现的顺序，后出现的重复项丢弃） |
| **对象合并** | 深度递归合并；标量高优先级覆盖 |
| **递归 include** | 片段内可再 `include`（相对路径以该片段所在目录为基准），带环路检测与深度上限 |

`include` 声明为 `trust: 'local'`，会自动进入远程剥夺清单：`?config=` 远程配置无法借它读取本机任意文件。

### 🛡️ 架构红线 (Non-negotiable Rules)

1. **单向依赖 (Unidirectional Flow)**：
   * 依赖关系严格为：`Targets` ➔ `Pipeline` ➔ `Strategy` / `Core` ➔ `IO` ➔ `Config` ➔ `Data`。
   * **底层模块严禁以任何形式反向 import/require 高层模块**。
   * `src/data/` 是最底层：纯数据 + 纯函数，不得 require `config` / `core` / `strategy` / `io` / `pipeline` / `targets`，
     不得引用 `fs` / `http` / `net` / `process.env`（由 `test/data-baseline.test.js` 的分层红线用例强制）。
2. **纯计算隔离 (Pure Core Isolation)**：
   * `src/core/` 与 `src/strategy/` 内**严禁包含任何网络请求或磁盘读写**，必须是确定性的纯函数（相同的输入数据与配置，必须输出严格相同的结构）。
   * 所有的网络交互与文件读取，只能存在于 `src/io/`（外部世界边界）、`src/config/`（配置装载，`mounts.js` 是唯一的外挂文件读取点）或最外层的 `src/targets/`。
3. **平台中立性 (Universal Compatibility)**：
   * 核心流水线不依赖特定宿主环境变量（避免在核心层直接读取 `process.argv` 或 Node 原生专属 C++ 模块），以便可移植至浏览器控制台、脚本沙箱及轻量运行时。

---

## 🎯 二、 统一交付矩阵 (Delivery Matrix)

系统采用**以目标交付物（Output Delivery）驱动的工作流模型**。调度引擎根据请求的交付形态（`outputMode`），在流水线的对应检查点（Checkpoint）截断并产出目标规格数据：

```text
                      外部输入 (CLI mtk / Server / SDK)
                                     │
                                     ▼
                     ┌───────────────────────────────┐
                     │    src/pipeline/engine.js     │ ➔ 配额校验、结构化缓存键与 LRU 缓存
                     │     (全生命周期工作流总调度)  │
                     └───────────────┬───────────────┘
                                     │
                                     ▼
                         [Step 1: 订阅抓取与解析]
                                     │
                                     ▼
                        [Step 2: 节点标准化与打标]
                                     │
                     ┌───────────────┴───────────────┐
                     │ 交付模式 Checkpoint 检查点分流│
                     └───────────────┬───────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
       [mode == 'nodes']      [mode == 'report']     [mode == 'config']
              ▼                      ▼                      ▼
      【Checkpoint 1: 节点截断】 【Checkpoint 2: 报告截断】 【Checkpoint 3: 贯通交付】
              │                      │                      │
              ▼                      ▼                      ▼
       直接包装交付纯节点      调用 report.js 生成审计   调用 config.js 组装策略拓扑
       { proxies: [...] }     输出 report JSON 数据   输出即用型完整 YAML 配置
```

| 交付模式 (`outputMode`) | 核心契约 (Contract) | 关键行为与边界 | 典型场景 |
| :--- | :--- | :--- | :--- |
| **`config`**<br>*(默认全量交付)* | 交付完整可直接交付内核运行的 Mihomo YAML 配置。产物顶层键**只能由本工具生成**（交付契约白名单，fail-closed）。 | 1. 采用「智能节点资产依赖保活沙箱」，自动继承节点专属的 Hosts（CDN 优选）与 Nameserver-Policy（私有 DoH），动态将节点域名注入 fake-ip-filter 防环路；闭包强度可用 `assetClosure` 调为 `strict` / `off`。<br>2. **交付契约双重保证**：生成前重置工具自有键 + 交付前白名单收口，因此订阅携带的 `port` / `allow-lan` / `tunnels` / `external-controller` / `secret` / `script` / `geox-url` 等字段以及任何未登记字段都不可能进入产物（即使对应的覆写开关被关闭也不会残留）。<br>3. 全自动执行节点清洗、看板合成、六维策略组装配、分流规则集与内核优化调优。<br>4. 交付前执行 DNS INV-1~INV-9 不变式自检，违规项写入 `result.invariantViolations` 并打印告警。 | 软路由、Clash Verge、Mihomo 服务端部署。 |
| **`nodes`**<br>*(纯净节点交付)* | 契约绝对纯粹：**仅输出干净的 `{ proxies: [...] }` 列表**。 | 执行物理去重、广告与垃圾拦截、属性提取、地区识别与重命名。**严禁输出任何策略组或外围规则**（即使输入自带 rules 也坚决剥离）。 | Sub-Store 节点管理、自建节点池维护。 |
| **`report`**<br>*(健康审计交付)* | 交付标准格式的清洗与质量审计报告 (JSON)。 | 统计输入总数、有效保留数、去重剔除数、广告拦截数、未知地区数、裂变产生数，输出结构化健康评估指标。 | CI/CD 自动化质检、机场节点质量监控。 |

---

## ⚙️ 三、 核心关键引擎机理深度解析

### 1. 物理网络指纹去重与传输层统一适配 (`src/core/transport.js` & `src/core/dedupe.js`)
* **设计考量**：若仅依据节点名称（`proxy.name`）去重，当订阅源对同一服务器赋予不同营销别名（如“香港专线01”、“香港VIP01”）时，会导致配置冗余并在故障转移时产生无意义切换；若各模块分散处理协议字段，会因代码散落引发现代传输层协议（H2、HttpUpgrade 等）的支持盲区。
* **实现机理**：
  建立单一事实来源 `transport.js`，统一提取底层传输特征构建唯一的物理指纹串：
  $$\text{Fingerprint} = \text{Server} + \text{Port} + \text{Type} + \text{Network} + \text{SNI} + \text{Host} + \text{Path} + \text{AuthKey}$$
  相同网络指纹的节点仅保留首次出现的合法项，并在统计中记录 `dedupeCount`；同时集中为节点裂变引擎提供全传输层 Host/SNI 自动补全注入能力。

### 2. DAG 级联空组剪枝与规则殉葬机制 (`src/strategy/prune.js`)
* **设计考量**：在多层策略组嵌套中（例如：`🎯 全球直连` ➔ `🤖 ChatGPT` ➔ `🇺🇸 美国节点`），当输入节点池缺少某地区节点时，底层策略组变为空组。若直接写入配置会引发内核报错；若仅粗暴移除该组，引用该组的父策略组及分流规则（`RULE-SET,chatgpt,🤖 ChatGPT`）将产生悬空引用。
* **算法实现**：
  采用有向无环图 (DAG) 递归斩首算法，设定最大迭代深度限制（防环）：
  1. **正向标记**：扫描所有策略组，若某组引用的物理节点列表为空，且所嵌套的子组也全为空，标记为“死组”；
  2. **级联收割**：从父策略组的 `proxies` 列表中剔除该死组名称；若父组因此也变为空组，则将父组纳入死亡名单；
  3. **规则殉葬 (Rule Martyrdom)**：遍历全量路由分流规则（`rules`），一旦发现某条规则指向的目标策略组已被剪枝消亡，该规则自动殉葬注销，防止客户端流量路由至空黑洞。

```text
[节点池无美国节点] 
       │
       ▼
 [🇺🇸 美国节点] (空) ──▶ [标记死亡，斩首剔除]
       │
       ▼
 [🤖 ChatGPT] 策略组从成员中剔除 [🇺🇸 美国节点]
       │
       ▼
 [分流规则] RULE-SET,chatgpt,🤖 ChatGPT (若组存活则保留，若组消亡则整条规则注销)
```

### 3. 多订阅到期时间与状态看板聚合算法 (`src/strategy/dashboard.js`)
* **流量聚合防污染**：遍历所有有效订阅源，识别其 HTTP 响应头中的 `subscription-userinfo`。已过期的订阅**自动剔除出综合流量统计池**，防止把已经失效套餐的幽灵流量算进全局可用总额。
* **到期预警策略矩阵 (`expireAggregation`)**：
  * `min`（默认/推荐）：优先计算最早失效的订阅到期日，为断供留出安全边际；全过期时取最近历史失效时间。
  * `max`：取所有有效源中最晚到期日（适合多长效保号套餐）。
  * `first`：严格遵循首个订阅源状态。
* **双列网格高颜值虚拟看板**：
  在节点列表顶部自动合成 `isSyntheticInfo: true` 的不可连通虚拟占位节点，完美契合客户端常见的 2 列网格排版：
  * 左列：`📈 [全局] 剩余流量：128.50 GB / 500.00 GB (25.7%)`
  * 右列：`⌛ [全局] 临近到期：2026-12-31 (余 280 天)`
  * 当某订阅拉取失败时，自动注入醒目的错误节点：`❌ [机场A] 拉取失败：HTTP 502`。

### 4. 网络容灾与三态抓取调度器 (`src/io/fetcher.js`)
* **SSRF 纵深防御**：
  在请求前置阶段，对 URL 进行协议校验（仅放行 http/https）、私网网段与保留地址拦截；通过 DNS 预解析对目标 IP 实施动态私网回环（127.0.0.1、192.168.x、10.x、169.254.x）拦截，防止针对内网服务的探测攻击。
  **重定向逐跳复核**：使用 `redirect: 'manual'` 自行接管跳转循环，每一跳都重新执行完整 SSRF 校验（而非只校验初始 URL）。
  **残余风险（如实告知）**：校验时的 DNS 解析与实际建连的解析是两次独立查询，存在 TOCTOU / DNS Rebinding 窗口，当前实现未做 IP 固定（pinning）。
* **响应限长**：以流式读取累加字节数，超限立即中止（`maxBytes`，默认单订阅 8MB / 远程配置 1MB），避免恶意超大响应体耗尽内存。
* **智能可重试机制**：
  区分确定性错误与瞬时抖动：
  * HTTP 4xx（如 401 Unauthorized、404 Not Found）➔ 确定性错误，**立即放弃，绝不无效重试**；
  * HTTP 5xx、网络中断、DNS 超时 ➔ 自动执行指数退避重试（Backoff Retry）。
* **Stale 兜底容灾缓存**：
  为每个订阅维护最近一次成功拉取的内存快照。若某次远程拉取彻底失败且容灾周期未过期（`fetchStaleTtl`，默认 24h），自动降级复用上一轮有效内容，并打印黄色告警。**确保下游用户设备上的节点绝不因为机场暂时抽风而全军覆没**。

### 5. 三层纵深安全网关 (`src/core/security/`)
* **设计考量**：
  外部机场订阅本质上属于不可信第三方输入。传统“全盘透传”存在致命隐患：订阅可借由 `external-controller` 和 `secret` 窃取内核 API 控制权、利用 `allow-lan` 将客户端暴露为公网开放代理、通过 `geox-url` 投毒反转全量 GEOIP 分流。同时，直接一刀切剥离全部私有字段又会导致依赖私有 DoH 或 CDN 优选 Hosts 的节点无法连通。
* **三层机制（按数据流顺序）**：

  1. **不可信配置能力剥夺（`remote-config.js`，纯函数）**
     服务端 `?config=` 拉取的远程配置属于不可信输入：仅允许引用 http(s) 订阅源（杜绝借本地路径读取服务器任意文件），并剥夺 DNS 控制面（`dnsListen`/`dnsDirect`/`dnsProxy`/`nameserverPolicy`/`hosts`/`fakeIpFilter`…）与本地资源（`servicesConfigFile`、`include`、`fetchProxyPort`）类字段。
     *剥夺清单**由只读数据层派生**：`src/data/field-registry.js` 中声明 `trust: 'local'` 的字段自动进入清单，
     别名输入字段来自 `ALIAS_REMOTE_DENIED_FIELDS`。新增安全开关只需标注信任级，不存在「忘了同步清单」的漂移空间。*
     *库契约：`buildProfile(userConfig)` 的 `userConfig` 视为可信输入；处理不可信配置的调用方必须先经 `hardenRemoteConfig()` 降级。*

  2. **控制面净化审计 + 节点资产闭包（`control-plane.js::partitionControlPlane` + `io/sub-processor.js::applySubscriptionGuards`）**
     字段按「数据面（`proxies` / `proxy-providers`）｜控制面｜攻击特征签名｜未登记字段（fail-closed）」分类并审计；
     多订阅与单 URL/本地文件**两条输入路径共用同一网关**，避免净化逻辑分叉。
     同时执行 **Dependency Tracing**：只收编指向自身节点资产域的 Hosts / Nameserver-Policy / Fake-IP-Filter，
     严格排除 `sni`/`servername` 伪装域名，并拒绝受保护公网域名与内网重定向。
     闭包强度可配置：`standard`（默认）｜`strict`（仅 `assetDomainAllowlist`）｜`off`（完全不继承）。

  3. **交付契约白名单收口（`control-plane.js::resetToolkitOutputKeys` / `enforceOutputContract`）**
     产物顶层键只允许工具自有的 15 个键（`proxies`/`proxy-groups`/`rules`/`rule-providers`/`dns`/`hosts`/`ipv6`/`tun`/`sniffer`/`profile` 及 4 个内核性能键）。
     生成前重置 + 交付前收口，任何路径遗漏净化都会被这一层兜住（fail-closed）。
     *注：`proxy-providers` 刻意不在白名单内 —— 它会让内核在运行时从外部 URL 拉取节点，属于不可审计的运行时数据面来源。*

* **Bootstrap 破死锁与 Fake-IP 避环智能聚合 (`dns-sanitizer.js` + `strategy/dns.js`)**：
  强制规范 `default-nameserver` 与 `proxy-server-nameserver` 100% 纯 IP 引导；从节点池动态推导节点服务器域名并进行**智能主域泛化聚合（如折叠为 `+.lxyun.xyz`）**注入 `fake-ip-filter`，彻底杜绝 Fake-IP 虚拟自环，同时规避海量子域名膨胀与伪装 SNI 污染。
  解析链与 `nameserver-policy` 同样过净化沙箱（剥离 `#skip-cert-verify` 等危险修饰符、拦截私网与 fake-ip 自环地址、保留键不可被覆盖），`dns.listen` 非回环一律回退（需 `dnsAllowNonLoopback: true` 显式放行）。
* **INV 不变式自检（`resolver-plan.js::checkInvariants`）**：
  INV-1~INV-9 在 `config` 交付路径中实际执行，违规项写入 `result.invariantViolations` 并打印告警。

---

## 📂 四、 目录职责与代码地图

```text
E:\CODE\mihomo-toolkit-next\
├── src/
│   ├── index.js                  # 🌟 全库顶层唯一门面 (Facade)，对外导出完整公共 API
│   │
│   ├── pipeline/                 # 🚀 交付流水线 (与交付形态 1:1 映射)
│   │   ├── engine.js             # runPipelineEngine: 总调度引擎，按 Checkpoint 截断控制交付
│   │   ├── config.js             # runConfigPipeline: 交付完整 config (智能资产保活沙箱)
│   │   ├── nodes.js              # runNodesPipeline: 交付纯净节点 proxies 数组
│   │   ├── report.js             # buildAuditReport: 交付结构化健康审计 JSON
│   │   └── strategy.js           # runStrategyPipeline: 纯策略组与分流拓扑组装流水线
│   │
│   ├── targets/                  # 🔌 宿主环境终端适配器 (仅做参数与调用封装)
│   │   ├── cli.js                # CLI 入口 (支持 mtk / mihomo-tk / mihomo-toolkit)
│   │   └── server.js             # 常驻 HTTP 订阅服务 (/sub, /healthz, Token 鉴权, 默认回环监听, 并发上限)
│   │
│   ├── core/                     # 🧮 节点清洗核心算法层 (Pure & Deterministic)
│   │   ├── security/             # 🛡️ 安全沙箱与仲裁核心 (纯函数安全网关)
│   │   │   ├── control-plane.js  # 控制面分类审计、交付契约白名单与生成前重置
│   │   │   ├── remote-config.js  # 不可信远程配置能力剥夺 (本机资源 / DNS 控制面)
│   │   │   ├── dns-sanitizer.js  # DNS 净化沙箱、DoH 修饰符分级剥离与 Hosts 审计
│   │   │   └── resolver-plan.js  # INV 不变式自检 + Fake-IP 域名聚合
│   │   ├── cleaner.js            # 垃圾拦截、倍率线路提取、属性智能分类打标
│   │   ├── dedupe.js             # 底层物理网络指纹提取与特征去重
│   │   ├── transport.js          # 统一传输层门面 (Host/SNI/Path提取、Host注入与类型识别)
│   │   ├── geo.js                # 地区智能正则匹配与落地城市精准提取
│   │   ├── rename.js             # 模板变量解析、Emoji 注入与悬空分隔符安全擦除
│   │   ├── fission.js            # 域名并发 DNS 解析与多 IP 独立节点裂变增殖
│   │   ├── chinese-convert.js    # 简繁中文递归转换与无依赖回退降级
│   │   ├── chinese-sync.js       # 节点名/策略组名/成员引用/分流规则四路简繁同步
│   │   ├── logger.js             # 终端着色日志、子作用域继承与敏感凭证脱敏
│   │   └── shared/               # Core 共享纯工具：地区字典 (regions.js)、图标字典 (icons.js)、
│   │                             # IP 分类 (ip.js)、订阅元信息解析 (sub-info.js)
│   │
│   ├── strategy/                 # 🌐 策略组拓扑与内核优化层
│   │   ├── dashboard.js          # 看板合成、多订阅流量与到期聚合中心
│   │   ├── topology.js           # 六维服务大区折叠与动态测速策略组装配
│   │   ├── rules.js              # 规则集 (Rule-Providers) 与分流路由组装
│   │   ├── registries.js         # 六维服务注册表向前兼容委托适配器 (委托至 config/catalog)
│   │   ├── prune.js              # DAG 递归空组级联淘汰与殉葬规则清理
│   │   ├── presentation.js       # 展示层终末装配器 (按 groupIconMode 统一挂载在线图标与赋予徽标)
│   │   ├── dns.js                # Fake-IP / DoH 防泄漏 DNS 方案覆写注入
│   │   └── kernel.js             # TUN 网卡、Sniffer 嗅探器及内核性能调优
│   │
│   ├── io/                       # 📡 外部世界通信层 (唯一允许副作用的底层)
│   │   ├── fetcher.js            # 安全 HTTP 抓取调度、逐跳重定向校验、响应流式限长与 Stale 容灾兜底缓存
│   │   ├── sub-processor.js      # 多订阅并发抓取、统一安全网关(净化审计+资产闭包)、树状日志
│   │   ├── cache.js              # 内存级 LRU-TTL 缓存管理器 (带 MAX_ENTRIES 防泄漏；缓存键由 engine 结构化生成)
│   │   ├── ssrf.js               # SSRF 深度校验、私网拦截与 Token 脱敏
│   │   ├── limits.js             # 资源超限拦截 (URL 上限、配置大小、响应限长、节点总量与单订阅配额)
│   │   ├── dns-resolver.js       # 系统原生与 DoH 异步安全解析器 (防污染/裂变支撑)
│   │   ├── fetch-proxy.js        # 本地代理调度封装 (undici ProxyAgent)
│   │   └── parsers/              # 协议解析器注册表与全格式解析体系
│   │       ├── registry.js       # 协议解析器注册表 (Registry Pattern)
│   │       ├── index.js          # 统一调度入口 (Base64 / 多协议 URI / YAML)
│   │       ├── base64.js         # 跨运行时 Base64 / URI 编解码与主机名规整
│   │       ├── sub-info.js       # 订阅 Subscription-Userinfo 标头解析 (re-export core/shared/sub-info)
│   │       └── *.js              # 各协议解析器 (vless, vmess, trojan, ss, hy2, tuic, socks, http)
│   │
│   ├── config/                   # ⚙️ 配置策略层 (操作者改什么)
│   │   ├── defaults.js           # 出厂默认配置（由字段注册表派生，不再手写清单）
│   │   ├── catalog.js            # 🌟 领域服务编目 (SSOT)、六维内置基准与增量深度合并引擎
│   │   ├── include.js            # 通用配置片段挂载：include 展开 / 主文件优先合并 / 环路与深度防护
│   │   └── index.js              # resolveConfig 合并器：注册表驱动的「只增不减」基线合并 + 外部服务配置挂载
│   │
│   └── data/                     # 📦 只读运行基础层 (最底层，程序所有 / 用户只读)
│       ├── field-registry.js     # 字段注册表 SSOT：字段名 / 默认值 / 类型 / 合并语义 / 信任级
│       └── security-baselines.js # 安全基线词典：受保护域名、骨架豁免组、fake-ip-filter 保底名单
│
├── test/                         # 🧪 自动化测试套件 (25 个测试文件，202 个全绿用例)
│                                 #    其中 security-delivery-contract / dns-invariants /
│                                 #    server-security / security-sanitizer / data-baseline /
│                                 #    config-surface 为安全与契约回归套件
├── config.example.yaml           # 极简扁平化配置模板
├── index.d.ts                    # 完整 TypeScript 类型契约声明
├── package.json                  # 项目依赖与多命令配置
└── ARCHITECTURE.md               # 本系统架构白皮书
```

---

## 🛠️ 五、 二次开发与扩展指引 (Extension Guide)

### 1. 新增一个地区或落地城市识别* 打开 [`src/core/shared/regions.js`](src/core/shared/regions.js)：
  * 在 `REGION_DEFS_RAW` 数组中添加条目：
    ```javascript
    {
      id: 'IS',
      name: '冰岛',
      icon: '🇮🇸',
      pattern: '冰岛|Iceland|IS|雷克雅未克',
      city: '雷克雅未克'
    }
    ```
  * `geo.js` 会在运行时自动完成最长前缀匹配与正则预编译，并在拓扑阶段自动为其建立专属大区与测速组。

### 2. 新增或自定义服务（如：自建 DeepSeek 或私有流媒体）
系统采用统一的 **Service Catalog** 事实来源体系，支持两种扩展方式：

* **方式 A：通过用户配置无侵入扩展 (推荐)**
  在 `config.yaml` 中配置 `customServices` 或外挂 `servicesConfigFile: "./services.config.js"`：
  ```yaml
  enableAI: true
  aiServices:
    - chatgpt
    - deepseek
  customServices:
    ai:
      deepseek:
        name: "DeepSeek"
        emoji: "🧠"
        reg: "/\\b(?:DeepSeek|DS|深度求索)\\b/i" # 支持正则字符串或纯文本
        rules: "deepseek"                      # 自动映射 geosite/deepseek
        icon: { repo: "koolson", file: "AI.png" }
  ```
  引擎会自动完成**增量继承（Delta Merge）**、正则安全编译、节点特征清洗打标、Emoji 重命名渲染、策略组装配与规则集生成。

* **方式 B：在源码层扩充官方内置基线**
  打开 [`src/config/catalog.js`](src/config/catalog.js)，在 `BUILTIN_SERVICES` 对应分类下声明标准契约，全局自动生效。

### 3. 新增一种协议的 URI 解析器
* 在 [`src/io/parsers/`](src/io/parsers/) 下新建解析模块：
  * 实现标准签名：`parseXxxUri(uri: string): ProxyNode | null`
  * 在 `src/io/parsers/index.js` 中使用 `registerParser('myproto', parseXxxUri)` 动态挂载到协议注册表（天然支持别名与分发）。

### 4. 新增 / 修改一个配置字段（⚠️ 别再多处手抄）
字段的**默认值只说一次**，就在 [`src/data/field-registry.js`](src/data/field-registry.js)：

```javascript
{ key: 'myKnob', type: 'boolean', default: false, merge: 'override', trust: 'any',
  group: '基础全局配置', doc: '这个开关干什么' }
```

* `DEFAULT_CONFIG` 由注册表**派生**，不需要（也不允许）再去 `defaults.js` 抄一遍；
* 字段若与安全相关（被误改后得利的是攻击者），标 `trust: 'local'` —— 它会**自动**进入 `?config=` 的剥夺清单；
* 需要「只读基线 + 用户追加」语义时，用 `merge: 'additive'` + `baseline`（放在 `security-baselines.js`）+ `normalize`；
  并在**判定点**用 `effectiveProtectedDomains()` / `effectiveExemptGroups()` 自持基线，避免编排层漏做合并而 fail-open；
* 故意改动任何默认值，都必须同步更新 `test/fixtures/default-config.golden.json`，让改动显式出现在 diff 里；
* 最后同步 [`config.example.yaml`](config.example.yaml) 与 [`index.d.ts`](index.d.ts)。

### 5. 追加自己的受保护域名 / 骨架豁免组（用户视角）
* `protectedDomains: ["mybank.example"]`：在只读安全基线之外**追加**禁止被 hosts 覆盖的域名（子域自动覆盖）。
* `exemptGroups: ["🏠 家宽优选"]`：在只读骨架基线之外**追加**永不被空组剪枝斩首的策略组。
* 两者都是**只增不减**：基线不可被配置文件删除或替换，写 `[]` 也不会降低保护；
  条目会归一化（域名：小写、忽略 `+.`/`*.` 前缀与首尾点），非法条目丢弃并打印告警，不会静默 fail-open。

---

## 🛡️ 六、 开发质量守则

任何针对本工程的 PR 或重构，必须满足以下五项硬性准则：
1. **测试不破**：改动后执行 `npm test`，全量 195 个测试必须 100% 通过；
2. **类型对齐**：若改动了公共接口、配置项或参数，必须同步修正 [`index.d.ts`](index.d.ts)，并通过 `npx --yes typescript --noEmit index.d.ts` 检查；
3. **架构不劣化**：绝不允许在 `src/core/` 或 `src/strategy/` 中引入带有网络/文件副作用的调用；
4. **交付契约不破**：`config` 交付形态的产物顶层键必须全部落在 `TOOLKIT_OUTPUT_KEYS` 白名单内。任何新增顶层字段都必须先登记进白名单，并补一条 `test/security-delivery-contract.test.js` 断言；
5. **安全回归不可删**：`security-delivery-contract` / `dns-invariants` / `server-security` / `security-sanitizer` / `ssrf` / `data-baseline` 六个套件是历史漏洞与安全姿态的防复发护栏，只允许加强，不允许弱化或删除；修复安全问题时必须同时补一条能复现原漏洞的用例。
6. **文档不吹牛**：文档、类型声明与配置示例里出现的每一个配置字段，都必须能在 `src/` 里找到**读取它的代码**。
   禁止出现「文档承诺了、代码里不存在」的字段；也禁止出现「代码在读、任何地方都查不到」的隐形字段。
   两者都是历史遗留问题（见 §七 残余风险），新增内容不得重蹈。

---

## 📌 七、 信任边界与残余风险（如实声明）

### 信任分级

| 输入来源 | 信任级 | 允许的能力 |
| :--- | :--- | :--- |
| 本地 `config.yaml` / `-c` | 可信 | DNS 控制面、本机资源、策略编排全量能力 |
| CLI `-u <本地文件>` | 可信（操作者显式指定） | 同上 |
| 机场订阅（远程 URL / 内联 `uri`） | 不可信 | 仅节点数据面；控制面字段剥离 |
| 服务端 `?config=<远程URL>` | 不可信 | 仅订阅源 + 策略编排偏好（经 `hardenRemoteConfig`） |

`buildProfile(userConfig, options)` 的 `userConfig` 按契约视为**可信**输入；SDK 调用方若需处理来自网络或他人分享的配置，必须先调用 `hardenRemoteConfig()`。

### 残余风险清单（设计上已知，不做过度承诺）

1. **受保护域名清单为枚举式**（`src/data/security-baselines.js::PROTECTED_DOMAINS`）：无法穷尽长尾域名。非清单域名只要被订阅声明为节点 `server`，即可为其下发 hosts 映射。
   处置：用 `protectedDomains` **追加**自己的关键域名（只增不减，`?config=` 无法写入），或 `assetClosure: strict` + `assetDomainAllowlist`，或 `assetClosure: off`。
2. **SSRF 存在 TOCTOU 窗口**：校验与建连各做一次 DNS 解析，未做 IP pinning；对抗恶意 DNS 服务器时理论上可利用。
3. **`?config=` 能力剥夺为黑名单式**：未来内核新增的控制面字段不会自动被剥夺；公开部署应使用 `enableUrlParams: false` 或强制 `authToken`。
4. **构建缓存为 TTL 语义**（`enableCache` / `cacheTtl`）：`profileCache` 的键已**结构化覆盖**全部配置字段（含 `hosts` / `dns*` / `nameserverPolicy` / 以及未来新增的任何开关）与生效订阅描述，键序无关且以 SHA-256 定长摘要存储（订阅 URL / Token 不以明文驻留内存键）；无法确定性序列化（如循环引用）时返回 `null` 直接放弃缓存。仍未覆盖的是**订阅远端内容**的更新：TTL（默认 300s）内机场改动节点，缓存会继续复用旧快照，需要实时性请下调 `cacheTtl` 或使用 `noCache`。
5. **配置面已完成一轮「字段清账」**（本轮）：
   * 原 7 个**隐形字段**（`geositeRepo` / `geoipRepo` / `devServices` / `processDirectMac|Lin` / `processProxyMac|Lin`）
     与 4 个节点裂变字段已登记进注册表，并补齐 `index.d.ts` 类型与示例说明；
   * 原 20 个**空承诺**（`blockKeywords` / `blockServers` / `serverHost` / `enableIpEnrich` 等 7 个 ipEnrich 字段 /
     `enableTlsOptimizations` / `customProxyGroups` / `dnsMergeMode` / `humanReport` …）已从文档与类型中**撤回**，
     不再存在于任何契约中（将来若要实现，按新字段重新登记）；
   * 注册表从 83 个字段扩到 124 个，`index.d.ts` 覆盖率达到 100%；
   * 三道防线已自动化：反隐形 / 反空承诺 / 反漂移（见 `test/config-surface.test.js`）。
   * **仍然存在的能力缺口（非缺陷，属路线图）**：
     * 服务需同时写进 `customServices` 与激活列表（`aiServices` 等）才生效，只写一处会静默不激活；
     * **无法新建自定义策略组**——`customNodeGroups` 只能把节点塞进已有组，自建组需等声明式组模型（2.x 路线图）。
