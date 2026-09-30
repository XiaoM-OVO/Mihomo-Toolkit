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
│ 6. Config (单一事实来源 Source of Truth)                         │
│    全局默认配置字典 │ 配置扁平合并器 │ 字典常量表                │
└──────────────────────────────────────────────────────────────────┘
```

### 🛡️ 架构红线 (Non-negotiable Rules)

1. **单向依赖 (Unidirectional Flow)**：
   * 依赖关系严格为：`Targets` ➔ `Pipeline` ➔ `Strategy` / `Core` ➔ `IO` ➔ `Config`。
   * **底层模块严禁以任何形式反向 import/require 高层模块**。
2. **纯计算隔离 (Pure Core Isolation)**：
   * `src/core/` 与 `src/strategy/` 内**严禁包含任何网络请求或磁盘读写**，必须是确定性的纯函数（相同的输入数据与配置，必须输出严格相同的结构）。
   * 所有的网络交互与文件读取，只能存在于 `src/io/` 或最外层的 `src/targets/`。
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
                     │    src/pipeline/engine.js     │ ➔ 配额校验、LRU 缓存管理
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
| **`config`**<br>*(默认全量交付)* | 交付完整可直接交付内核运行的 Mihomo YAML 配置。 | 1. 采用「智能节点资产依赖保活沙箱」，自动继承节点专属的 Hosts（CDN 优选）与 Nameserver-Policy（私有 DoH），动态将节点域名注入 fake-ip-filter 防环路。<br>2. 物理剥离订阅中一切外部端口（port）、监听面（allow-lan）、反向隧道（tunnels）与 API 夺权字段（external-controller/secret），控制面保持纯净与安全。<br>3. 全自动执行节点清洗、看板合成、六维策略组装配、分流规则集与内核优化调优。 | 软路由、Clash Verge、Mihomo 服务端部署。 |
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
* **智能可重试机制**：
  区分确定性错误与瞬时抖动：
  * HTTP 4xx（如 401 Unauthorized、404 Not Found）➔ 确定性错误，**立即放弃，绝不无效重试**；
  * HTTP 5xx、网络中断、DNS 超时 ➔ 自动执行指数退避重试（Backoff Retry）。
* **Stale 兜底容灾缓存**：
  为每个订阅维护最近一次成功拉取的内存快照。若某次远程拉取彻底失败且容灾周期未过期（`fetchStaleTtl`，默认 24h），自动降级复用上一轮有效内容，并打印黄色告警。**确保下游用户设备上的节点绝不因为机场暂时抽风而全军覆没**。

### 5. 控制面净化沙箱与节点专属资产闭包 (`src/core/security/`)
* **设计考量**：
  外部机场订阅本质上属于不可信第三方输入。传统“全盘透传”存在致命隐患：订阅可借由 `external-controller` 和 `secret` 窃取内核 API 控制权、利用 `allow-lan` 将客户端暴露为公网开放代理、通过 `geox-url` 投毒反转全量 GEOIP 分流。同时，直接一刀切剥离全部私有字段又会导致依赖私有 DoH 或 CDN 优选 Hosts 的节点无法连通。
* **算法与闭包机制**：
  1. **控制面与数据面物理隔离 (`control-plane.js`)**：
     白名单限制 `DATA_PLANE_KEYS`（仅 `proxies` / `proxy-providers` 可跨源聚合）。所有控制面键与攻击特征签名（`HOSTILE_SIGNATURES`）在接入点即刻完成审计与剥离。
  2. **节点专属资产域推导 (Dependency Tracing)**：
     系统自动从节点属性（`server`, `sni`, `servername`）及订阅源提取资产域名集合；对订阅携带的 `hosts` 与 `nameserver-policy` 进行**作用域匹配**：仅放行指向自身节点资产域名的优选 IP 与私有 DoH，严禁越权劫持公共高危域名（`github.com`, `apple.com`, `google.com`, `alipay.com` 等）。
  3. **Bootstrap 破死锁与 Fake-IP 避环 (`dns-sanitizer.js` & `resolver-plan.js`)**：
     强制规范 `default-nameserver` 与 `proxy-server-nameserver` 100% 纯 IP 引导；从节点池动态提取节点域名注入 `fake-ip-filter`，彻底杜绝 Fake-IP 虚拟自环与解析连环死锁。

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
│   │   ├── strategy.js           # runStrategyPipeline: 纯策略组与分流拓扑组装流水线
│   │   └── index.js              # 流水线统一导出入口
│   │
│   ├── targets/                  # 🔌 宿主环境终端适配器 (仅做参数与调用封装)
│   │   ├── cli.js                # CLI 入口 (支持 mtk / mihomo-tk / mihomo-toolkit)
│   │   └── server.js             # 常驻 HTTP 订阅服务 (/sub, /healthz, Token 鉴权)
│   │
│   ├── core/                     # 🧮 节点清洗核心算法层 (Pure & Deterministic)
│   │   ├── security/             # 🛡️ 安全沙箱与仲裁核心 (纯函数安全网关)
│   │   │   ├── control-plane.js  # 控制面剥离、夺权特征拦截与 Master 仲裁
│   │   │   ├── dns-sanitizer.js  # DNS 净化沙箱、DoH 修饰符剥离与 Hosts 审计
│   │   │   └── resolver-plan.js  # 解析链规划器、节点避环与 INV 内核不变式自检
│   │   ├── cleaner.js            # 垃圾拦截、倍率线路提取、属性智能分类打标
│   │   ├── dedupe.js             # 底层物理网络指纹提取与特征去重
│   │   ├── transport.js          # 统一传输层门面 (Host/SNI/Path提取、Host注入与类型识别)
│   │   ├── geo.js                # 地区智能正则匹配与落地城市精准提取
│   │   ├── rename.js             # 模板变量解析、Emoji 注入与悬空分隔符安全擦除
│   │   ├── fission.js            # 域名并发 DNS 解析与多 IP 独立节点裂变增殖
│   │   ├── chinese-convert.js    # 简繁中文递归转换与无依赖回退降级
│   │   ├── chinese-sync.js       # 节点名/策略组名/成员引用/分流规则四路简繁同步
│   │   ├── logger.js             # 终端着色日志、子作用域继承与敏感凭证脱敏
│   │   └── shared/               # 地区大区字典表 (regions.js) 与 图标字典 (icons.js)
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
│   │   ├── fetcher.js            # 安全 HTTP 抓取调度与 Stale 容灾兜底缓存
│   │   ├── sub-processor.js      # 多订阅并发抓取、URI 分流、单订阅说明过滤与树状日志
│   │   ├── cache.js              # 内存级 LRU-TTL 缓存管理器 (带 MAX_ENTRIES 防泄漏)
│   │   ├── ssrf.js               # SSRF 深度校验、私网拦截与 Token 脱敏
│   │   ├── limits.js             # 资源超限拦截 (URL 上限、配置大小、节点总数防御)
│   │   ├── dns-resolver.js       # 系统原生与 DoH 异步安全解析器 (防污染/裂变支撑)
│   │   ├── fetch-proxy.js        # 本地代理调度封装 (undici ProxyAgent)
│   │   └── parsers/              # 协议解析器注册表与全格式解析体系
│   │       ├── registry.js       # 协议解析器注册表 (Registry Pattern)
│   │       ├── index.js          # 统一调度入口 (Base64 / 多协议 URI / YAML)
│   │       ├── base64.js         # 跨运行时 Base64 / URI 编解码与主机名规整
│   │       ├── sub-info.js       # 订阅 Subscription-Userinfo 标头解析与到期计算
│   │       └── *.js              # 各协议解析器 (vless, vmess, trojan, ss, hy2, tuic, socks, http)
│   │
│   └── config/                   # ⚙️ 配置中心 (单一事实来源 Source of Truth)
│       ├── defaults.js           # 系统内置全局默认配置字典
│       ├── catalog.js            # 🌟 领域服务编目 (SSOT)、六维内置基准与增量深度合并引擎
│       └── index.js              # resolveConfig 配置合并器与外部服务配置文件挂载
│
├── test/                         # 🧪 自动化测试套件 (19 个测试套件，133 个全绿用例)
├── config.example.yaml           # 极简扁平化配置模板
├── index.d.ts                    # 完整 TypeScript 类型契约声明
├── package.json                  # 项目依赖与多命令配置
└── ARCHITECTURE.md               # 本系统架构白皮书
```

---

## 🛠️ 五、 二次开发与扩展指引 (Extension Guide)

### 1. 新增一个地区或落地城市识别
* 打开 [`src/core/shared/regions.js`](src/core/shared/regions.js)：
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

---

## 🛡️ 六、 开发质量守则

任何针对本工程的 PR 或重构，必须满足以下三项硬性准则：
1. **测试不破**：改动后执行 `npm test`，全量 133 个测试必须 100% 通过；
2. **类型对齐**：若改动了公共接口、配置项或参数，必须同步修正 [`index.d.ts`](index.d.ts)，并通过 `npx --yes typescript --noEmit index.d.ts` 检查；
3. **架构不劣化**：绝不允许在 `src/core/` 或 `src/strategy/` 中引入带有网络/文件副作用的调用。
