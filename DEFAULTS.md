# 默认产物基线说明

> 用途：说明出厂默认产物包含什么、改动一个条目会影响多少产物，作为默认值变更的对照基准。
> 落地位置：规则顺序在 `src/data/default-routing.js`，字段默认值在 `src/data/field-registry.js`；
> 本文的 59 条顺序由 `test/pipeline/routing-expansion.test.js` 的等价用例守护。
> 基线允许变更，但必须显式说明影响（`ROADMAP.md` 10.8 / 10.9）。

## 一、基线规模

数据来自 `test/fixtures/default-output.scenario.js` 的 6 节点固定样本；真实节点信息更多，组与节点数量会相应变化，下表的规则与 provider 数量不受影响。

| 指标 | 数值 |
| :--- | :--- |
| 策略组 | 32 |
| 路由规则 | 59 |
| Rule-Provider | 42 |

## 二、条目增减对产物的影响

规则与建组都由 `routing` 表决定，`routing` 之外的开关只剩与规则无关的几个。
下表第一列是**表里的条目**：「出厂」列表示它是否在出厂表中，最后一列是增删它以后的产物增减（样本固定，不含节点信息差异）。

| `routing` 条目 | 出厂 | 改动 | 产物影响 |
| :--- | :--- | :--- | :--- |
| `{ service: 'ad-block' }` | 有 | 删 | −1 组（🚫 广告拦截）、−1 规则、−1 provider |
| `{ service: 'anti-ad' }` | 无 | 加 | +1 规则、+1 provider（与 ad-block 同组） |
| `{ preset: 'ai' }` | 有 | 删 | −4 组（ChatGPT / Gemini / Claude / Copilot）、−4 规则、−4 provider |
| `{ preset: 'streaming' }` | 有 | 删 | −9 组、−9 规则、−9 provider |
| `{ preset: 'social' }` | 无 | 加 | +4 组（Twitter / Facebook / Instagram / Discord）、+4 规则、+4 provider |
| `{ preset: 'game' }` | 有 | 删 | −2 组（游戏服务 / 游戏下载）、−14 规则、−11 provider |
| `{ preset: 'dev' }` | 有 | 删 | −2 组（GitHub / 学术）、−3 规则、−2 provider |
| `{ preset: 'system' }` | 有 | 删 | −3 组（Microsoft / Apple / Google）、−3 规则、−3 provider |
| `{ service: 'telegram' }` | 有 | 删 | −1 组、−3 规则、−2 provider |
| `{ service: 'crypto' }` | 无 | 加 | +1 组、+1 规则、+1 provider |
| `{ service: 'paypal' }` | 无 | 加 | +1 组、+1 规则、+1 provider |
| `{ service: 'webrtc' }` | 无 | 加 | +1 组、+7 规则 |
| `{ preset: 'quic' }` | 无 | 加 | +2 条 `AND` 规则（UDP 443 → REJECT-DROP） |
| `{ preset: 'process' }` | 无 | 加 | 按 `customProcess*` 名单生成进程规则；出厂名单为空，默认 DIRECT，可用 `to` 整段改道 |
| `{ preset: 'bt' }` | 有 | 删 | −9 规则（4 条 BT 追踪器 + 5 条 BT 客户端进程规则） |
| `{ preset: 'download' }` | 有 | 删 | −5 规则（2 条下载软件进程 + 3 条下载规则集），下载进程默认走「下载策略」 |
| `{ preset: 'domestic', to: '中国分流' }` | 无 | 加 | +1 组（🇨🇳 中国分流）、国内规则目标由 DIRECT 改为该组 |
| `enableIsolation` | 关 | 开 | 有合格节点时 +3 组 / 池（🏠 家宽优选、🚀 高倍率优选、🧪 实验节点，各自独立建组），并把成员从主力池剔除；无合格节点则不建组 |
| `pools` | 无 | 加 | 自定义池被 `routing` 引用时 +1 组；按需池未被引用时不建组 |
| `enableTrafficAudit` | **开** | 关 | −2 规则（`DST-PORT,53/80/443` 与 `DST-PORT,1-65535`） |
| `trafficDirection` | `'split'` | `'return'` | DNS 上游互换、QUIC 拦截的 CN / 非 CN 分支翻转、WebRTC 组成员顺序翻转；规则顺序与目标不变（走向由 `routing` 的 `to` 决定） |
| `enableRegionHashLB` | 关 | 开 | +1 组（⚖️ 负载均衡-哈希），需要节点支持 |
| `enableDashboard` | **开** | 关 | 样本下无差异（看板依赖节点信息） |

## 三、默认规则顺序（展开期 59 条，空池产物 55 条）

顺序即优先级（先到先得）。下表是产物中的最终顺序，组名带 emoji 是因为展示层已装饰；
组装期内部用的是干净名（如 `ChatGPT`、`广告拦截`）。出厂 `default-routing` 表已逐条复现这个顺序，并由 `test/pipeline/routing-expansion.test.js` 的等价用例守住。
标注为「下载策略」的行依赖低倍率池：池为空、该组不装配时，这些规则会被 DAG 剪除（默认样本产物因此为 55 条）。

