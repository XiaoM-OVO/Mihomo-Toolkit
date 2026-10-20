# 📖 Mihomo-Toolkit-Next 配置全景字典与参数指南 (CONFIGURATION.md)

> **版本适用**：`Mihomo-Toolkit-Next` (Architecture v2.0+)  
> **数据权威**：本项目所有参数名称、默认值与安全策略以 [`src/data/field-registry.js`](file:///E:/CODE/mihomo-toolkit-next/src/data/field-registry.js)（单一真理来源 SSOT）为准。测试套件严格校验代码读取、类型定义与本文档的一致性，杜绝“隐形参数”与“空承诺字段”。

---

## 目录

- [一、配置体系与核心设计哲学](#一配置体系与核心设计哲学)
  - [1.1 扁平化声明与零心智负担](#11-扁平化声明与零心智负担)
  - [1.2 信任分级边界 (Trust Boundary)](#12-信任分级边界-trust-boundary)
  - [1.3 合并语义：覆盖 (Override) 与基线追加 (Additive)](#13-合并语义覆盖-override-与基线追加-additive)
  - [1.4 通用配置片段挂载 (include)](#14-通用配置片段挂载-include)
- [二、焦点破译：消除“谜语人”参数](#二焦点破译消除谜语人参数)
  - [2.1 声明式策略组 DSL (`customGroups`) 完全指南](#21-声明式策略组-dsl-customgroups-完全指南)
    - [2.1.1 统一策略组声明清单 (`groups`)](#211-统一策略组声明清单-groups)
  - [2.2 节点专属 DNS 依赖闭包 (`assetClosure`)](#22-节点专属-dns-依赖闭包-assetclosure)
  - [2.3 地区识别策略：严格字典 vs 宽松捕获 (`strictRegionMatch`)](#23-地区识别策略严格字典-vs-宽松捕获-strictregionmatch)
  - [2.4 DAG 级联空组剪枝与豁免机制 (`exemptGroups`)](#24-dag-级联空组剪枝与豁免机制-exemptgroups)
  - [2.5 策略组视觉呈现矩阵 (`groupIconMode` 与 `groupIcons`)](#25-策略组视觉呈现矩阵-groupiconmode-与-groupicons)
  - [2.6 节点分桶与倍率隔离门控 (`isolateHighMulti` / `isolateDownload` / `isolateExperimental`)](#26-节点分桶与倍率隔离门控-isolatehighmulti--isolatedownload--isolateexperimental)
  - [2.7 网络抓取策略与容灾重试 (`fetchProxyStrategy` / `fetchProxyPort`)](#27-网络抓取策略与容灾重试-fetchproxystrategy--fetchproxyport)
  - [2.8 动态扩展服务编目 (`customServices` 与 `servicesConfigFile`)](#28-动态扩展服务编目-customservices-与-servicesconfigfile)
  - [2.9 域名多 IP 节点裂变增殖 (`enableFission`)](#29-域名多-ip-节点裂变增殖-enablefission)
  - [2.10 流量方向 (`trafficDirection`)](#210-流量方向-trafficdirection)
  - [2.11 节点防环注入模式 (`fakeIpFilterNodes`)](#211-节点防环注入模式-fakeipfilternodes)
  - [2.12 安全铁律 INV-8 (`dnsAllowNonLoopback`)](#212-安全铁律-inv-8-dnsallownonloopback)
- [三、全量参数字典 (15 大分类)](#三全量参数字典-15-大分类)
  - [1. 基础全局配置](#1-基础全局配置)
  - [2. 节点清洗与处理](#2-节点清洗与处理)
  - [3. 策略组建组与 UI 面板](#3-策略组建组与-ui-面板)
  - [4. 核心分流开关](#4-核心分流开关)
  - [5. 扩展分流开关](#5-扩展分流开关)
  - [6. 网络测速与规则集](#6-网络测速与规则集)
  - [7. DNS 与 Hosts 安全面](#7-dns-与-hosts-安全面)
  - [8. 安全防漏与内核覆写](#8-安全防漏与内核覆写)
  - [9. 节点裂变](#9-节点裂变)
  - [10. 规则集与图标仓库来源](#10-规则集与图标仓库来源)
  - [11. 进程分流名单](#11-进程分流名单)
  - [12. 订阅源与拉取设置](#12-订阅源与拉取设置)
  - [13. 运行模式与缓存](#13-运行模式与缓存)
  - [14. 自定义规则入口](#14-自定义规则入口)
  - [15. 安全与资源配额](#15-安全与资源配额)
- [四、典型场景配置配方](#四典型场景配置配方)
  - [配方 A：轻量日常极速版 (简洁优雅)](#配方-a轻量日常极速版-简洁优雅)
  - [配方 B：高要求 AI 与流媒体玩家版](#配方-b高要求-ai-与流媒体玩家版)
  - [配方 C：HomeLab / 软路由局域网网关版](#配方-chomelab--软路由局域网网关版)
  - [配方 D：模块化片段架构 (`include`)](#配方-d模块化片段架构-include)

---

## 一、配置体系与核心设计哲学

### 1.1 扁平化声明与零心智负担

在传统的代理配置工具中，配置项往往层层嵌套（如 `dns.servers[0].params.tls...`），导致用户排查问题和手写配置极其困难。
`Mihomo-Toolkit-Next` 采用**完全扁平化的根级声明规范**：
- 无论底层属于策略组引擎、DNS 模块、节点清洗层还是网络抓取层，所有对外公开的配置属性均平铺在顶层。
- 引擎内部的流水线（Pipeline）会根据各模块职责，自动将扁平参数分发投影到底层各子系统。

### 1.2 信任分级边界 (Trust Boundary)

工具原生提供常驻 HTTP 服务模式（`npm start`），支持通过 URL 传参（例如 `http://127.0.0.1:3000/sub?config=http://remote.host/user.yaml`）拉取外部配置。为了杜绝远程配置注入导致的提权、恶意文件读写、SSRF 与 DNS 劫持漏洞，本项目严格划分了字段的**信任等级**：

| 信任等级 | 标记 | 含义与安全约束 | 典型字段 |
| :--- | :--- | :--- | :--- |
| **可信本地** | `trust: 'local'` | **仅允许在本地配置文件声明**。远程 `?config=` 参数传入时会被强行剥夺（剥离并发出安全审计警告），防止外部攻击者越权操控服务器。 | `include`, `servicesConfigFile`, `output`, `customRules`, `customRuleProviders`, `customGroups`, `groups`, `dnsListen`, `dnsAllowNonLoopback`, `hosts`, `nameserverPolicy`, `protectedDomains`, `security`, `fakeIpFilter` 等 |
| **任意来源** | `trust: 'any'` | 本地配置与远程 `?config=` 均有权修改，属于纯粹的展示与节点清洗偏好。 | `logLevel`, `enableAI`, `trafficDirection`, `renameTemplate`, `enableDedupe` 等 |

### 1.3 合并语义：覆盖 (Override) 与基线追加 (Additive)

系统支持两种合并策略：
1. **`merge: 'override'`（覆盖模式，绝大多数参数）**：后加载的值直接覆盖前者的值。
2. **`merge: 'additive'`（只增不减追加模式，特指基线安全项）**：
   - 包含：`protectedDomains`（受保护域名基线）与 `exemptGroups`（骨架豁免组基线）。
   - **安全不降级原则**：引擎出厂内置的只读基线字典（如 `github.com`、`paypal.com`、`手动选择`）**永远无法被用户清空或替换**。用户配置的值将作为集合并集（基线 ∪ 用户自定义项）生效。即便在配置中书写 `protectedDomains: []`，内置的 60 余个关键防御域名依然全量受保护。

### 1.4 通用配置片段挂载 (include)

当配置内容庞大时，可以使用 `include` 字段将配置拆分为多个模块：

```yaml
include:
  - "./base.yaml"
  - "./my-custom-services.yaml"
  - "./secret-tokens.local.yaml"
```

- **统一契约**：被挂载的文件与主配置文件完全遵从同一套 schema。
- **合并次序**：主文件优先（合并次序为 `include[0]` ⊕ `include[1]` ⊕ ... ⊕ `主文件`）。
- **合并规则**：标量由高优先级覆盖；对象执行深度递归合并；数组执行并集去重（保持先入序）。
- **递归挂载**：片段内部亦可继续声明 `include`（相对路径以所在子片段目录为基准），引擎内置了有向环路检测（DAG Cycle Detection）与深度上限保护，防范无限递归。

---

## 二、焦点破译：消除“谜语人”参数

### 2.1 声明式策略组 DSL (`customGroups`) 完全指南

`customGroups` 是取代旧版命令式代码注入的**全声明式策略组建组 DSL**。通过它，你无需编写一行 JavaScript，即可根据节点的任意物理维度（地区、倍率、标签、正则、协议）像 SQL 查询一样动态组合出心仪的策略组。

#### 核心属性表

| 属性 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `name` | string | 是 | 策略组名称（如 `🎬 专属流媒体` 或出厂内置名 `🤖 ChatGPT`） |
| `type` | string | 否 | 策略组类型：`select`（默认）\| `url-test` \| `fallback` \| `load-balance` |
| `url` | string | 否 | 健康检查/测速 URL（默认继承全局 `testURL`） |
| `interval` | number | 否 | 健康检查间隔（秒，默认继承全局 `testInterval`） |
| `tolerance` | number | 否 | 切换容差（毫秒，仅 `url-test` 有效，默认继承全局 `testTolerance`） |
| `strategy` | string | 否 | 负载均衡模式：`consistent-hashing`（默认）\| `round-robin` |
| `lazy` | boolean | 否 | 是否启用懒加载测速（默认 `true`） |
| `icon` | string / object | 否 | 图标 URL 或仓库对象 `{ repo: 'koolson', file: 'YouTube.png' }` |
| `emoji` | string | 否 | Emoji 徽标（如 `🎬`） |
| `hidden` | boolean | 否 | 是否在前端界面隐藏该策略组（默认 `false`） |
| `filter` | string | 否 | Mihomo 原生成员过滤正则（在 `match` 之外追加的二次过滤） |
| `exclude-filter` | string | 否 | Mihomo 原生成员排除正则 |
| `match` | Recipe / Recipe[] | 否 | **节点匹配配方（正向命中条件）**，可写对象或数组 |
| `exclude` | Recipe / Recipe[] | 否 | **黑名单配方（反向剔除条件）**，任一命中立即排除 |
| `proxies` | string[] | 否 | **策略组成员声明**，支持纯节点名、下游策略组引用以及**宏变量** |
| `rules` | string / string[] | 否 | 绑定的分流规则名称（会自动注入到 rules 规则链，如 `youtube`） |
| `providers` | object | 否 | 该组随组交付的规则集 Provider 映射（规则集名 → `geosite/x` 或绝对 URL），`{ ref }` 引用内置组时会自动带上 |

#### 配方 (Recipe) 支持的匹配维度

在 `match` 与 `exclude` 中支持以下灵活的谓词匹配：

```yaml
match:
  # 1. 地区 (支持代码 'hk'/'us'、中文 '香港'、大洲 'asia'/'europe'/'americas'/'oceania'/'africa'、次大区 'sea'/'na'/'latam'/'me'/'sa'、取反 '!cn'、'unknown')
  region: ["hk", "tw", "jp"]

  # 2. 节点倍率 (支持区间 [0, 1.5]、不等式 '<= 1.5'、'> 2.0'、'== 1.0')
  multi: "<= 1.5"

  # 3. 标签匹配 (支持单标签、数组 OR、取反 '!download'、或复合 { any: [...], all: [...] })
  tags: ["streaming", "!download"]

  # 4. 名称/正则 (支持子串 '专线'、正则表达式 '/(?:iepl|iplc)/i')
  pattern: "/(?:iepl|iplc|bgp)/i"

  # 5. 协议类型 (支持 'ss', 'vless', 'vmess', 'trojan', 'hysteria2', 'tuic', 取反 '!http')
  protocol: ["hysteria2", "tuic"]

  # 6. 订阅来源标签 (匹配来自特定机场的节点)
  airport: ["主力机场A"]

  # 7. 复合条件模式: all (match 配方默认全部满足) | any (exclude 配方默认任一满足即排除)
  mode: all
```

> [!IMPORTANT]
> **配方合规校验与严格阻断 (Fail-Closed)**：
> 在构建策略拓扑前，系统会对所有 `customGroups` 进行强类型校验：
> - **顶层未知字段拦截**：策略组对象仅允许上表列出的字段，任何未声明的字段（如历史遗留的 `pool` / `tag` / `includeInfo`）都会直接抛出错误并中断流程，杜绝"幽灵配置"被静默忽略。
> - **组类型白名单**：`type` 必须为 `select` / `url-test` / `fallback` / `load-balance` 之一，非法值直接抛错（不再静默降级为 `select`）；`proxies` 必须为 `string[]`，`rules` 必须为 `string` 或 `string[]`。
> - **未知键拦截**：`match` / `exclude` 配方对象仅允许支持的匹配维度键，未知键会直接抛出包含所属策略组与字段路径的错误并中断流程。
> - **类型与空值约束**：各字段必须符合规定类型（如 `multi` 必须为数值、区间字符串或二元数组），禁止空对象 `{}` 或空配方数组 `[]`。
> - **未知宏配置期 fail-closed**：`proxies` 中未登记的 `@` 宏变量会在**配置校验期直接抛出错误并报出字段路径**（如 `策略组 X.proxies[0]: 未知宏「@foo」`），杜绝带病配置流入内核；引擎内部配方（内置目录）仍保留运行期告警兜底。既非物理节点、亦非已知策略组与内置目标（`DIRECT`/`REJECT`/`REJECT-DROP`/`COMPATIBLE`/`PASS`/`GLOBAL`）的目标同样会输出告警，交由后续裁剪兜底。
> - **`groups` 未知引用键拦截**：`groups` 中 `{ ref: <键> }` 指向不存在的内置组键时，会在配置装载期抛出错误并报出字段路径（如 `groups[0].ref: 未知内置组引用键「xxx」`），并附上当前可用键清单。
> - **循环依赖阻断 (Cycle Detection)**：若策略组之间声明了循环引用（例如 A 包含 B 且 B 包含 A），拓扑装配引擎会直接抛出错误并终止生成输出，杜绝死锁配置输出到内核。


#### 动态拓扑宏变量清单

在 `proxies` 中，你不仅能书写固定的节点名或策略组名，还可以使用 `@` 开头的**动态拓扑宏**：

| 宏变量名称 | 别名 (Alias) | 宏展开求值结果 |
| :--- | :--- | :--- |
| `@matchedNodes` | `@matched`, `@nodes` | 由当前策略组 `match` 与 `exclude` 规则动态计算出的最终节点名单 |
| `@residential` | `@resi` | 当前订阅中被识别出的所有家宽/住宅 IP 实体节点 |
| `@residentialGroup` | `@resigroup` | 若开启了家宽分组且存在有效节点，则展开为 `['家宽优选']`，否则为空 |
| `@allStandard` | `@all` | 清洗后进入主力池的所有标准代理节点全集 |
| `@highMulti` | - | 所有被隔离的高倍率节点全集 |
| `@special` | - | 所有被识别的特殊节点全集 |
| `@activeRegions` | `@regions` | 当前所有成功建组的活跃地区策略组名称列表（如 `['香港节点', '日本节点']`，均为内部规范纯净名） |
| `@asia` | `@asiaRegions`, `@亚洲` | 当前活跃地区组中归属于**亚洲**的所有策略组（含东亚、东南亚、南亚、中东等） |
| `@europe` | `@eu`, `@euRegions`, `@欧洲` | 当前活跃地区组中归属于**欧洲**的所有策略组 |
| `@americas` | `@america`, `@am`, `@美洲` | 当前活跃地区组中归属于**美洲**的所有策略组（美、加、拉美等） |
| `@oceania` | `@oc`, `@大洋洲` | 当前活跃地区组中归属于**大洋洲**的所有策略组（澳大利亚等） |
| `@africa` | `@af`, `@非洲` | 当前活跃地区组中归属于**非洲**的所有策略组 |
| `@sea` | `@seaRegions`, `@东南亚` | 当前活跃地区组中归属于**东南亚**的所有策略组（新加坡、马来西亚、泰国等） |
| `@me` | `@中东` | 当前活跃地区组中归属于**中东**的所有策略组 |
| `@sas` | `@南亚` | 当前活跃地区组中归属于**南亚**的所有策略组 |
| `@na` | `@北美` | 当前活跃地区组中归属于**北美**的所有策略组 |
| `@latam` | `@拉美` | 当前活跃地区组中归属于**拉丁美洲**的所有策略组 |
| `@ea` | `@东亚` | 当前活跃地区组中归属于**东亚**的所有策略组 |
| `@domesticGroup` | `@domestic` | 若开启中国分流则展开为 `['中国分流']`，否则展开为 `['DIRECT']` |
| `@preferredRegions` | `@preferred` | 将当前策略组 `preferredRegions`（地区 id 列表，如 `['us','jp']`）展开为对应地区策略组名（如 `['美国节点','日本节点']`） |
| `@nonCnRegions` | `@noncn` | 当前活跃地区组中剔除中国大中华核心区（大陆/香港/中国/未知识别）后的纯海外地区组 |
| `@defaultProxy` | `@proxy` | 根据 `defaultProxyMode` 计算出的默认代理组（`自动选择` / `手动选择` / `DIRECT`） |
| `@standardOptions` | `@standard` | 标准应用组的前置选项（依序展开：默认代理组 ➔ 各活跃地区组 ➔ 家宽组 ➔ DIRECT） |

#### 实用 DSL 示例

```yaml
customGroups:
  # 示例 1：纯新增一个「极速日韩」测速组（推荐使用规范纯净组名，徽标与图标交给系统自适应）
  - name: "极速日韩"
    emoji: "⚡"
    type: url-test
    tolerance: 30
    match:
      region: ["jp", "kr"]
      multi: "<= 1.0"
      tags: ["!download"]
    proxies:
      - "@matchedNodes"
      - "DIRECT"

  # 示例 2：覆写出厂内置的「ChatGPT」组（增加自选前置与家宽优先）
  - name: "ChatGPT"
    type: select
    proxies:
      - "@residentialGroup"   # 家宽有节点时优先排在第一位
      - "美国节点"            # 引用现有地区策略组（内部规范纯净名）
      - "日本节点"
      - "@defaultProxy"
      - "DIRECT"
```

> [!TIP]
> **最佳实践：为什么推荐在配置中书写纯净组名？**  
> - **跨模式完美自适应**：系统支持 `groupIconMode: "emoji" | "icon" | "both" | "none"`。书写纯净名（如 `ChatGPT`、`美国节点`）配合可选的 `emoji: "🤖"`，能让配置在纯图标模式（`icon`）或无图纯文本模式（`none`）下获得真正纯净的展示体验，杜绝硬编码 Emoji 带来的视觉冲突。
> - **宽进严出双重容错**：虽然底层引擎已内置容错机制（即便直接写 `"🤖 ChatGPT"` 或在 `proxies` 中写 `"🇺🇸 美国节点"` 也会自动识别归一化），但书写规范纯净名依然是最稳健、最不易出错的书写规范。

#### 2.1.1 统一策略组声明清单 (`groups`)

`groups` 是策略组的**单一声明入口**：它把「要哪些组」收敛成一张清单，取代过去散落的 `enableAI` / `enableStreaming` 等建组开关与 `aiServices` / `streamingServices` 等服务清单字段。

- **声明即激活，注释即关闭**：列在清单里的条目就生效，从清单里删掉（或注释掉）即关闭；不存在「某个开关决定某个组存不存在」的第二条路径。
- **`{ ref: <键> }` 引用内置组目录**：内置组定义内置于程序（`src/config/catalog.js`），无需外部文件。引用即原样插入该组的完整声明（含其 `match` / `proxies` / `rules` / `providers`），并允许**条目内覆写任意字段**。
- **`{ ref }` 与手写声明同构**：引用进来的东西和用户自己写的一条完整声明结构完全一致，不需要额外学一套概念——`ref` 只是一个「不用手抄」的快捷方式。
- **`disabled: true` 显式关闭**：`include` 片段的数组语义是**并集去重**（片段的条目会被并集加回），因此「注释掉即关闭」只在单文件内成立。要跨片段关闭，必须显式书写 `disabled: true`。

```yaml
groups:
  # 引用内置组目录里的条目：列了即激活（不需要先打开任何开关）
  - { ref: chatgpt }
  - { ref: gemini }
  - { ref: claude, disabled: true }   # 显式关闭（跨 include 片段时必需）
  - ref: copilot                      # 引用条目亦可覆写任意字段
    name: 我的 Copilot 线路
    type: url-test

  # 目录之外的自定义组：字段与目录条目完全同构
  - name: 我的专属线路
    match: { region: ['hk', 'jp'] }
    proxies: ['@matchedNodes', 'DIRECT']
```

> [!TIP]
> 内置组目录已覆盖 AI、流媒体、社交、游戏、开发学术、系统服务与专项服务，并额外包含游戏 / 社交聚合组（`game-service` / `game-download` / `social-platform`）与广告拦截的两条规则来源（`ad-block` / `anti-ad`）。聚合组的成员条目（如 `steam` / `facebook`）不单独成组，引用会 fail-closed 并提示应改引哪个聚合组。不确定有哪些可用键？写一个不存在的键即可——错误信息会直接列出全部可用键。

---

### 2.2 节点专属 DNS 依赖闭包 (`assetClosure`)

*为什么需要这个参数？*  
许多现代高级订阅（如 Hysteria2、VLESS Reality、TUIC 等）会利用订阅自带的 `hosts`、`nameserver-policy` 或 `fake-ip-filter` 来实现 SNI 伪装和防封锁解析。  
如果全盘继承订阅下发的 DNS 配置，恶意机场可以轻易覆写你的 `github.com` 或银行域名实现 **DNS 劫持**；如果完全丢弃，很多自建节点将**因无法解析域名而彻底瘫痪**。

`assetClosure` 正是为此设计的依赖闭包沙箱门控：

- `standard`（**默认推荐**）：**精确按需闭包**。系统分析订阅中实际用到的所有代理节点 `server` 域名，仅将这部分域名专属的解析依赖（Hosts / Nameserver 映射）定向继承进主配置，其他无关域名统统丢弃。同时配合内置的 60+ 受保护安全基线，杜绝核心资产被投毒。
- `strict`（**极高安全需求**）：**白名单沙箱闭包**。在此模式下，系统**绝不自动分析**节点的 server 域名，**仅当**域名显式出现在 `assetDomainAllowlist` 配置数组中时，才允许继承其 DNS 依赖。未声明的节点依赖一律被斩断。
- `off`（**完全切断**）：**零继承**。无论订阅声明了什么 hosts、nameserver-policy 或 fake-ip-filter，一概丢弃，完全交由本地权威 DNS 统一解析。

---

### 2.3 地区识别策略：严格字典 vs 宽松捕获 (`strictRegionMatch`)

节点清洗层需要识别节点属于哪个国家或大区（香港、日本、美国等）：

- `false`（**默认，宽松模式**）：
  - 启动多层级启发式识别：先查国家标准字典，接着检测节点名中的国旗 Emoji（如 🇭🇰 🇯🇵 🇺🇸 🇬🇧），最后运行模糊拼音与英文缩写识别。
  - **优点**：容错率极高，绝大多数非标小机场节点也能精准自动归类到对应大区。
- `true`（**严格字典模式**）：
  - 仅匹配经过严格验证的官方规范地区字典（ISO 代码与标准中英文全称），跳过国旗 Emoji 与模糊启发式提取。
  - **适用场景**：某些机场喜欢在节点名里随意乱贴装饰性国旗 Emoji（例如在英国节点名前贴满 🇺🇸 标志），开启严格模式可避免节点被误判归入错误的国家。

---

### 2.4 DAG 级联空组剪枝与豁免机制 (`exemptGroups`)

Mihomo 内核有一条硬性规则：**策略组内如果包含 0 个可用节点/下游组，内核启动将直接 Crash 报错**。

为此，Toolkit 内置了基于有向无环图（DAG）的**级联空组动态剪枝引擎**：
1. 若某小众大区在本次订阅中没有任何可用节点，该地区组会被自动移除；
2. 如果某个应用组原本指向了该被移除的地区组，且应用组内再无其他节点，该应用组也会被自动连带剪枝；
3. 但系统存在**骨架组基线**（`手动选择`、`漏网之鱼`、`PROXIES` 等），无论池子多空，骨架组必须存活。

`exemptGroups` 允许用户**追加**自定义的“免死金牌策略组”：
- **只增不减追加模式**：永远保留系统基线。
- **作用**：如果你自定义了一个常驻组（例如自建的 `🏠 家宽优选`），即便某一天订阅更新暂时没拉到家宽节点，只要该组名字登记在 `exemptGroups` 中，剪枝引擎就会豁免对它的裁剪，并自动为其注入 `DIRECT` 进行安全垫底，避免整个拓扑结构剧烈颠簸破坏客户端收藏视图。

---

### 2.5 策略组视觉呈现矩阵 (`groupIconMode` 与 `groupIcons`)

为满足不同用户的审美与客户端（Clash Verge Rev、Mihomo Party、ShellCrash 等）的兼容性，系统提供了多维的视觉呈现方案：

#### 1. `groupIconMode` 呈现档位

| 模式值 | 策略组名称 (Name) | 策略组属性 (`g.icon`) | 视觉效果与适用场景 |
| :--- | :--- | :--- | :--- |
| `emoji`（默认） | 带有 Emoji（如 `⚡ 自动选择`） | 注入在线图标 URL | 兼顾纯文本终端与 GUI 客户端，信息饱满 |
| `icon` | **纯净文本**（如 `自动选择`） | 注入在线图标 URL | **现代 GUI 专用**：避免客户端面板上 Emoji 与外部高清图标重叠产生双图标怪象 |
| `both` | 带有 Emoji（如 `⚡ 自动选择`） | 注入在线图标 URL | 强装饰性，确保在任何客户端都具备图形特征 |
| `none` | **纯净文本**（如 `自动选择`） | **完全不生成** `icon` 属性 | **极简极客模式**：配置体积最小，零网络外链图标依赖，面板干净清爽 |

#### 2. `groupIcons` 自定义图标映射

你可以随心所欲覆写任意内置组或自定义策略组的图标与 Emoji：

```yaml
groupIcons:
  # 简写模式：仅覆写 Emoji
  自动选择: "⚡"
  
  # 完整对象模式：同时指定 Emoji 与在线图标
  手动选择:
    emoji: "📍"
    icon: "Static.png" # 自动使用配置的 iconRepo 补全 CDN 前缀
    
  # 指定外部完整 URL
  🎬 专属流媒体:
    emoji: "🍿"
    icon: "https://example.com/popcorn.png"
```

---

### 2.6 节点分桶与倍率隔离门控 (`isolateHighMulti` / `isolateDownload` / `isolateExperimental`)

在节点清洗阶段，系统会对节点打标并装入专属“分桶（Bucket）”：

1. **`isolateHighMulti: true`（高倍率隔离）**：
   - 当节点倍率 >= `highMultiThreshold`（默认 2.5 倍）时，该节点会被**强行移出**普通的地区测速池（防止自动测速跑分或看 4K 视频时瞬间榨干机场月度流量配额！），统一收拢至独立的「`🚀 高倍率优选`」策略组中，由用户按需手动调用。
2. **`isolateDownload: true`（下载低倍率隔离）**：
   - 当节点倍率 <= `lowMultiThreshold`（默认 0.99 倍，例如 0.1x 节点）时，该节点被从主力大区池剔除，单独收拢至「`⏬ 下载策略`」组，专供大流量下载工具使用。
3. **`isolateExperimental: true`（测试/实验节点隔离）**：
   - 过滤名称中带有“测试 / 实验 / 试用 / 测速 / 流量”等关键词的节点，将其移出主力路由，归纳到「`🧪 实验节点`」组，避免不稳定的实验节点拉低自动测速组的整体可用率。

---

### 2.7 网络抓取策略与容灾重试 (`fetchProxyStrategy` / `fetchProxyPort`)

当拉取远程订阅或执行节点裂变 DoH 解析时，本机的网络出口策略由 `fetchProxyStrategy` 裁决：

- `direct`（直连模式）：严格通过本机网卡与本地 DNS 解析直连拉取。若解析失败或网络不通直接报错（Fail-Closed）。
- `proxy`（强制代理模式）：严格通过 `fetchProxyPort`（如 7890）指定的本地 HTTP/SOCKS 代理抓取目标。
- `auto`（**默认智能容灾模式**）：**先直连，失败自动切代理**。
  - 针对国内 CDN 加速的订阅链接，直连毫秒级迅速完成；
  - 一旦直连发生 DNS 污染、超时（`fetchTimeout`）或连接重置，立即无缝无损回退到代理端口重试；
  - 辅以 `fetchRetry`（失败重试次数，默认 2 次）与 `fetchStaleTtl`（断网时复用上次成功缓存的小时数，默认 24h），实现极致的高可用。

---

### 2.8 动态扩展服务编目 (`customServices` 与 `servicesConfigFile`)

Toolkit 预装了近 30 种主流服务（ChatGPT、YouTube、Netflix、Steam、GitHub、Apple 等）。如果遇到小众应用或新增的 AI 平台，你完全可以通过行内定义或外挂文件进行热插拔：

```yaml
# 方式 A：行内直接定义（支持 ai, streaming, social, game, dev, system 六大分类）
customServices:
  ai:
    deepseek:
      name: "DeepSeek"
      emoji: "🧠"
      reg: "/\\b(?:DeepSeek|深度求索)\\b/i"
      rules: "deepseek"                      # 对应 geosite:deepseek 规则集
      icon: { repo: "koolson", file: "AI.png" }

  game:
    lol:
      name: "英雄联盟"
      rules: "lol"                           # 自动路由至「🎮 游戏服务」聚合组
    apex:
      name: "Apex英雄"
      rules:
        - { type: "DOMAIN-SUFFIX", value: "apex-dl.ea.com", target: "@download" } # 语义化定向至游戏下载
        - { type: "RULE-SET", value: "apex", path: "apex", target: "@service" }   # 语义化定向至游戏服务

# 方式 B：外挂专用配置文件（支持 .yaml / .json / .js）
servicesConfigFile: "./services.config.yaml"
```

#### 规则语法与语义化宏目标 (`target`)
- **语义继承**：如果服务 key 与官方内置服务相同（如 `chatgpt`），系统会自动执行属性合并，你可以仅覆盖名称、图标或地区偏好，其余底层规则完全继承。
- **自动激活**：在 `customServices` 中声明的自定义服务会自动并入激活列表，无需在 `aiServices` 或 `gameServices` 中再次重复声明。
- **语义化宏目标 (`target`)**：
  - `@service`（或 `@self` / 省略目标）：动态路由至该分类的默认聚合组（如游戏的 `🎮 游戏服务`）或独立策略组；
  - `@download`：动态路由至该分类的下载聚合组（如游戏的 `🎮 游戏下载`）；
  - 显式目标名（如 `DIRECT`、`香港节点` 或自定义策略组）：原样透传。
- **防幽灵组铁律 (Anti-Ghost Group)**：游戏分类下的自定义规则严禁直接以自定义游戏名称作为路由目标，默认与宏目标严格归并在预设聚合组中，杜绝产生不存在的幽灵策略组。
- **声明驱动子规则集按需激活**：游戏平台规则集庞大，系统默认仅根据 `gameServices`（如 `['steam', 'epic']`）激活并拉取对应 Provider；未声明的内置平台不会拉取网络规则集，杜绝配置臃肿。

---

### 2.9 域名多 IP 节点裂变增殖 (`enableFission`)

*什么是节点裂变？*  
许多机场的节点配置仅给出一个 DDNS 域名（例如 `hk01.airport.com:443`）。但该域名背后往往解析了 4~8 台不同电信运营商的物理服务器节点。普通客户端只会解析并连接第一个 IP。

开启 `enableFission: true` 后：
- 流水线在编译期会自动向可信 DoH 异步查询该域名的全部 A / AAAA 记录；
- 将 1 个域名节点**瞬间裂变为多个独立的物理实体节点**（例如 `[裂变 1] 香港 01 (1.2.3.4)`、`[裂变 2] 香港 01 (1.2.3.5)`）；
- 最多裂变数量由 `fissionMaxNodes`（默认 5）控制；协议栈可指定 `fissionStack: "all" | "v4" | "v6"`；
- 裂变后的多节点直接参与 `url-test` 自动竞速测速，自动锁定实际网络状况最佳的那台物理机。

---

### 2.10 流量方向 (`trafficDirection`)

规则层面的国内 / 海外走向由 `routing` 表表达（`domestic` 预设 + 条目 `to`）；这里只声明**这台机器的流量往哪个方向走**，用于那些「无法只靠规则判断」的部分：

- `split`（**默认**）：国内直连、海外代理。DNS 上游用 `dnsDirect` 解析国内域名、`dnsProxy` 解析海外域名。
- `return`（回国）：国内代理、海外直连。DNS 上游互换，QUIC 拦截的 CN / 非 CN 分支、WebRTC 组的成员编排同步翻转。

> 早期版本用 `enableDomesticGroup` × `proxyFirst` 两个布尔量组合推断方向，关闭 `proxyFirst` 会静默把整个方向翻转（触发条件为「中国分流组开启 + 直连优先」）。该组合已删除：需要回国请显式写 `trafficDirection: return`，需要国内流量走某个组请写 `routing` 条目 `to: 中国分流`。

---

### 2.11 节点防环注入模式 (`fakeIpFilterNodes`)

在 Fake-IP 模式下，节点服务器自身如果被误分发了虚假 IP，会导致节点在建立 TLS 握手时陷入“连接自己”的无限死循环。因此节点服务器域名必须注入 `fake-ip-filter` 予以放行。

- `smart`（**推荐**）：**智能主域聚合泛化**。系统自动对所有节点域名进行公共后缀分析，收拢为主域通配符（如 `+.airportnode.net`），同时精确剔除 SNI 伪装域名（如伪装用的 `gateway.icloud.com`），生成的配置紧凑清爽，性能损耗极低。
- `exact`：逐项将几百个节点的完整 FQDN 域名原样写入 filter。
- `off`：不主动向 filter 注入任何节点域名（依赖内核原生出站机制）。

---

### 2.12 安全铁律 INV-8 (`dnsAllowNonLoopback`)

- **出厂默认**：`false`。本地 DNS 监听地址 `dnsListen` 默认绑定 `127.0.0.1:1053`。
- **安全背景**：如果将 DNS 监听绑定到非回环地址（如 `0.0.0.0:53` 或 `192.168.1.1:53`），意味着你的机器在局域网乃至公网上成为了一台**开放式 DNS 解析服务器**，容易遭到外部 DNS 反放大 DDoS 攻击或内网恶意劫持。
- **配置约束**：如果你是在软路由、家庭网关上部署，确需为其他内网设备提供 DNS 解析服务，必须**显式**声明 `dnsAllowNonLoopback: true`，否则流水线将启动安全断言拦截，直接拒绝生成不安全配置。

---

## 三、全量参数字典 (15 大分类)

> 💡 **说明**：  
> - **来源信任**：`local` 表示仅限可信本地配置，`any` 表示允许远程 `?config=` 写入。  
> - **合并模式**：`override` 表示覆盖；`additive` 表示只增不减（基线永远保留）。

### 1. 基础全局配置

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `enablePipeline` | `boolean` | `true` | `any` | `override` | **流水线总控**：设为 `false` 则跳过所有策略拓扑组建、规则集编排与内核优化，仅交付清洗后的节点。 |
| `logLevel` | `string` | `'info'` | `any` | `override` | **日志输出级别**：可选 `silent` \| `error` \| `warn` \| `info` \| `debug`。日常使用建议 `info`。 |
| `osType` | `string` | `'windows'` | `any` | `override` | **目标运行环境**：可选 `windows` \| `mac` \| `linux` \| `all`。用于匹配特定操作系统的强制直连进程名单。 |
| `trafficDirection` | `string` | `'split'` | `any` | `override` | **流量方向**：`split` 国内直连 / 海外代理（默认）；`return` 回国（国内代理 / 海外直连）。只影响 DNS 上游、QUIC 拦截目标与 WebRTC 分支；规则的国内 / 海外走向由 `routing` 决定。 |
| `defaultProxyMode` | `string` | `'auto'` | `any` | `override` | **默认代理行为**：可选 `auto` (自动测速) \| `manual` (手动选择) \| `fallback` (故障转移) \| `direct` \| `reject`。 |
| `enableIPv6` | `boolean` | `false` | `any` | `override` | **全局 IPv6 开关**：控制 TUN、DNS 及路由规则的 IPv6 通道。本机无公网物理 IPv6 时请保持 `false`。 |
| `enableAirportTag` | `boolean` | `false` | `any` | `override` | **订阅标签提取**：多订阅聚合时，是否自动将订阅来源识别为标签并附着在节点属性中。 |
| `airportTag` | `string` | `''` | `any` | `override` | **手动指定标签**：多订阅时逗号分隔的固定标签列表，留空则由引擎自动提取或按文件名分配。 |
| `showFeatureIcon` | `boolean` | `true` | `any` | `override` | **节点特征图符**：是否在重命名后的节点末尾追加特征标识（如 🚀 4K 🏠 等）。 |
| `include` | `string[]` | `[]` | `local` | `override` | **通用配置片段挂载**：引入外部 yaml/json 片段，主配置优先，数组并集去重，支持递归 include。 |
| `servicesConfigFile` | `string` | `''` | `local` | `override` | **外部服务扩展文件**：挂载外部 `.js`、`.yaml` 或 `.json` 自定义服务编目文件。 |

```yaml
# 示例
trafficDirection: "split"
defaultProxyMode: "auto"
osType: "windows"
include:
  - "./my-custom-rules.yaml"
```

---

### 2. 节点清洗与处理

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `enableDedupe` | `boolean` | `false` | `any` | `override` | **节点指纹去重**：对比节点底层物理属性（server + port + uuid/cipher），剔除完全重复的注水节点。 |
| `enableNodeSort` | `boolean` | `false` | `any` | `override` | **节点多维智能排序**：依序按「大区 ➔ 隔离分桶 ➔ 线路质量 ➔ 倍率升序」进行稳定排布。 |
| `assetClosure` | `string` | `'standard'` | `any` | `override` | **节点专属 DNS 依赖继承闭包**：`standard` (按需继承) \| `strict` (仅白名单) \| `off` (零继承)。 |
| `assetDomainAllowlist`| `string[]` | `[]` | `local` | `override` | `assetClosure: strict` 模式下唯一允许被继承 DNS 依赖的域名白名单列表。 |
| `enableDashboard` | `boolean` | `true` | `any` | `override` | **订阅信息虚拟看板**：生成高颜值独立策略组展示套餐剩余流量、到期日与重置倒计时。 |
| `removeInfoNodes` | `boolean` | `true` | `any` | `override` | **过滤原生说明伪节点**：自动拦截机场自带的“剩余流量/官网地址”等假节点，避免污染节点池。 |
| `renameTemplate` | `string` | 见下方说明 | `any` | `override` | **节点重命名模板**：默认 `[{airport}] {icon} {region} {index} {features} \| {in} {city} {line} {multi} {ip_stack} · {transport}`。 |
| `renameSeparators` | `string[]` | `['\|', '-', ...]` | `any` | `override` | 节点格式化后，自动清理两端及冗余连续悬空的分隔符号列表。 |
| `whitelistKeywords` | `string[]` | `[]` | `any` | `override` | **节点白名单关键词**：命中任一词则强行放行，并跳过垃圾过滤。 |
| `blockKeywords` | `string[]` | `[]` | `any` | `override` | **节点名称黑名单**：节点名包含即立即丢弃（优先级高于白名单）。 |
| `blockServers` | `string[]` | `[]` | `any` | `override` | **节点服务器黑名单**：`server` 地址包含即立即丢弃（优先级高于白名单）。 |
| `specialNodeRules` | `object[]` | `[]` | `any` | `override` | **自定义特殊重命名规则**：`[{ reg: '正则/关键字', targetName: '替换名' }]`。 |
| `indexPrefixMap` | `object` | `{}` | `any` | `override` | **序号前缀映射表**：指定各订阅的序号前缀字母（如 `{ '机场A': 'A' }` ➔ `A01`）。 |
| `enableNodeRename` | `boolean` | `true` | `any` | `override` | **重命名开关**：设为 `false` 可完全原样保留订阅原有节点名称，但底层地区识别照常生效。 |
| `strictRegionMatch`| `boolean` | `false` | `any` | `override` | **地区识别严格度**：`true` 为严格官方标准字典，`false` 允许国旗 Emoji 与启发式捕获。 |
| `adTextThreshold` | `number` | `6` | `any` | `override` | **纯文本广告拦截阈值**：节点名无数字且无任何网络线路特征时，字符长度超过此值判定为广告丢弃。 |
| `lowMultiThreshold`| `number` | `0.99` | `any` | `override` | **低倍率判定阈值**：倍率 <= 此值时归入低倍率分桶（设为 `0` 关闭）。 |
| `isolateDownload` | `boolean` | `false` | `any` | `override` | **低倍率隔离**：`true` 将低倍率节点从常规大区池中移出，归入「`⏬ 下载策略`」组。 |
| `highMultiThreshold`| `number` | `2.5` | `any` | `override` | **高倍率判定阈值**：倍率 >= 此值判定为高倍率节点。 |
| `isolateHighMulti` | `boolean` | `false` | `any` | `override` | **高倍率隔离**：`true` 将高倍率节点从常规大区池移出，收拢至「`🚀 高倍率优选`」组。 |
| `isolateExperimental`| `boolean`| `false` | `any` | `override` | **实验节点隔离**：`true` 将含测试/备用等字样的节点移出常规池，收拢至「`🧪 实验节点`」组。 |
| `nodeIpVersion` | `string` | `''` | `any` | `override` | **节点连接 IP 栈策略**：`""` (原样) \| `dual` (双栈竞速，推荐) \| `ipv6-prefer` \| `ipv4-prefer` \| `ipv6` \| `ipv4`。 |

---

### 3. 策略组建组与 UI 面板

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `minorNodeThreshold`| `number` | `3` | `any` | `override` | **小众地区折叠阈值**：某地区节点数少于此值时，自动折叠并入所在大洲策略组（如欧洲、美洲）。 |
| `coreRegions` | `string[]` | `['cn', 'hk', 'tw', 'jp', 'kr', 'sg', 'us']` | `any` | `override` | **主力免折叠大区清单**：即使节点数低于阈值，也始终保持独立建组的大区代码。 |
| `regionGroupType` | `string` | `'url-test'` | `any` | `override` | **地区策略组行为类型**：`url-test` (测速优选) \| `select` (手动选择) \| `fallback` (故障转移)。 |
| `enableRegionHashLB`| `boolean`| `false` | `any` | `override` | **地区哈希负载均衡**：是否为符合条件的地区额外创建一致性哈希负载均衡组。 |
| `hideUnknownGroup`| `boolean` | `false` | `any` | `override` | **隐藏未知识别组**：是否在客户端策略组面板中隐藏「🗑️ 未知识别」策略组。 |
| `groupIconMode` | `string` | `'emoji'` | `any` | `override` | **策略组视觉风格**：`emoji` (默认带Emoji) \| `icon` (仅在线图标纯净名) \| `both` (两者皆有) \| `none` (纯文本零图标)。 |
| `groupIcons` | `object` | `{}` | `any` | `override` | **策略组图标覆写字典**：自定义策略组对应的 Emoji 或图标文件名/URL。 |
| `iconRepoOrz` | `string` | jsdelivr 镜像 | `any` | `override` | 在线图标 Orz-3 仓库根地址前缀。 |
| `iconRepoKoolson` | `string` | jsdelivr 镜像 | `any` | `override` | 在线图标 Koolson 仓库根地址前缀。 |
| `iconRepoLige47` | `string` | jsdelivr 镜像 | `any` | `override` | 在线图标 lige47 仓库根地址前缀。 |
| `exemptGroups` | `string[]` | `[]` | `local` | `additive` | **DAG 空组剪枝豁免基线追加**：追加无论节点多空都绝不被剪枝清理的策略组名称（只增不减）。 |

---

### 4. 核心分流开关

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `enableAdBlock` | `boolean` | `true` | `any` | `override` | 启用内置轻量广告与隐私追踪拦截分流（默认 REJECT）。 |
| `enableAI` | `boolean` | `true` | `any` | `override` | 启用独立 AI 助手大类与分流策略组（ChatGPT、Claude、Gemini 等）。 |
| `enableTelegram` | `boolean` | `true` | `any` | `override` | 启用 Telegram 独立分流策略组。 |
| `enableStreaming` | `boolean` | `true` | `any` | `override` | 启用全球流媒体大类与独立分流策略组（YouTube、Netflix、Disney+ 等）。 |
| `enableGame` | `boolean` | `true` | `any` | `override` | 启用全球主要游戏平台分流策略组（Steam、Epic、PlayStation、Xbox 等）。 |
| `enableSystemServices`| `boolean`| `true` | `any` | `override` | 启用操作系统云服务分流策略组（Microsoft、Apple、Google）。 |
| ~~`enableDomesticGroup`~~ | — | — | — | — | **已删除**：改为在 `routing` 的 `domestic` 条目上写 `to: 中国分流`——中国分流组只在被规则引用时生成。 |

---

### 5. 扩展分流开关

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `customServices` | `object` | `{}` | `any` | `override` | **行内自定义服务定义字典**：新增或覆写具体服务的名称、正则、图标及规则集。 |
| `aiServices` | `string[]` | `['chatgpt', 'gemini', 'claude', 'copilot']` | `any` | `override` | 激活的 AI 细分服务列表（增删 key 即可启闭对应独立策略组）。 |
| `streamingServices`| `string[]`| `['youtube', 'netflix', ...]` | `any` | `override` | 激活的流媒体细分服务列表。 |
| `socialServices` | `string[]` | `['twitter', 'facebook', 'instagram', 'discord']`| `any` | `override` | 激活的海外社交平台细分服务列表。每个服务各成一个策略组（一服务一组），可单独引用、单独排序，不再有「社交平台」合并组。 |
| `gameServices` | `string[]` | `['steam', 'epic', ...]` | `any` | `override` | 激活的游戏细分服务列表（按需拉取对应规则集与 Provider，未声明项不下载不注入，防规则臃肿与幽灵组）。 |
| `systemServices` | `string[]` | `['microsoft', 'apple', 'google']` | `any` | `override` | 激活的操作系统云服务列表。 |
| `devServices` | `string[]` | `['github', 'scholar']` | `any` | `override` | 激活的开发者与学术服务列表。 |
| `aiPreferredRegions`| `string[]`| `['us', 'jp', 'tw', 'sg', 'kr', 'eu']` | `any` | `override` | AI 服务策略组默认保底优选的大区排序（无专属节点时依序排布）。 |
| `enableAntiAD` | `boolean` | `false` | `any` | `override` | 启用激进第三方 anti-AD 规则集（高强度去广告）。 |
| `enableGitHub` | `boolean` | `true` | `any` | `override` | 开发者服务分流（控制 GitHub 独立组，需 devServices 包含 github）。 |
| `enableScholar` | `boolean` | `true` | `any` | `override` | 学术资源分流（控制 Scholar 独立组，需 devServices 包含 scholar）。 |
| `enableSocial` | `boolean` | `false` | `any` | `override` | 海外社交网络聚合分流开关。 |
| `enableCrypto` | `boolean` | `false` | `any` | `override` | 加密货币交易所与行情分流策略组（Binance、OKX、Coinbase 等）。 |
| `enablePayPal` | `boolean` | `false` | `any` | `override` | PayPal 独立金融分流策略组。 |
| `enableResidential`| `boolean`| `false` | `any` | `override` | 启用家宽/住宅 IP 节点独立成组（「🏠 家宽优选」）。 |
| `enableWebRTC` | `boolean` | `false` | `any` | `override` | WebRTC 专项分流策略组（针对 STUN / 实时音视频）。 |
| `residentialNodeGroups`| `object`| `{}` | `any` | `override` | 将家宽节点注入到指定业务策略组的映射表（如 `{ all: ['🤖 ChatGPT'] }`）。 |

---

### 6. 网络测速与规则集

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `testInterval` | `number` | `300` | `any` | `override` | 策略组自动健康检查与测速的间隔周期（秒）。 |
| `testTolerance` | `number` | `50` | `any` | `override` | `url-test` 测速切换容差（毫秒）：新节点延迟低于旧节点此数值才切换，防频繁颠簸。 |
| `useMRS` | `boolean` | `true` | `any` | `override` | **极速二进制规则集**：`true` 使用 Mihomo 原生 `.mrs` 格式（内存减半、启动秒级）；`false` 使用 yaml。 |
| `testURL` | `string` | Cloudflare 204 | `any` | `override` | 策略组延迟测试的 HTTP 探测地址。 |
| `ruleProviderCDN` | `string` | jsdelivr 镜像 | `any` | `override` | 规则集下载的 CDN 加速前缀（如 fastly.jsdelivr.net）。 |

---

### 7. DNS 与 Hosts 安全面

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `dnsListen` | `string` | `'127.0.0.1:1053'`| `local` | `override` | Mihomo 本地 DNS 监听地址与端口（绑定非回环地址需开启 `dnsAllowNonLoopback`）。 |
| `dnsAllowNonLoopback`| `boolean`| `false` | `local` | `override` | **安全铁律 INV-8**：是否允许监听非回环地址对外提供开放式 DNS 解析服务。 |
| `allowPrivateDns` | `boolean` | `false` | `local` | `override` | 是否允许使用内网/私网 IP 作为 DNS 解析器（如企业内部 DNS）。 |
| `trustedPrivateCidrs`| `string[]`| `[]` | `local` | `override` | 配合 `allowPrivateDns` 显式信任的私网解析器网段（如 `["192.168.1.0/24"]`）。 |
| `protectedDomains` | `string[]` | `[]` | `local` | `additive` | **受保护域名追加**：在内置 60+ 核心域名（GitHub/PayPal/RootCA 等）基线之外追加禁止被 hosts 覆盖的域名（只增不减）。 |
| `dnsDefault` | `string[]` | 阿里/腾讯纯IP | `local` | `override` | **基础引导 DNS**：必须为纯 IP 格式，用于解析 DoH 域名破除递归死锁。 |
| `dnsDirect` | `string[]` | 阿里/腾讯DoH | `local` | `override` | **国内直连域名解析链**：解析国内直连网站的 DoH 列表。 |
| `dnsProxy` | `string[]` | Google/CF DoH | `local` | `override` | **海外代理域名解析链**：通过代理出口查询的 DoH 列表（防 DNS 污染）。 |
| `dnsServer` | `string[]` | 阿里/腾讯纯IP | `local` | `override` | **节点服务器域名专用解析器**：直连无死锁解析订阅节点自身的 server 域名。 |

---

### 8. 安全防漏与内核覆写

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `enableProcessDirect`| `boolean`| `true` | `any` | `override` | **P2P/BT 进程防漏**：强制将 qBittorrent、Thunder 等下载工具直连，防机场封号。 |
| `enableTrafficAudit` | `boolean`| `true` | `any` | `override` | **流量审计防漏**：强制非标端口（非 53/80/443 等常用服务端口）直连，防恶意吸血流量。 |
| `enableQUICReject` | `boolean` | `false` | `any` | `override` | **QUIC (UDP 443) 拦截**：海外 QUIC 连接拒绝，强制回退 TCP，有效缓解 UDP QoS 限速与缓冲。 |
| `overwriteTun` | `boolean` | `true` | `any` | `override` | 注入高性能 TUN 虚拟网卡配置（包括 gvisor 协议栈、mtu 优化与自动路由）。 |
| `overwriteDns` | `boolean` | `true` | `any` | `override` | 覆写内核 DNS 总开关（启用权威防污染 Fake-IP 分流解析体系）。 |
| `overwriteSniffer` | `boolean` | `true` | `any` | `override` | 注入精确域名嗅探器配置（嗅探 TLS SNI 与 HTTP Host，提高路由准确度）。 |
| `enableCoreOptimize`| `boolean` | `true` | `any` | `override` | 启用内核层全面性能调优（TCP 并发竞速、客户端指纹伪装、连接保持等）。 |

---

### 9. 节点裂变

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `enableFission` | `boolean` | `false` | `any` | `override` | **单域名多 IP 裂变开关**：将单个 DDNS 域名节点并发解析为多个物理实体节点。 |
| `fissionStack` | `string` | `'all'` | `any` | `override` | 裂变协议栈偏好：`all` (双栈保留) \| `v4` (仅 IPv4) \| `v6` (仅 IPv6)。 |
| `fissionMaxNodes` | `number` | `5` | `any` | `override` | 单个域名最大允许裂变产生的子节点数量。 |
| `fissionExcludeKeywords`| `string[]`| `[]` | `any` | `override` | 包含这些关键词的节点跳过裂变（如含“负载均衡”或“故障转移”的节点）。 |

---

### 10. 规则集与图标仓库来源

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `geositeRepo` | `string` | `MetaCubeX/meta-rules-dat...` | `any` | `override` | geosite 域名规则集上游仓库路径（配合 `ruleProviderCDN` 拼接）。 |
| `geoipRepo` | `string` | `MetaCubeX/meta-rules-dat...` | `any` | `override` | geoip 网段规则集上游仓库路径（配合 `ruleProviderCDN` 拼接）。 |

---

### 11. 进程分流名单

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `processDirectWin` | `string[]` | `['qBittorrent', 'Thunder', 'BitComet', 'uTorrent', 'aria2c']` | `any` | `override` | Windows 下强制直连的进程名列表。 |
| `processDirectMac` | `string[]` | `['Thunder', 'BitComet', 'qbittorrent', ...]` | `any` | `override` | macOS 下强制直连的进程名列表。 |
| `processDirectLin` | `string[]` | `['qbittorrent', 'aria2c', 'transmission-daemon']` | `any` | `override` | Linux 下强制直连的进程名列表。 |
| `processProxyWin` | `string[]` | `['IDMan', 'fdm']` | `any` | `override` | Windows 下强制走下载代理策略组的进程名单。 |
| `processProxyMac` | `string[]` | `['fdm']` | `any` | `override` | macOS 下强制走下载代理策略组的进程名单。 |
| `processProxyLin` | `string[]` | `[]` | `any` | `override` | Linux 下强制走下载代理策略组的进程名单。 |

---

### 12. 订阅源与拉取设置

> 💡 **说明**：此分类字段未设出厂硬编码默认值（在代码内优雅兜底），声明在配置中可立即生效。

| 参数名 | 类型 | 运行兜底 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `subscriptions` | `object[]` | `[]` | `any` | `override` | **订阅清单**：支持 URL、单节点 URI 或结构化对象，详见下方示例。 |
| `fetchProxyPort` | `number` | `undefined` | `local` | `override` | 本机抓取代理端口（如 `7890`）。留空表示直连拉取。 |
| `fetchProxyStrategy`| `string` | `'auto'` | `local` | `override` | 抓取策略：`direct` (直连) \| `proxy` (代理) \| `auto` (失败自动走代理重试)。 |
| `fetchRetry` | `number` | `2` | `any` | `override` | 单次拉取失败自动重试次数（超时/网络抖动/5xx 重试，4xx 快速失败）。 |
| `fetchTimeout` | `number` | `15` | `any` | `override` | 单次订阅请求超时时间（秒）。 |
| `fetchStaleTtl` | `number` | `24` | `any` | `override` | 订阅拉取发生故障时，容灾复用上一次成功缓存内容的小时数（设为 `0` 关闭）。 |
| `expireAggregation` | `string` | `'min'` | `any` | `override` | 多订阅聚合时到期时间的计算方式：`min` (最早到期预警，推荐) \| `max` \| `first`。 |

```yaml
# 订阅声明示例
subscriptions:
  - url: "https://my-sub.com/api/v1/client"
    tag: "主力机场"
    resetDay: 15       # 每月 15 号重置流量
  - uri: "hysteria2://password@hk.vps.com:443"
    name: "🇭🇰 我的自建 VPS"
    keepName: true     # 保留原名不被模板覆盖
    groups:            # 直接定向注入到指定策略组
      - "🤖 ChatGPT"
      - "📍 手动选择"
```

---

### 13. 运行模式与缓存

| 参数名 | 类型 | 运行兜底 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `outputMode` | `string` | `'config'` | `any` | `override` | **交付形态**：`config` (完整配置) \| `nodes` (仅纯净 proxies 节点) \| `report` (审计报告 JSON)。 |
| `output` | `string` | `'./dist/config.yaml'` | `local` | `override` | CLI 运行模式下最终文件的输出落地路径。 |
| `enableCache` | `boolean` | `true` | `any` | `override` | 常驻服务模式下，是否启用内存构建缓存（根据完整配置结构指纹隔离）。 |
| `cacheTtl` | `number` | `300` | `any` | `override` | **新鲜缓存有效时间**（秒）：此窗口内请求秒级命中 Fresh 缓存。 |
| `cacheStaleMaxAge` | `number` | `86400` | `any` | `override` | **SWR 陈旧缓存最大容忍秒数**（默认 24h）：在此窗口内返回已有快照并异步重构。 |
| `redactLevel` | `string` | `'partial'`| `local` | `override` | **日志脱敏档位**：`off` (本地开发完整展示) \| `partial` (生产推荐屏蔽凭据) \| `full` (隐藏全部IP与域名)。 |
| `enableChineseConvert`| `boolean`| `false` | `any` | `override` | 是否启用节点与策略组名称的简繁中文全链路转换（需安装 `opencc-js`）。 |
| `chineseConvertMode` | `string` | `'s2t'` | `any` | `override` | 转换方向：`s2t` (简体转繁体) \| `t2s` (繁体转简体)。 |

---

### 14. 自定义规则入口

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `customRules` | `string[]` | `[]` | `local` | `override` | **最先执行的自定义规则**：直接注入到 MATCH 之前，优先级最高（如 `DOMAIN-SUFFIX,company.com,DIRECT`）。 |
| `customRuleProviders`| `object` | `{}` | `local` | `override` | 自定义 Mihomo `rule-providers` 字典（声明外部规则集地址、行为与更新周期）。 |
| `customGroups` | `object[]` | `[]` | `local` | `override` | **声明式策略组 DSL 清单**：完整支持配方、宏展开与原生参数透传。 |
| `groups` | `object[]` | - | `local` | `override` | **统一策略组声明清单**：`{ ref: <键> }` 引用内置组目录（列了即激活，可覆写任意字段 / `disabled: true` 关闭），目录之外的组直接完整声明。 |
| `subDomain` | `string \| string[]` | `[]` | `any` | `override` | **订阅服务域名或 IP**：自动注入为最前列直连规则与 fake-ip-filter，防刷新订阅陷入代理死锁。 |

---

### 15. 安全与资源配额

| 参数名 | 类型 | 默认值 | 信任 | 合并 | 功能说明与设计意图 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `security` | `object` | 内部默认 | `local` | `override` | **服务运行资源配额**：定义单次允许的最大节点数、最大订阅包大小等防 DoS 阈值。 |
| `hosts` | `object` | `{}` | `local` | `override` | 静态自定义 hosts 映射表（受保护的核心域名默认被拒绝修改）。 |
| `nameserverPolicy` | `object` | `{}` | `local` | `override` | 按域分流解析规则链（保留键不可覆盖）。 |
| `trustedHostDomains`| `string[]` | `[]` | `local` | `override` | 允许被 hosts 覆盖的受保护域名豁免白名单（极少数需要 mock 的场景，谨慎使用）。 |
| `allowInternalHosts`| `boolean` | `false` | `local` | `override` | 是否允许 hosts 解析指向局域网/保留私网地址（防内网探测 SSRF）。 |
| `fakeIpFilter` | `string[]` | `[]` | `local` | `override` | 追加至内核 `fake-ip-filter` 的自定义放行域名列表。 |
| `fakeIpFilterNodes`| `string` | `'smart'` | `local` | `override` | 节点防环注入模式：`smart` (智能主域泛化) \| `exact` (逐项保留) \| `off` (关闭)。 |

---

## 四、典型场景配置配方

### 配方 A：轻量日常极速版 (简洁优雅)

追求极简、清爽界面与低开销的用户首选：

```yaml
outputMode: "config"
output: "./dist/config.yaml"

# 抓取容灾
fetchProxyPort: 7890
fetchProxyStrategy: "auto"

# 订阅
subscriptions:
  - url: "https://my-sub.example.com/api/v1/client"
    tag: "主力机场"

# 节点清洗
enableDedupe: true
enableNodeSort: true
enableNodeRename: true
showFeatureIcon: true

# 视觉体验：纯净名称，仅保留高清图标
groupIconMode: "icon"

# 极速二进制规则集
useMRS: true
```

---

### 配方 B：高要求 AI 与流媒体玩家版

追求精细化流媒体解锁、AI 保障与高倍率防偷跑：

```yaml
outputMode: "config"

# 订阅
subscriptions:
  - url: "https://airport-a.com/sub"
    tag: "主线机场"
  - url: "https://airport-b.com/sub"
    tag: "备用机场"

# 高级分桶门控
isolateHighMulti: true
highMultiThreshold: 2.5
isolateDownload: true

# 分流开关全开
enableAI: true
enableStreaming: true
enableSocial: true
enableGame: true
enableGitHub: true
enableQUICReject: true # 拒绝海外 QUIC 强制回退 TCP 提高画质

# 自定义流媒体策略组
customGroups:
  - name: "专属流媒体"
    emoji: "🎬"
    type: url-test
    tolerance: 30
    match:
      region: ["hk", "tw", "jp", "sg"]
      tags: ["streaming"]
      multi: "<= 1.5"
    proxies:
      - "@matchedNodes"
      - "@defaultProxy"
      - "DIRECT"
```

---

### 配方 C：HomeLab / 软路由局域网网关版

针对透明网关、软路由或家庭内网中枢场景：

```yaml
outputMode: "config"

# 软路由局域网监听 (遵循安全铁律 INV-8)
dnsListen: "0.0.0.0:53"
dnsAllowNonLoopback: true

# 允许局域网私网解析器
allowPrivateDns: true
trustedPrivateCidrs:
  - "192.168.1.0/24"

# 节点防环智能泛化
fakeIpFilterNodes: "smart"

# 核心安全与防漏
overwriteTun: true
overwriteDns: true
enableProcessDirect: true
enableTrafficAudit: true
```

---

### 配方 D：模块化片段架构 (`include`)

通过 `include` 将主配置与个人私密规则解耦：

**`config.yaml`（主配置文件）**：
```yaml
include:
  - "./configs/base-rules.yaml"
  - "./configs/my-custom-groups.yaml"
  - "./configs/private-servers.local.yaml"

outputMode: "config"
logLevel: "info"
groupIconMode: "emoji"
```

**`configs/my-custom-groups.yaml`（策略组片段）**：
```yaml
customGroups:
  - name: "极速日韩"
    emoji: "⚡"
    type: url-test
    match:
      region: ["jp", "kr"]
      multi: "<= 1.0"
    proxies:
      - "@matchedNodes"
      - "DIRECT"
```
