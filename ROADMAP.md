# 🗺️ 功能恢复路线图（ROADMAP）

> 本文件**不是**设计文档。设计真相归 [`ARCHITECTURE.md`](ARCHITECTURE.md)，
> 本文件只记录**旧版能力搬进 `mihomo-toolkit-next` 的进度与决策**，用于跨会话抗遗忘、防漏防重。

## 定位与真相源

| 项 | 说明 |
| :--- | :--- |
| 恢复目标 | 把旧版能力逐块搬进新版统一流水线 |
| 真相源 | 旧版工程 `E:\CODE\mihomo-toolkit` 的 [`config.example.yaml`](../mihomo-toolkit/config.example.yaml)（主要）、`README.md` / `CHANGELOG.md`（补充） |
| 对照口径 | 以**配置字段**为最小单位：旧版示例里出现的字段，在新版注册表 [`src/data/field-registry.js`](src/data/field-registry.js) 中是否存在、是否有代码读取 |

### 四态定义（维护规则：只记状态 + 来源，不写设计细节）

| 标记 | 含义 |
| :--- | :--- |
| ✅ **已恢复** | 字段已登记入注册表，且有代码真实读取 |
| ⏳ **待恢复** | 旧版存在，新版尚未搬回，且**已确认要做** |
| ⏸️ **暂缓** | 有意不做，需求出现再议 |
| 🔁 **已替代 / 已废弃** | 经判断**不再恢复**：由新设计替代，或确认无价值 |

> ⚠️ 维护纪律：本文件条目**只允许**在上述四态间迁移。
> 不得在此写接口设计、合并语义、实现方案——那些一律进 `ARCHITECTURE.md`。

---

## 一、⏳ 待恢复

**本轮（2026-10-02）已清零。** 原有 6 项缺口全部落定：1 项暂缓、2 项废弃、3 项已恢复/已处理（见 §三）。

---

## 二、⏸️ 暂缓（有意不做，需求出现再议）

| 能力 | 旧版来源 | 涉及字段 | 暂缓理由 |
| :--- | :--- | :--- | :--- |
| **IP 富化子系统**（ip-api.com 地理/ASN/运营商补全） | 旧版 ⑦ | `enableIpEnrich`、`ipEnrichMode`、`ipEnrichTimeout`、`ipEnrichThreshold`、`ipApiKey`、`ipApiEndpoint`、`ipApiBatchSize`、`ipApiBatchDelay`、`ipApiDnsConcurrency`、`ipApiDnsEndpoint`、`enableIpv6Tag`、`enableCellularTag`、`enableResidentialTag`（13 项） | ① 家宽/机房判定是 IP"用途分类"，**免费库（GeoLite2/ip2region/DB-IP Lite）均无此字段**，付费库才准，性价比低；② ip-api.com 限流、不稳定、且会把节点 IP 传给第三方；③ next 现行依赖全为轻量纯 JS，引入数据文件会破坏基调。**家宽分流已由节点名关键词识别覆盖**，无实际阻塞。 |

> **决策留痕**：若将来重新评估，优先考虑"本地库只做地理/城市/ASN（供 `{isp}/{asn}/{org}` 模板变量），家宽继续走关键词"的折中路线；
> 不建议恢复 ip-api.com 在线方案。旧版**没有**残留代码需要清理——next 从未实现过 IP 富化。

---

## 三、✅ 本轮改动与恢复（2026-10-02）

