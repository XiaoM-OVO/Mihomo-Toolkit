# 默认值审查（批次 3 前置）

> 目的：两表模型落地前，把「当前默认值到底是什么、改一个会动多少产物」列清楚，供人工逐项确认。
> 数据来源：2026-10-20 对未改动默认配置的实测（`test/fixtures/default-output.scenario.js` 的 6 节点样本），
> 逐项翻转后与基线做产物对比（策略组 / 规则 / Rule-Provider）。
> 规格依据：`ROADMAP.md` 第十节 10.8 第 1 条与 10.9——基线允许变更，但必须显式说明。

## 一、基线

| 指标 | 数值 |
| :--- | :--- |
| 策略组 | 32 |
| 路由规则 | 59 |
| Rule-Provider | 42 |

## 二、开关默认值

「翻转影响」是该开关从默认值改成相反值后，产物增减的数量（样本固定，不含节点信息差异）。

| 开关 | 默认 | 翻转 | 产物影响 |
| :--- | :--- | :--- | :--- |
| `enableAdBlock` | **开** | 关 | −1 组（🚫 广告拦截）、−1 规则、−1 provider |
| `enableAntiAD` | 关 | 开 | +1 规则、+1 provider（同组） |
| `enableAI` | **开** | 关 | −4 组（ChatGPT / Gemini / Claude / Copilot）、−4 规则、−4 provider |
| `enableStreaming` | **开** | 关 | −9 组、−9 规则、−9 provider |
| `enableSocial` | 关 | 开 | +4 组（Twitter / Facebook / Instagram / Discord）、+4 规则、+4 provider |
| `enableGame` | **开** | 关 | −2 组（游戏服务 / 游戏下载）、−14 规则、−11 provider |
| `enableDevServices`（GitHub / 学术） | **开** | 关 | GitHub：−1 组、−1 规则、−1 provider；学术：−1 组、−2 规则、−1 provider |
| `enableSystemServices` | **开** | 关 | −3 组（Microsoft / Apple / Google）、−3 规则、−3 provider |
| `enableTelegram` | **开** | 关 | −1 组、−3 规则、−2 provider |
| `enableCrypto` | 关 | 开 | +1 组、+1 规则、+1 provider |
| `enablePayPal` | 关 | 开 | +1 组、+1 规则、+1 provider |
| `enableWebRTC` | 关 | 开 | +1 组、+7 规则 |
| `enableResidential` | 关 | 开 | +1 组（🏠 家宽优选），无规则 |
| `enableDomesticGroup` | 关 | 开 | +1 组（🇨🇳 中国分流）、+2 规则、−2 规则（国内规则目标由 DIRECT 改为该组） |
| `enableQUICReject` | 关 | 开 | +2 条 `AND` 规则（UDP 443 → REJECT-DROP） |
| `enableProcessDirect` | **开** | 关 | −9 规则（进程直连名单）、+2 规则（BT 目标由 DIRECT 改为下载策略） |
| `enableTrafficAudit` | **开** | 关 | −2 规则（`DST-PORT,53/80/443` 与 `DST-PORT,1-65535`） |
| `enableRegionHashLB` | 关 | 开 | +1 组（⚖️ 负载均衡-哈希），需要节点支持 |
| `enableDashboard` | **开** | 关 | 样本下无差异（看板依赖节点信息） |

## 三、默认规则顺序（59 条）

顺序即优先级（先到先得）。下表是产物中的最终顺序，组名带 emoji 是因为展示层已装饰；
组装期内部用的是干净名（如 `ChatGPT`、`广告拦截`）。`default-routing` 表必须逐条复现这个顺序。

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
40  PROCESS-NAME,qBittorrent.exe,DIRECT
41  PROCESS-NAME,Thunder.exe,DIRECT
42  PROCESS-NAME,BitComet.exe,DIRECT
43  PROCESS-NAME,uTorrent.exe,DIRECT
44  PROCESS-NAME,aria2c.exe,DIRECT
45  RULE-SET,bt-trackers-pt,DIRECT
46  RULE-SET,bt-trackers-public,DIRECT
47  DOMAIN-KEYWORD,tracker,DIRECT
48  DOMAIN-KEYWORD,announce,DIRECT
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

## 四、需要拍板的点

以下是我在实测中发现的、默认值「看起来可能不符合直觉」的地方。每条都只是提问，不代表要改。

1. **广告默认开，且排在 AI / 流媒体之前。**
   影响：广告域名先被拦截，即使它同时命中某个 AI 服务的规则集。
   问题：这是想要的效果吗？（拦截优先 vs 服务优先）
2. **QUIC 拦截默认关。**
   影响：UDP 443 的 QUIC 流量不会强制降级到 TCP，部分节点上 QUIC 走代理体验更差。
   问题：默认是否应该开？
3. **`enableDomesticGroup` 默认关。**
   影响：国内域名/IP 直接 `DIRECT`（规则目标就是 `DIRECT`），并不会生成「🇨🇳 中国分流」组；
   截图里没有这个组是正常的。打开后才多出一个可手动切换的组。
   问题：这个组的存在意义是「可手切」，还是应该干脆去掉？
4. **`enableTrafficAudit` 默认开。**
   影响：`DST-PORT,1-65535,DIRECT` 会把所有走到第 57 条之后的非 80/443 流量直连。
   问题：是否有需要走代理的非标准端口服务会被这条静默放行？
5. **`enableProcessDirect` 默认开。**
   影响：BT 客户端进程 + `tracker` / `announce` 关键字直连；关闭后 BT 规则集改走下载策略组。
   问题：默认直连是否与「下载也走代理」的使用习惯冲突？
6. **`enableSocial` 默认关，但 `socialServices` 已预置 4 项。**
   问题：保持默认关，还是像流媒体一样默认开？
7. **`enableDashboard` 默认开。**
   影响：样本下无产物差异；真实节点上会多出看板相关产物。
   问题：无节点信息时会怎样，是否需要改成按需？
8. **`MATCH` 默认走代理（🐟 漏网之鱼），不是 `DIRECT`。**
   影响：所有未命中流量（含未知端口）默认消耗机场流量。
   问题：这是有意为之的「默认代理」吗？

另有两条顺序事实（不是默认值问题，但会影响 PR 评审）：

- 第 3 条 `ads` 固定在最前，因此「广告拦截」永远优先于任何服务规则。
- 第 17–20 条把 `steamcontent.com` / `download.epicgames.com` 放在各自服务规则之前，
  下载域名优先命中「游戏下载」组，属于有意设计。

## 五、结论

- 批次 3 的机制迁移**不改动任何默认值**；上表如有调整，单独成笔并在提交信息中说明变化与影响。
- 本文的 59 条顺序将作为 `src/data/default-routing.js` 的等价校验基准（见
  `test/pipeline/routing-expansion.test.js`）。