```text
 1  RULE-SET,lan-domain,DIRECT
 2  RULE-SET,lan-ip,DIRECT,no-resolve
 3  RULE-SET,ads,🚫 广告拦截
 4  RULE-SET,openai,🤖 ChatGPT
 5  RULE-SET,gemini,♊ Gemini
 6  RULE-SET,claude,🦀 Claude
 7  RULE-SET,bing,🐙 Copilot
 8  RULE-SET,youtube,▶️ YouTube
 9  RULE-SET,netflix,🎬 Netflix
10  RULE-SET,bilibili,📺 BiliBili
11  RULE-SET,disney,🪄 Disney+
12  RULE-SET,spotify,🎧 Spotify
13  RULE-SET,tiktok,🎵 TikTok
14  RULE-SET,bahamut,📺 Bahamut
15  RULE-SET,pixiv,🅿️ Pixiv
16  RULE-SET,twitch,🎮 Twitch
17  DOMAIN-SUFFIX,steamcontent.com,🎮 游戏下载
18  RULE-SET,steam-cn,🎮 游戏下载
19  RULE-SET,steam,🎮 游戏服务
20  DOMAIN-SUFFIX,download.epicgames.com,🎮 游戏下载
21  RULE-SET,epic,🎮 游戏服务
22  DOMAIN-SUFFIX,epicgames.com,🎮 游戏服务
23  RULE-SET,riot,🎮 游戏服务
24  RULE-SET,blizzard,🎮 游戏服务
25  RULE-SET,nintendo,🎮 游戏服务
26  RULE-SET,playstation,🎮 游戏服务
27  RULE-SET,xbox,🎮 游戏服务
28  RULE-SET,ubisoft,🎮 游戏服务
29  RULE-SET,origin,🎮 游戏服务
30  RULE-SET,ea,🎮 游戏服务
31  RULE-SET,github,🐱 GitHub
32  DOMAIN-KEYWORD,sci-hub,🎓 学术网站
33  RULE-SET,scholar,🎓 学术网站
34  PROCESS-NAME,Telegram.exe,✈️ Telegram
35  RULE-SET,telegram,✈️ Telegram
36  RULE-SET,telegram-ip,✈️ Telegram,no-resolve
37  RULE-SET,microsoft,🪟 Microsoft
38  RULE-SET,apple,🍎 Apple
39  RULE-SET,google,🔍 Google
40  RULE-SET,bt-trackers-pt,DIRECT
41  RULE-SET,bt-trackers-public,DIRECT
42  DOMAIN-KEYWORD,tracker,DIRECT
43  DOMAIN-KEYWORD,announce,DIRECT
44  PROCESS-NAME,qBittorrent.exe,DIRECT
45  PROCESS-NAME,Thunder.exe,DIRECT
46  PROCESS-NAME,BitComet.exe,DIRECT
47  PROCESS-NAME,uTorrent.exe,DIRECT
48  PROCESS-NAME,aria2c.exe,DIRECT
49  PROCESS-NAME,IDMan.exe,⏬ 下载策略
50  PROCESS-NAME,fdm.exe,⏬ 下载策略
51  RULE-SET,download-games-cn,DIRECT
52  RULE-SET,download-games,⏬ 下载策略
53  RULE-SET,download-android,⏬ 下载策略
54  RULE-SET,non-cn,🚀 自动选择
55  RULE-SET,cn-domain,DIRECT
56  RULE-SET,cn-ip,DIRECT,no-resolve
57  DST-PORT,53/80/443,🐟 漏网之鱼
58  DST-PORT,1-65535,DIRECT
59  MATCH,🐟 漏网之鱼
```

## 四、默认取舍（已定案）

- **广告优先**：`ads` 固定在最前，广告拦截优先于任何服务规则。
- **下载优先于游戏服务**：第 17–20 条把 `steamcontent.com` / `download.epicgames.com` 放在游戏服务规则之前，下载域名先命中「游戏下载」。
- **QUIC 默认不拦**：需要时加 `{ preset: 'quic' }`。
- **社交默认不开**：需要时加 `{ preset: 'social' }`。
- **BT 段默认直连**：`{ preset: 'bt' }` 同时覆盖 BT 客户端进程与 tracker，默认直连，`to` 可整段改道。
- **下载段默认走下载策略**：`{ preset: 'download' }` 同时覆盖下载软件进程（IDMan / fdm）与下载规则集，默认指向「下载策略」。
- **自定义进程按需开启**：`{ preset: 'process' }` 不在出厂表内，`customProcess*` 默认名单为空，仅用于补充自定义进程；默认直连，支持 `to` 改道。
- **兜底默认走代理**：`MATCH` 指向 `🐟 漏网之鱼`，未命中流量默认消耗机场流量，而非直连。
- **非标端口默认直连**：`enableTrafficAudit` 默认开，`DST-PORT,1-65535,DIRECT` 会放行第 58 条之后的非标准端口。

## 五、变更规则

- 调整默认值：改 `src/data/default-routing.js`（规则/建组）或字段注册表（字段默认值），单独成笔。
- 提交信息必须写明变化与产物影响（组 / 规则 / provider 的增减）。
- 同步更新本文第一节的基线数字与第三节的顺序；59 条顺序是 `routing-expansion.test.js` 的等价校验基准。