| 项 | 处置 | 说明 |
| :--- | :--- | :--- |
| **节点黑名单** `blockKeywords` / `blockServers` | ✅ 新实现 | 清洗层拦截：节点名 / `server` 字段命中即拦截，**优先于白名单**（显式拒绝不应被白名单放行）。已登记注册表 + `index.d.ts` + 示例 + 回归用例。 |
| **`biliPreferredRegions`** | ✅ 判已恢复 | next 已在 [`src/config/catalog.js`](src/config/catalog.js#L188) 内置 bilibili `preferredRegions: ['cn','tw','mo','hk']`，且 [`catalog.js`](src/config/catalog.js#L632) 允许 `customServices` 覆盖 → 能力已在，无需独立字段。 |
| **`enableStandardRename`** | ✅ 已处理 | 在 [`src/pipeline/nodes.js`](src/pipeline/nodes.js#L83) 原是**死读取**（从未登记、恒为 `undefined`、零效果）。已删除，语义由 `enableNodeRename` 覆盖。 |
| **`customPrefix`** | 🔁 已废弃 | 现有 tag 系统 + `indexPrefixMap` + 重命名模板已覆盖该需求，无需专门字段。 |
| **`dnsMergeMode`** | 🔁 已废弃 | 旧版确有实现，但 next 的独立 DNS 安全面（`protectedDomains` / `assetClosure` / `fakeIpFilter` 等）已更强，不再恢复分级。 |

---

## 四、✅ 已恢复（对照确认，非本轮新增工作）

| 旧版区块 | 状态 | 备注 |
| :--- | :-: | :--- |
| ① 订阅源与节点注入 | ✅ | 新增订阅级 `master`（当前仅记录于审计报告） |
| ② 运行模式与输出 | 🔁 | 见 §五，三模式被 `outputMode` 取代 |
| ③ 部署与安全 | ✅ | 新增 `maxConcurrentBuilds`、`security.maxSubscriptionBytes` |
| ④ 简繁转换 | ✅ | — |
| ⑤ 节点清洗 | ✅ | 新增 `removeInfoNodes`、`enableAirportTag`；黑名单本轮补齐 |
| ⑥ 节点重命名 | ✅ | `customPrefix` 废弃、`enableStandardRename` 处理（§三）；`{isp}/{asn}/{org}` 随 IP 富化暂缓 |
| ⑦ IP 补全检测 | ⏸️ | 暂缓（§二） |
| ⑧ 节点裂变 | ✅ | — |
| ⑨ 注入节点分组 | ✅ | `specialNodeRules`、`customNodeGroups` 均在 |
| ⑩ 策略组与地区分组 | ✅ | 新增 `exemptGroups`、`isolateExperimental` |
| ⑪ 核心分流开关 | ✅ | 全量（AI/流媒体/社交/游戏/系统/中国/TG/广告/反广告/GitHub/学术/WebRTC/加密货币/PayPal） |
| ⑫ 服务注册表 | ✅ | 新增 `gameServices`、`devServices`、`customServices`、`include`、`servicesConfigFile`；bili 地区偏好已内置可覆盖 |
| ⑬ 进程级分流名单 | ✅ | 六个平台名单齐备 |
| ⑭ 测速与规则集 | ✅ | 新增 `geositeRepo`、`geoipRepo` 正式登记 |
| ⑮ DNS | ✅ | 大幅增强：安全铁律组 `dnsAllowNonLoopback` / `protectedDomains` / `assetClosure` / `trustedPrivateCidrs` 等 |
| ⑯ 安全防漏与内核覆写 | ✅ | `dnsMergeMode` 废弃（§三），其余齐备 |

**小结：17 个区块中 16 个已恢复，1 个暂缓。**

---

## 五、🔁 已替代 / 已废弃（不再恢复）

| 旧版能力 | 旧版来源 | 处置 | 理由 |
| :--- | :--- | :--- | :--- |
| `type: pure / toolkit / full` 三运行模式 | 旧版 ② | 由 `outputMode: config / nodes / report` 替代 | 新版流水线统一，双端概念取消；`type` 保留为 `outputMode` 兼容别名 |
| `pureConfig` / `toolkitConfig` 双端差异化覆盖 | 旧版 ⑰ | 废弃 | 依赖"双端"概念，随统一流水线一并取消 |
| `outputMode: array/object`、`outputGarbage`、`outputUnknown`（pure 专属） | 旧版 ⑰ | 废弃 | 同上 |
| `meta`（清洗统计报告导出路径） | 旧版 ② | 由 `outputMode: report` 替代 | 报告成为独立交付形态，不再单设路径字段 |
| `customPrefix` | 旧版 ⑥ | 废弃 | tag 系统 + 模板已覆盖（§三） |
| `dnsMergeMode` | 旧版 ⑯ | 废弃 | 已被更强的 DNS 安全面取代（§三） |

---

## 六、架构侧路线图（非旧版恢复项）

来自 [`ARCHITECTURE.md` §七](ARCHITECTURE.md#L441)，与"旧版恢复"无关，属新能力建设：

1. **声明式策略组模型** —— 目前 `customNodeGroups` 只能把节点塞进已有组，**无法新建自定义策略组**。属 2.x 路线图，工程量大，建议单独立项。
2. **服务激活易踩坑** —— 服务需同时写进 `customServices` 与激活列表（`aiServices` 等）才生效，只写一处会静默不激活。可考虑收敛为单点声明。
3. **`?config=` 能力剥夺为黑名单式** —— 未来内核新增的控制面字段不会自动被剥夺；公开部署应使用 `enableUrlParams: false` 或强制 `authToken`。
4. **反隐形守卫存在盲区** —— [`test/config-surface.test.js`](test/config-surface.test.js#L69) 的扫描正则只匹配 `userConfig.` / `cfg.`，**不覆盖 `config.` 形式的读取**。本轮已删除唯一的此类死读取（`enableStandardRename`），但盲区仍在。是否收紧要权衡误报——`config.` 也可能指向非用户配置对象。

---

## 七、维护规则

- 每完成一项：在 §三 记决策、在 §四 改状态；若属新增能力，同步更新 `ARCHITECTURE.md`。
- 新增/恢复字段必须走注册表 → `index.d.ts` → `config.example.yaml` → 测试这条链（`test/config-surface.test.js` 会强制校验，漏一步即失败）。
- 本文件与代码事实冲突时，**以代码为准**，并立即修正本文件。
