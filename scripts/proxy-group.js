// =========================================================================
// Clash Verge Rev (Mihomo内核) 简易优化配置脚本
// 版本: v1.1.0 (2026-05-28)
// 作者: XiaoM-OVO
// 仓库: https://github.com/XiaoM-OVO/mihomo-toolkit
// 说明: 自动分类节点 + 规则集驱动分流，可自行调整 non-cn 规则顺序
// =========================================================================

function main(config) {
  const proxies = config.proxies || [];
  const proxyNames = proxies.map(p => p.name);
  const allProxies = proxyNames.length ? proxyNames : ["DIRECT"];

  const safe = (list, fallback = ["REJECT"]) => {
    return (list && list.length > 0) ? list : fallback;
  };

  const regionMap = {
    hk: { name: "🇭🇰 香港节点", keywords: ["港", "香港", "🇭🇰", "HK", "Hong Kong"] },
    tw: { name: "🇹🇼 台湾节点", keywords: ["台", "台湾", "🇹🇼", "TW", "Taiwan"] },
    jp: { name: "🇯🇵 日本节点", keywords: ["日", "日本", "🇯🇵", "JP", "Japan"] },
    kr: { name: "🇰🇷 韩国节点", keywords: ["韩", "韓國", "🇰🇷", "KR", "Korea"] },
    sg: { name: "🇸🇬 新加坡节点", keywords: ["新", "新加坡", "🇸🇬", "SG", "Singapore"] },
    us: { name: "🇺🇸 美国节点", keywords: ["美", "美国", "🇺🇸", "US", "United States"] }
  };

  const matched = new Set();
  const regionNodes = { hk: [], tw: [], jp: [], kr: [], sg: [], us: [] };

  for (const name of proxyNames) {
    for (const [key, meta] of Object.entries(regionMap)) {
      if (meta.keywords.some(kw => name.includes(kw))) {
        regionNodes[key].push(name);
        matched.add(name);
        break; 
      }
    }
  }
  const otherNodes = proxyNames.filter(n => !matched.has(n));

  // --- 组装逻辑 ---
  
  // 1. 纯地区列表
  const regionGroups = [
    "🇭🇰 香港节点", 
    "🇹🇼 台湾节点", 
    "🇯🇵 日本节点", 
    "🇰🇷 韩国节点", 
    "🇸🇬 新加坡节点", 
    "🇺🇸 美国节点",
    "🌐 其他节点"
  ];

  // 2. 标准组合（自动 + 手动 + 故障转移 + 各个地区）
  const standardOptions = ["🚀 自动选择", "🛡️ 故障转移", "📍 节点选择", ...regionGroups];

  config["proxy-groups"] = [
    // 核心管理
    { name: "📍 节点选择", type: "select", proxies: ["🚀 自动选择", "🛡️ 故障转移", ...regionGroups, "DIRECT"] },
    { name: "🚀 自动选择", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, tolerance: 50, proxies: allProxies },
    { name: "🛡️ 故障转移", type: "fallback", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: [...regionGroups, "DIRECT"]  },
    
    // 特殊服务
    { name: "🤖 OpenAI", type: "select", proxies: ["🇺🇸 美国节点", "🇹🇼 台湾节点", "🇸🇬 新加坡节点", "🇯🇵 日本节点", "🇰🇷 韩国节点", "📍 节点选择", "🌐 其他节点"] },

    // 常规分流
    { name: "🎮 游戏服务", type: "select", proxies: ["DIRECT", ...standardOptions] },
    { name: "📺 YouTube", type: "select", proxies: [...standardOptions, "DIRECT"] },
    { name: "🎬 Netflix", type: "select", proxies: [...standardOptions, "DIRECT"] },
    { name: "🚅 Google", type: "select", proxies: [...standardOptions, "DIRECT"] },
    { name: "✈️ Telegram", type: "select", proxies: [...standardOptions, "DIRECT"] },

    // 系统服务
    { name: "🍎 Apple", type: "select", proxies: ["DIRECT", ...standardOptions] },
    { name: "Ⓜ️ Microsoft", type: "select", proxies: ["DIRECT", ...standardOptions] },

    // 兜底与拦截
    { name: "🐟 漏网之鱼", type: "select", proxies: ["📍 节点选择", "🚀 自动选择", "🛡️ 故障转移", "DIRECT", ...regionGroups] },
    { name: "🚫 广告拦截", type: "select", proxies: ["REJECT", "DIRECT"] },

    // 自动分类组
    { name: "🇭🇰 香港节点", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: safe(regionNodes.hk) },
    { name: "🇹🇼 台湾节点", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: safe(regionNodes.tw) },
    { name: "🇯🇵 日本节点", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: safe(regionNodes.jp) },
    { name: "🇰🇷 韩国节点", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: safe(regionNodes.kr) },
    { name: "🇸🇬 新加坡节点", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: safe(regionNodes.sg) },
    { name: "🇺🇸 美国节点", type: "url-test", url: "http://www.gstatic.com/generate_204", interval: 300, proxies: safe(regionNodes.us) },
    { name: "🌐 其他节点", type: "select", proxies: safe(otherNodes, ["DIRECT"]) }
  ];

  // --- 规则集管理 ---
  const repo = "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta";
  const ruleProviders = {
    "ads": "geo/geosite/category-ads-all.yaml",
    "youtube": "geo/geosite/youtube.yaml",
    "netflix": "geo/geosite/netflix.yaml",
    "openai": "geo/geosite/openai.yaml",
    "telegram": "geo/geosite/telegram.yaml",
    "google": "geo/geosite/google.yaml",
    "apple": "geo/geosite/apple.yaml",
    "microsoft": "geo/geosite/microsoft.yaml",
    "steam": "geo/geosite/steam.yaml",
    "epic": "geo/geosite/epicgames.yaml",
    "game-download": "geo/geosite/category-games.yaml", 
    "non-cn": "geo/geosite/geolocation-!cn.yaml",
    "cn-domain": "geo/geosite/cn.yaml",
    "telegram-ip": "geo/geoip/telegram.yaml",
    "cn-ip": "geo/geoip/cn.yaml",
  };

  config["rule-providers"] = Object.fromEntries(
    Object.entries(ruleProviders).map(([name, path]) => [
      name,
      {
        type: "http",
        behavior: path.includes("geoip") ? "ipcidr" : "domain",
        url: `${repo}/${path}`,
        path: `./ruleset/${name}.yaml`,
        interval: 86400,
        proxy: "📍 节点选择" 
      }
    ])
  );

  config["rules"] = [
    // --- 基础过滤 ---
    "DOMAIN-SUFFIX,localhost,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT",
    "IP-CIDR,10.0.0.0/8,DIRECT",
    "IP-CIDR,172.16.0.0/12,DIRECT",
    "IP-CIDR,192.168.0.0/16,DIRECT",
    "IP-CIDR,100.64.0.0/10,DIRECT",
    "IP-CIDR6,::1/128,DIRECT",
    "IP-CIDR6,fc00::/7,DIRECT",
    "IP-CIDR6,fe80::/10,DIRECT",

    // --- 游戏逻辑 ---
    "RULE-SET,game-download,DIRECT",
    "RULE-SET,steam,🎮 游戏服务",
    "RULE-SET,epic,🎮 游戏服务",

    // --- 广告拦截 ---
    "RULE-SET,ads,🚫 广告拦截",

    // --- 业务分流 ---
    "RULE-SET,youtube,📺 YouTube",
    "RULE-SET,netflix,🎬 Netflix",
    "RULE-SET,openai,🤖 OpenAI",
    "RULE-SET,telegram,✈️ Telegram",
    "RULE-SET,telegram-ip,✈️ Telegram",
    "RULE-SET,google,🚅 Google",
    "RULE-SET,apple,🍎 Apple",
    "RULE-SET,microsoft,Ⓜ️ Microsoft",

    // ===== 规则顺序方案 =====
    // 方案 A（默认）：直连优先，性能最佳，适用于绝大多数场景
    // 方案 B（备选）：代理优先，分流更激进，适合强迫症用户
    // 切换方法：注释方案 A，取消注释方案 B

    // --- 地理位置分流 A (直连优先方案) ---
    "RULE-SET,cn-domain,DIRECT",
    "RULE-SET,cn-ip,DIRECT",
    "RULE-SET,non-cn,📍 节点选择",

    // --- 地理位置分流 B （代理优先） ---
    //"RULE-SET,non-cn,📍 节点选择",
    //"RULE-SET,cn-domain,DIRECT",
    //"RULE-SET,cn-ip,DIRECT",

    // --- 兜底 ---
    "MATCH,🐟 漏网之鱼"
  ];

  return config;
}