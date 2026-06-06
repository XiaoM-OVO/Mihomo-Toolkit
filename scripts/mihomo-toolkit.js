// =========================================================================
//  📦 Mihomo-Toolkit | 通用动态策略组脚本
// ------------------------------------------------------------------------
// 版本: v2.0.0 (Build 2026.06.06)
// 作者: XiaoM-OVO
// 描述: 专为 Mihomo 内核客户端设计的简易分流工具箱。
// 功能: 动态清洗 / 智能分流 / 自动容错 / 多场景适配
// 仓库: https://github.com/XiaoM-OVO/mihomo-toolkit
// =========================================================================
// 💡 【节点清洗图标说明】
// 🤖 : OpenAI / ChatGPT      ♊ : Google Gemini       🦀 : Anthropic Claude
// 📺 : 流媒体访问 (NF/P+)     🎮 : 游戏 / FullCone      ⚡ : Hysteria / 高速
// 🛡️ : AnyTLS / 安全协议      📱 : WAP 移动优化         ⏬ : 下载 / BT 专用
// 🆓 : 免费 / 公益节点         🗑️ : 清洗失败节点
// =========================================================================

function main(config) {
  const proxies = config.proxies || [];

  // =========================================================================
  // ⚙️ 用户自定义配置区 (开关配置) - true 为开启，false 为关闭
  // =========================================================================
  const USER_CONFIG = {    
    // 拦截与分流开关
    enableAdBlock: true,       // 🚫 是否开启广告拦截
    
    // 智能与学术
    enableAI: true,            // 🤖 是否开启 AI 服务独立分流 (OpenAI/Gemini/Claude)
    enableScholar: true,       // 🎓 是否开启学术网站独立分流
    
    // 影音流媒体
    enableBilibili: true,      // 📺 是否开启哔哩哔哩独立分流
    enableYouTube: true,       // ▶️ 是否开启 YouTube 独立分流
    enableNetflix: true,       // 🎬 是否开启 Netflix 独立分流
    
    // 游戏与社交开发
    enableGame: true,          // 🎮 是否开启游戏平台独立分流 (Steam/Epic)
    enableGitHub: true,        // 🐱 是否开启 GitHub 独立分流
    enableTelegram: true,      // ✈️ 是否开启 Telegram 独立分流
    
    // 专项场景分流 (默认关闭，按需开启)
    enableSpotify: false,      // 🎧 是否开启 Spotify 独立分流
    enableTikTok: false,       // 🎵 是否开启 TikTok 独立分流 (自动过滤香港节点)
    enableSocial: false,       // 💬 是否开启常用海外社交独立分流 (Twitter/Meta/Discord)
    enableCrypto: false,       // 🪙 是否开启加密货币独立分流 (默认关闭，交易者按需开启)
    enablePayPal: false,       // 💳 是否开启 PayPal 独立分流
    
    // 基础系统服务
    enableSystemServices: true,// 🪟 是否开启系统服务独立分流 (Microsoft/Google/Apple)

    // 核心路由模式切换
    // false : 直连优先 (推荐，国内体验最好，性能最高)
    // true  : 代理优先 (适合强迫症，所有未识别的非大陆流量全部走代理)
    proxyFirst: false,

    // ... 其他开关 ...
    useMRS: true,               // 🚀 true: 使用二进制格式(仅限Mihomo,性能极高), false: 使用YAML格式(通用性好)
    osType: "windows",          // 🪟 可选值: "windows", "mac", "linux", "all" (all代表全平台规则混刷)
    removeInfoNodes: false,     // 🗑️ 是否彻底过滤掉营销/信息节点 (流量、到期时间等)
    enableQUICReject: false,    // ⚡是否阻断 QUIC (提升 YouTube 加载速度，若导致游戏语音/会议异常请关闭)
    enableDomesticGroup: false, // 🇨🇳 是否开启“中国分流”组 (海外党回国/国内用户精准控流可选)
  };

  // =========================================================================
  // --- 1. 全局配置与字典定义 ---
  // =========================================================================
  const IN_PREFIX = "(?:深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)"; 
  
  const REGION_DEFS = [
    { id: "cn", name: "中国", icon: "🇨🇳", reg: /回国|返乡|中国|大陆|内地|Mainland|(?<![a-z])(CN|PRC)(?![a-z])|China/i },
    { id: "hk", name: "香港", icon: "🇭🇰", reg: new RegExp(`${IN_PREFIX}港|香港|(?<![a-z])HKT?(?![a-z])|Hong Kong`, "i") },
    { id: "tw", name: "台湾", icon: "🇹🇼", reg: new RegExp(`${IN_PREFIX}台|台湾|台灣|台北|新北|(?<![a-z])TW(?![a-z])|Taiwan`, "i") },
    { id: "jp", name: "日本", icon: "🇯🇵", reg: new RegExp(`${IN_PREFIX}日|日本|东京|大阪|埼玉|(?<![a-z])JP(?![a-z])|Japan`, "i") },
    { id: "kr", name: "韩国", icon: "🇰🇷", reg: new RegExp(`${IN_PREFIX}韩|韩国|首尔|(?<![a-z])KR(?![a-z])|Korea`, "i") },
    { id: "sg", name: "新加坡", icon: "🇸🇬", reg: new RegExp(`${IN_PREFIX}新|新加坡|狮城|(?<![a-z])SG(?![a-z])|Singapore`, "i") },
    { id: "us", name: "美国", icon: "🇺🇸", reg: new RegExp(`${IN_PREFIX}美|美国|洛杉矶|圣何塞|西雅图|波特兰|达拉斯|芝加哥|(?<![a-z])(?:US|LAX)(?![a-z])|Los Angeles|America`, "i") },
    { id: "eu", name: "英国", icon: "🇬🇧", reg: /英国|伦敦|(?<![a-z])UK(?![a-z])|United Kingdom|Britain/i },
    { id: "eu", name: "德国", icon: "🇩🇪", reg: /德国|法兰克福|(?<![a-z])DE(?![a-z])|Germany/i },
    { id: "eu", name: "法国", icon: "🇫🇷", reg: /法国|巴黎|(?<![a-z])FR(?![a-z])|France/i },
    { id: "eu", name: "俄罗斯", icon: "🇷🇺", reg: /俄罗斯|莫斯科|伯力|圣彼得堡|(?<![a-z])RU(?![a-z])|Russia/i },
    { id: "eu", name: "乌克兰", icon: "🇺🇦", reg: /乌克兰|基辅|(?<![a-z])UA(?![a-z])|Ukraine/i },
    { id: "eu", name: "土耳其", icon: "🇹🇷", reg: /土耳其|伊斯坦布尔|(?<![a-z])TR(?![a-z])|Turkey/i },
    { name: "加拿大", icon: "🇨🇦", reg: /加拿大|多伦多|温哥华|蒙特利尔|(?<![a-z])CA(?![a-z])|Canada/i },
    { name: "印度", icon: "🇮🇳", reg: /印度|孟买|新德里|(?<![a-z])IN(?![a-z])|India/i },
    { name: "阿根廷", icon: "🇦🇷", reg: /阿根廷|布宜诺斯艾利斯|(?<![a-z])AR(?![a-z])|Argentina/i },
    { name: "尼日利亚", icon: "🇳🇬", reg: /尼日利亚|(?<![a-z])NG(?![a-z])|Nigeria/i },
    { name: "越南", icon: "🇻🇳", reg: /越南|胡志明|(?<![a-z])VN(?![a-z])|Vietnam/i },
    { name: "澳大利亚", icon: "🇦🇺", reg: /澳大利亚|澳洲|悉尼|墨尔本|(?<![a-z])AU(?![a-z])|Australia|Sydney/i },
    { name: "巴西", icon: "🇧🇷", reg: /巴西|圣保罗|(?<![a-z])BR(?![a-z])|Brazil/i },
    { name: "阿联酋", icon: "🇦🇪", reg: /阿联酋|迪拜|(?<![a-z])(?:AE|UAE)(?![a-z])/i }
  ];

  const ICON_RULES = [
    { reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i, icon: "🤖", pool: "chatgpt" },
    { reg: /\bGemini\b/i, icon: "♊", pool: "gemini" },
    { reg: /\bClaude\b/i, icon: "🦀", pool: "claude" },
    { reg: /(?:游戏)|\b(?:Game|FullCone)\b/i, icon: "🎮", pool: "game" },
    { reg: /(?:流媒体|解锁)|\b(?:Netflix|NF|Disney\+|YouTube)\b/i, icon: "📺" },
    { reg: /(?:下载)|\bBT\b/i, icon: "⏬" },
    { reg: /(?:免费|白嫖|公益)/i, icon: "🆓" },
    { reg: /\bWAP\b/i, icon: "📱" },
    { reg: /\b(?:HY2|Hysteria)\b/i, icon: "⚡" },
    { reg: /-A$|\bAnyTLS\b/i, icon: "🛡️" }
  ];

  // =========================================================================
  // --- 2. 节点双重遍历：清洗、计数与分发入桶 ---
  // =========================================================================
  const BUCKETS = {
    hk: [], tw: [], jp: [], kr: [], sg: [], us: [], eu: [], cn: [], other: [],
    garbage: [], download: [], info: [], allStandard: [],
    chatgpt: [], gemini: [], claude: [], game: []
  };

  // 第一次遍历：过滤与清洗提取
  const processedData = proxies.map(proxy => {
    let rawName = proxy.name;
    
    // 基础过滤 (直连/拒绝)
    if (['DIRECT', 'REJECT', 'COMPATIBLE'].includes(rawName)) return { skip: true };
    
    // 💡 营销/信息节点拦截逻辑
    if (/剩余流量|套餐到期|有效时间|官网|过期|通知|更新|重置|交流群|TG群|联系客服|获取/.test(rawName)) {
        if (USER_CONFIG.removeInfoNodes) return { skip: true }; // ❌ 丢弃
        return { isInfo: true, proxy }; // ✅ 保留
    }

    let name = rawName;
    // 🧹 智能清洗：剔除 🚀🔥💎 等花里胡哨的图形，保留国旗。
    name = name.replace(/\p{Extended_Pictographic}/gu, m => {
      const cp = m.codePointAt(0);
      return (cp >= 0x1F1E6 && cp <= 0x1F1FF) ? m : "";
    });
    let suffixArr = [], icons = [], featurePools = [];
    let entryStr = "", multiStr = "", lineArr = [];
    
    // 提取入口城市
    const tagMap = {"深圳":"深", "广州":"广", "上海":"沪", "北京":"京", "杭州":"杭", "四川":"川", "江苏":"苏", "宁波":"甬", "东莞":"莞"};
    const entryMatch = name.match(/(深圳|广州|上海|北京|杭州|四川|江苏|宁波|东莞|深|广|沪|京|杭|川|苏|甬|莞|移动|联通|电信)(?:-|->|至|=>|\s)*(?=港|台|日|韩|新|美|英|德|法|香港|台湾|日本|韩国|新加坡|美国)/);
    if (entryMatch) entryStr = tagMap[entryMatch[1]] || entryMatch[1];

    // 提取倍率与下载判定
    let isLowMulti = false;
    name = name.replace(/(?:^|[\s_\-\(\)\[\]【】])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*[xX×]|[xX×]\s*(\d+(?:\.\d+)?))(?=[\s_\-\(\)\[\]【】]|$)/ig, (m, m1, m2, m3) => {
      let num = parseFloat(m1 || m2 || m3);
      if (!isNaN(num)) {
        multiStr = `x${num}`; 
        if (num < 1) isLowMulti = true;
      }
      return "";
    });

    // 提取专线标签
    const lineRegex = /(IEPL|IPLC|BGP|CN2|GIA|专线|直连|中转|隧道|CMI|CUG|PCCW|HGC|HSBC|优化|9929|4837)/ig;
    let lineMatch;
    while ((lineMatch = lineRegex.exec(name)) !== null) {
      lineArr.push(lineMatch[0].length > 2 ? lineMatch[0].toUpperCase() : lineMatch[0]);
    }
    name = name.replace(lineRegex, "");

    if (entryStr) suffixArr.push(entryStr);
    if (lineArr.length > 0) suffixArr.push(...new Set(lineArr)); 
    if (multiStr) suffixArr.push(multiStr);

    // 提取功能图标
    ICON_RULES.forEach(rule => {
      if (rule.reg.test(name)) {
        icons.push(rule.icon);
        if (rule.pool) featurePools.push(rule.pool);
        name = name.replace(rule.reg, "");
      }
    });
    if (isLowMulti && !icons.includes("⏬")) icons.push("⏬");

    // 提取地区
    let regionInfo = REGION_DEFS.find(item => item.reg.test(name));
    
    if (regionInfo) {
      name = name.replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, ""); 
      name = name.replace(regionInfo.reg, "");
    } else {
      // 🚀 动态捕获字典外的未知地区。
      // 匹配：国旗 + (连续的中文/英文/空格/连字符，直到遇到数字或特殊符号停止)
      const flagMatch = name.match(/([\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF])\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/);
      if (flagMatch) {
        regionInfo = { 
          id: 'other',               // 自动归类到 "🌐 其他节点" 组
          icon: flagMatch[1],        // 捕获到的国旗 (如 🇲🇾)
          name: flagMatch[2].trim()  // 捕获到的国家名 (如 马来西亚)
        };
        // 把匹配到的国旗和名字从 name 中删掉，保持干净
        name = name.replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, "");
        name = name.replace(flagMatch[2], "");
      }
    }

    // 清理并返回对象
    name = name.replace(/[\[\]{}()<>（）【】]/g, '').replace(/\b\d{1,3}\b/g, "").replace(/[-_\|\s]+/g, " ").trim() || "其他";
    let groupKey = regionInfo ? regionInfo.name : name;

    // 彻底抛弃 parsedList，直接由 map 返回
    return { proxy, regionInfo, groupKey, rawName, icons, featurePools, suffixArr };
  }).filter(d => d && !d.skip); // 剔除被跳过的节点

  // 统计各组数量
  const counts = {};
  processedData.forEach(d => {
    if (!d.isInfo) counts[d.groupKey] = (counts[d.groupKey] || 0) + 1;
  });

  // 第二次遍历：重命名并分发入桶
  const groupTrack = {}; 
  processedData.forEach(item => {
    // 💡 处理被保留的机场公告节点
    if (item.isInfo) {
      BUCKETS.info.push(item.proxy.name);
      return; 
    }

    let { proxy, regionInfo, groupKey, rawName, icons, featurePools, suffixArr } = item;
    groupTrack[groupKey] = (groupTrack[groupKey] || 0) + 1;
    
    // 生成序号 (如 [01], [02])
    let numStr = counts[groupKey] > 1 ? ` [${groupTrack[groupKey].toString().padStart(2, '0')}]` : "";
    
    // 拼接最终名字
    let finalName = regionInfo ? `${regionInfo.icon} ${regionInfo.name}${numStr}` : `🗑️ ${rawName}`; 
    if (icons.length > 0) finalName += ` ${[...new Set(icons)].join("")}`;
    if (regionInfo && suffixArr.length > 0) finalName += ` | ${suffixArr.join(" ")}`; 

    // 修改节点原名
    proxy.name = finalName; 

    // 节点分发入桶
    if (icons.includes("⏬")) {
      BUCKETS.download.push(finalName);
    } else {
      BUCKETS.allStandard.push(finalName);
      featurePools.forEach(p => BUCKETS[p].push(finalName)); 

      if (!regionInfo) BUCKETS.garbage.push(finalName);
      else BUCKETS[regionInfo.id || 'other'].push(finalName);
    }
  });
  
  // =========================================================================
  // --- 3. 动态可用策略组构建 ---
  // =========================================================================
  const safeList = (list, defaultNodes = ["DIRECT"]) => list.length > 0 ? list : defaultNodes;

  const REGION_NAMES = { cn: "🇨🇳 大陆节点", hk: "🇭🇰 香港节点", tw: "🇹🇼 台湾节点", jp: "🇯🇵 日本节点", kr: "🇰🇷 韩国节点", sg: "🇸🇬 新加坡节点", us: "🇺🇸 美国节点", eu: "🇪🇺 欧洲节点" };
  
  // 1️⃣ 先定义核心区域组
  const activeRegionGroups = Object.keys(REGION_NAMES).filter(k => BUCKETS[k].length > 0).map(k => REGION_NAMES[k]);
  if (BUCKETS.other.length > 0) activeRegionGroups.push("🌐 其他节点");
  if (BUCKETS.garbage.length > 0) activeRegionGroups.push("🗑️ 未知识别");

  // 2️⃣ 再定义判定变量
  const hasGlobalProxy = activeRegionGroups.some(g => g !== "🇨🇳 大陆节点");
  // const hasProxy = activeRegionGroups.some(g => g !== "🇨🇳 大陆节点" && g !== "🗑️ 未知识别"); // 如果需要更严苛的判定可用这个

  // 3️⃣ 基础选项池
  const TEST_URL = "http://cp.cloudflare.com/generate_204"; // 💡 统一测速地址，防止 gstatic 抽风导致误判
  const standardOptions = ["📍 节点选择", "🚀 自动选择", "♻️ 故障转移"];
  if (BUCKETS.download.length > 0) standardOptions.push("⚖️ 负载均衡");
  standardOptions.push(...activeRegionGroups);

  const coreSelectProxies = ["🚀 自动选择", "♻️ 故障转移"];
  if (BUCKETS.download.length > 0) coreSelectProxies.push("⚖️ 负载均衡");
  // 地区分组放在直连之前，机场公告节点（流量/到期等）沉底显示，避免干扰正常选择
  coreSelectProxies.push(...activeRegionGroups, "DIRECT", ...BUCKETS.info);

  // =========================================================================
  // --- 4. 组装 Proxy-Groups (受用户开关控制) ---
  // =========================================================================
  const buildSelect = (name, proxies, hidden = false) => ({ name, type: "select", proxies: [...new Set(proxies)], hidden });
  const buildUrlTest = (name, proxies, hidden = false) => ({ name, type: "url-test", url: TEST_URL, interval: 180, tolerance: 100, lazy: true, proxies: [...new Set(safeList(proxies))], hidden });

  // 1️⃣ 先收集所有的功能插件组 (appGroups)
  const appGroups = [];
  
  if (USER_CONFIG.enableAI) {
    const aiCore = ["🇺🇸 美国节点", "🇯🇵 日本节点", "🇹🇼 台湾节点", "🇸🇬 新加坡节点", "🇰🇷 韩国节点", "🇪🇺 欧洲节点"].filter(g => activeRegionGroups.includes(g));
    const showOpenAI = aiCore.length > 0 || BUCKETS.chatgpt.length > 0;
    const showGemini = aiCore.length > 0 || BUCKETS.gemini.length > 0;
    const showClaude = aiCore.length > 0 || BUCKETS.claude.length > 0;
    appGroups.push(
      buildSelect("🤖 OpenAI", [...new Set([...aiCore, ...BUCKETS.chatgpt, "📍 节点选择", "DIRECT"])], !showOpenAI),
      buildSelect("♊ Gemini", [...new Set([...aiCore, ...BUCKETS.gemini, "📍 节点选择", "DIRECT"])], !showGemini),
      buildSelect("🦀 Claude", [...new Set([...aiCore, ...BUCKETS.claude, "📍 节点选择", "DIRECT"])], !showClaude)
    );
  }

  if (USER_CONFIG.enableScholar) {
    const scholarProxies = ["🇺🇸 美国节点", "🇪🇺 欧洲节点", "🇯🇵 日本节点", "🇸🇬 新加坡节点", "🇹🇼 台湾节点", "🇭🇰 香港节点"].filter(g => activeRegionGroups.includes(g));
    appGroups.push(buildSelect("🎓 学术网站", [...new Set([...scholarProxies, "📍 节点选择", "DIRECT"])], scholarProxies.length === 0));
  }
  if (USER_CONFIG.enableCrypto) {
  const cryptoCore = ["🇹🇼 台湾节点", "🇯🇵 日本节点", "🇪🇺 欧洲节点"].filter(g => activeRegionGroups.includes(g));
  appGroups.push(buildSelect("🪙 加密货币", [...new Set([...cryptoCore, "📍 节点选择", "DIRECT"])], !hasGlobalProxy));
  }
  if (USER_CONFIG.enablePayPal) {
    appGroups.push(buildSelect("💳 PayPal", ["DIRECT", "📍 节点选择", ...activeRegionGroups], !hasGlobalProxy));
  }

  // 通用组：只要有海外节点就显示
  if (USER_CONFIG.enableGame)     appGroups.push(buildSelect("🎮 游戏服务", ["DIRECT", ...standardOptions, ...BUCKETS.game], !hasGlobalProxy));
  if (USER_CONFIG.enableSocial)   appGroups.push(buildSelect("💬 社交平台", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableYouTube)  appGroups.push(buildSelect("▶️ YouTube", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableNetflix)  appGroups.push(buildSelect("🎬 Netflix", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableGitHub)   appGroups.push(buildSelect("🐱 GitHub", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableTelegram) appGroups.push(buildSelect("✈️ Telegram", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  if (USER_CONFIG.enableSpotify)  appGroups.push(buildSelect("🎧 Spotify", [...standardOptions, "DIRECT"], !hasGlobalProxy));
  // [Bilibili]：智能动态分流，兼顾海外党回国与港台番剧解锁
  if (USER_CONFIG.enableBilibili) {
    const biliCore = ["🇹🇼 台湾节点", "🇭🇰 香港节点"].filter(g => activeRegionGroups.includes(g));
    let biliProxies = [];
    if (USER_CONFIG.enableDomesticGroup) {
      // 🌍 海外党模式：首选【中国分流】，可选【港台节点】看番，保留【直连】防特殊情况
      biliProxies = ["🇨🇳 中国分流", ...biliCore, "DIRECT"];
    } else {
      // 🇨🇳 国内党模式：首选【直连】，可选【港台节点】看番
      biliProxies = ["DIRECT", ...biliCore];
    }
    // 自动隐藏逻辑：如果既没开国内分流，又没有港台节点，那这个组就毫无意义，直接隐藏
    const hideBili = !USER_CONFIG.enableDomesticGroup && biliCore.length === 0;
    appGroups.push(buildSelect("📺 哔哩哔哩", biliProxies, hideBili));
  }
  // [TikTok]：过滤香港，且只有在剩下还有节点可用时显示
  if (USER_CONFIG.enableTikTok) {
    const tiktokCore = activeRegionGroups.filter(g => g !== "🇭🇰 香港节点" && g !== "🇨🇳 大陆节点" && g !== "🗑️ 未知识别");
    appGroups.push(buildSelect("🎵 TikTok", [...tiktokCore, "📍 节点选择", "DIRECT"], tiktokCore.length === 0));
  }

  if (USER_CONFIG.enableSystemServices) {
    appGroups.push(
      buildSelect("🪟 Microsoft", ["DIRECT", ...standardOptions], !hasGlobalProxy),
      buildSelect("🔍 Google", [...standardOptions, "DIRECT"], !hasGlobalProxy),
      buildSelect("🍎 Apple", ["DIRECT", ...standardOptions], !hasGlobalProxy)
    );
  }
  if (USER_CONFIG.enableAdBlock)  appGroups.push(buildSelect("🚫 广告拦截", ["REJECT", "DIRECT"]));

  // 2️⃣ 统一拼装最终的 proxy-groups 数组
  const finalGroups = [];

  // [1. 核心控制组]
  finalGroups.push(
    buildSelect("📍 节点选择", coreSelectProxies),
    { name: "🚀 自动选择", type: "url-test", url: TEST_URL, interval: 300, tolerance: 50, proxies: safeList(BUCKETS.allStandard) },
    { name: "♻️ 故障转移", type: "fallback", url: TEST_URL, interval: 300, proxies: safeList([...activeRegionGroups, "DIRECT"]) }
  );

  // [2. 负载均衡]
  finalGroups.push(buildSelect("⚖️ 负载均衡", BUCKETS.download.length > 0 ? ["DIRECT", "⚖️ 负载均衡轮询池", "🚀 自动选择", ...BUCKETS.download] : ["DIRECT"], BUCKETS.download.length === 0));
  finalGroups.push({ name: "⚖️ 负载均衡轮询池", type: "load-balance", strategy: "round-robin", url: TEST_URL, interval: 300, lazy: true, proxies: safeList(BUCKETS.download), hidden: true });

  // [3. 境内服务组]
  if (USER_CONFIG.enableDomesticGroup) {
    finalGroups.push(buildSelect("🇨🇳 中国分流", ["DIRECT", ...standardOptions, "🚀 自动选择"]));
  }

  // [4. 插入所有功能组] - AI、YouTube、游戏等
  finalGroups.push(...appGroups);

  // [5. 漏网之鱼]
  finalGroups.push(buildSelect("🐟 漏网之鱼", USER_CONFIG.proxyFirst ? ["📍 节点选择", "🚀 自动选择", "DIRECT"] : ["DIRECT", "📍 节点选择", "🚀 自动选择"]));

  // [6. 地区自动测速组和杂项]
  finalGroups.push(...Object.entries(REGION_NAMES).map(([id, name]) => buildUrlTest(name, BUCKETS[id], BUCKETS[id].length === 0)));
  finalGroups.push(buildSelect("🌐 其他节点", safeList(BUCKETS.other), BUCKETS.other.length === 0));
  finalGroups.push(buildSelect("🗑️ 未知识别", safeList(BUCKETS.garbage), BUCKETS.garbage.length === 0));

  // 最后一步：一次性赋值给 config
  config["proxy-groups"] = finalGroups;

  // =========================================================================
  // --- 5. 规则集配置 (Rule Providers) ---
  // =========================================================================
  const REPO = "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta";
  
  // 💡 关键逻辑：根据开关仅切换文件后缀与解析格式，路径前缀固定为 geo
  // MRS 为 Mihomo 专属二进制格式（性能极高），YAML 为通用格式（兼容性好）
  const ruleFormat = USER_CONFIG.useMRS ? "mrs" : "yaml"; // 同时作为文件后缀与解析格式

  // 这里只写核心路径，不写后缀
  const PROVIDER_BASE = {
    "lan-domain": "geosite/private", 
    "lan-ip": "geoip/private",
    "non-cn": "geosite/geolocation-!cn", 
    "cn-domain": "geosite/cn", 
    "cn-ip": "geoip/cn",
    "bt-trackers-pt": "geosite/category-pt", 
    "bt-trackers-public": "geosite/category-public-tracker",
    "download-android": "geosite/category-android-app-download",
    "download-games": "geosite/category-game-platforms-download", 
    "download-games-cn": "geosite/category-game-platforms-download@cn"
  };

  // 根据开关动态引入附加规则
  if (USER_CONFIG.enableAdBlock) PROVIDER_BASE["ads"] = "geosite/category-ads-all";
  if (USER_CONFIG.enableAI) {
    PROVIDER_BASE["openai"] = "geosite/openai";
    PROVIDER_BASE["gemini"] = "geosite/google-gemini";
    PROVIDER_BASE["claude"] = "geosite/anthropic";
  }
  if (USER_CONFIG.enableScholar) PROVIDER_BASE["scholar"] = "geosite/category-scholar-!cn";
  if (USER_CONFIG.enableGame) {
    PROVIDER_BASE["steam"] = "geosite/steam";
    PROVIDER_BASE["steam-cn"] = "geosite/steam@cn";
    PROVIDER_BASE["epic"] = "geosite/epicgames";
  }
  if (USER_CONFIG.enableBilibili) PROVIDER_BASE["bilibili"] = "geosite/bilibili";
  if (USER_CONFIG.enableYouTube)  PROVIDER_BASE["youtube"] = "geosite/youtube";
  if (USER_CONFIG.enableNetflix)  PROVIDER_BASE["netflix"] = "geosite/netflix";
  if (USER_CONFIG.enableGitHub)   PROVIDER_BASE["github"] = "geosite/github";
  if (USER_CONFIG.enableCrypto)   PROVIDER_BASE["crypto"] = "geosite/category-cryptocurrency";
  if (USER_CONFIG.enablePayPal)   PROVIDER_BASE["paypal"] = "geosite/paypal";
  
  if (USER_CONFIG.enableSpotify)  PROVIDER_BASE["spotify"] = "geosite/spotify";
  if (USER_CONFIG.enableTikTok)   PROVIDER_BASE["tiktok"] = "geosite/tiktok";
  if (USER_CONFIG.enableSocial) {
    PROVIDER_BASE["twitter"] = "geosite/twitter";
    PROVIDER_BASE["facebook"] = "geosite/facebook";
    PROVIDER_BASE["instagram"] = "geosite/instagram";
    PROVIDER_BASE["discord"] = "geosite/discord";
  }

  if (USER_CONFIG.enableTelegram) {
    PROVIDER_BASE["telegram"] = "geosite/telegram";
    PROVIDER_BASE["telegram-ip"] = "geoip/telegram";
  }
  
  if (USER_CONFIG.enableSystemServices) {
    PROVIDER_BASE["google"] = "geosite/google";
    PROVIDER_BASE["apple"] = "geosite/apple";
    PROVIDER_BASE["microsoft"] = "geosite/microsoft";
  }

  config["rule-providers"] = Object.fromEntries(
    Object.entries(PROVIDER_BASE).map(([name, route]) => [
      name, { 
        type: "http", 
        // 自动识别是否为 IP 类型的规则
        behavior: route.includes("geoip") ? "ipcidr" : "domain", 
        // 动态拼装 URL：后缀自动变为 .mrs 或 .yaml
        url: `${REPO}/geo/${route}.${ruleFormat}`, 
        // 本地保存路径同样修改后缀
        path: `./ruleset/${name}.${ruleFormat}`, 
        interval: 86400, 
        format: ruleFormat, // 💡 核心：告诉内核按二进制还是文本解析
        proxy: "🚀 自动选择" 
      }
    ])
  );

  // =========================================================================
  // --- 6. 策略分流规则 ---
  // =========================================================================
  const routingRules = [
    "RULE-SET,lan-domain,DIRECT",
    "RULE-SET,lan-ip,DIRECT,no-resolve"
  ];

  if (USER_CONFIG.enableQUICReject) {
    routingRules.push("AND,((NETWORK,UDP),(DST-PORT,443)),REJECT");
  }

  if (USER_CONFIG.enableAdBlock) routingRules.push("RULE-SET,ads,🚫 广告拦截");

  // [动态加载进程规则] - 根据系统环境保持规则列表清爽
  const osTarget = USER_CONFIG.osType.toLowerCase();
  const isWin = ["windows", "all"].includes(osTarget);
  const isMac = ["mac", "all"].includes(osTarget);
  const isLin = ["linux", "all"].includes(osTarget);

  if (isWin) {
    routingRules.push(
      "PROCESS-NAME,qBittorrent.exe,DIRECT",
      "PROCESS-NAME,Thunder.exe,DIRECT",
      "PROCESS-NAME,IDM.exe,⚖️ 负载均衡"
    );
  }
  if (isMac) {
    routingRules.push(
      "PROCESS-NAME,qbittorrent,DIRECT",
      "PROCESS-NAME,Thunder,DIRECT" // Mac版迅雷
    );
  }
  if (isLin) {
    routingRules.push("PROCESS-NAME,qbittorrent,DIRECT");
  }
  if (isMac || isLin) {
    routingRules.push(
      "PROCESS-NAME,aria2c,DIRECT",
      "PROCESS-NAME,transmission-daemon,DIRECT"
    );
  }

  // 共用的 Tracker 与通用下载规则
  routingRules.push(
    "RULE-SET,bt-trackers-pt,DIRECT",
    "RULE-SET,bt-trackers-public,DIRECT",
    "DOMAIN-KEYWORD,tracker,DIRECT", 
    "DOMAIN-KEYWORD,announce,DIRECT",
    "RULE-SET,download-games-cn,DIRECT",
    "RULE-SET,download-games,⚖️ 负载均衡",
    "RULE-SET,download-android,⚖️ 负载均衡"
  );

  if (USER_CONFIG.enableScholar) {
    routingRules.push("DOMAIN-KEYWORD,sci-hub,🎓 学术网站", "RULE-SET,scholar,🎓 学术网站");
  }
  
  if (USER_CONFIG.enableGame) {
    routingRules.push(
      // Steam：先放 CN 直连，再放代理（顺序同 Epic 一致，特例优先于规则集）
      "DOMAIN-SUFFIX,steamusercontent.com,🎮 游戏服务",
      "DOMAIN-SUFFIX,steamserver.net,DIRECT",
      "RULE-SET,steam-cn,DIRECT",
      "RULE-SET,steam,🎮 游戏服务",
      "DOMAIN-SUFFIX,epicgames.com,DIRECT",
      "RULE-SET,epic,🎮 游戏服务"
    );
  }

  if (USER_CONFIG.enableAI) {
    routingRules.push("RULE-SET,openai,🤖 OpenAI", "RULE-SET,gemini,♊ Gemini", "RULE-SET,claude,🦀 Claude");
  }
  if (USER_CONFIG.enableCrypto)   routingRules.push("RULE-SET,crypto,🪙 加密货币");
  if (USER_CONFIG.enablePayPal)   routingRules.push("RULE-SET,paypal,💳 PayPal");
  if (USER_CONFIG.enableBilibili) routingRules.push("RULE-SET,bilibili,📺 哔哩哔哩");
  if (USER_CONFIG.enableYouTube)  routingRules.push("RULE-SET,youtube,▶️ YouTube");
  if (USER_CONFIG.enableNetflix)  routingRules.push("RULE-SET,netflix,🎬 Netflix");
  if (USER_CONFIG.enableGitHub)   routingRules.push("RULE-SET,github,🐱 GitHub");
  
  if (USER_CONFIG.enableSpotify)  routingRules.push("RULE-SET,spotify,🎧 Spotify");
  if (USER_CONFIG.enableTikTok)   routingRules.push("RULE-SET,tiktok,🎵 TikTok");
  if (USER_CONFIG.enableSocial) {
    routingRules.push(
      "RULE-SET,twitter,💬 社交平台",
      "RULE-SET,facebook,💬 社交平台",
      "RULE-SET,instagram,💬 社交平台",
      "RULE-SET,discord,💬 社交平台"
    );
  }

  if (USER_CONFIG.enableTelegram) {
    if (isWin) routingRules.push("PROCESS-NAME,Telegram.exe,✈️ Telegram");
    if (isMac || isLin) {
      routingRules.push("PROCESS-NAME,Telegram,✈️ Telegram");
    }
    routingRules.push(
      "RULE-SET,telegram,✈️ Telegram",
      "RULE-SET,telegram-ip,✈️ Telegram,no-resolve"
    );
  }
  
  if (USER_CONFIG.enableSystemServices) {
    routingRules.push("RULE-SET,google,🔍 Google", "RULE-SET,apple,🍎 Apple", "RULE-SET,microsoft,🪟 Microsoft");
  }

  // 根据 proxyFirst 决定底层路由，并动态判断国内流量出口
  const cnTarget = USER_CONFIG.enableDomesticGroup ? "🇨🇳 中国分流" : "DIRECT";
  
  if (USER_CONFIG.proxyFirst) {
    routingRules.push("RULE-SET,non-cn,📍 节点选择", `RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`);
  } else {
    routingRules.push(`RULE-SET,cn-domain,${cnTarget}`, `RULE-SET,cn-ip,${cnTarget},no-resolve`, "RULE-SET,non-cn,📍 节点选择");
  }

  routingRules.push("MATCH,🐟 漏网之鱼");
  config["rules"] = routingRules;

  return config;
}