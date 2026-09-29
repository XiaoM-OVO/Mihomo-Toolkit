/**
 * 策略组拓扑与分发结构生成器
 *
 * 负责大区智能折叠、功能策略组构建（AI、流媒体、游戏等）、节点入桶路由以及自定义分组注入。
 */

const { getEnhancedRegionDefs, CONTINENT_DEFS } = require('../core/shared/regions');
const { REGEX_UNKNOWN_FLAG } = require('../core/geo');

const HIGH_MULTI_GROUP = '高倍率优选';
const EXPERIMENTAL_GROUP = '实验节点';

function dedupe(arr) {
  return [...new Set(arr)];
}

const buildSelect = (name, proxies, hidden = false) => ({
  name,
  type: 'select',
  proxies: dedupe(proxies),
  hidden
});

/**
 * 构建完整的策略组拓扑
 * @param {object} params
 * @param {Array<object>} params.classifiedNodes 已打标的节点列表
 * @param {object} params.userConfig 用户配置参数
 * @param {object} params.registries 服务注册表
 * @returns {object} { proxyGroups, buckets }
 */
function buildProxyTopology({
  classifiedNodes = [],
  userConfig = {},
  registries = {},
  logger = null
}) {
  // 确保 registries 优先从 catalog 获取单一事实来源
  const effectiveRegistries = (registries && Object.keys(registries).length > 0)
    ? registries
    : (userConfig.catalog ? userConfig.catalog.toLegacyRegistries() : {});

  const regionDefs = getEnhancedRegionDefs();
  const mixedRegionIds = [...new Set(regionDefs.map(r => r.group).filter(Boolean)), 'other'];

  // 1. 初始化分发桶
  const buckets = {
    garbage: [],
    download: [],
    highMulti: [],
    experimental: [],
    info: [],
    allStandard: [],
    special: [],
    other: [],
    residential: [],
    resiRegionMap: {}
  };

  regionDefs.forEach(r => {
    const key = r.id || r.name;
    if (!buckets[key]) buckets[key] = [];
    if (r.group && !buckets[r.group]) buckets[r.group] = [];
  });

  // 2. 节点路由入桶
  classifiedNodes.forEach(item => {
    if (item.skip) return;
    const finalName = item.proxy?.name || item.rawName;

    if (item.isInfo) {
      buckets.info.push(finalName);
      return;
    }

    if (item.isSpecial) {
      buckets.special.push(finalName);
      return;
    }

    if (item.isGarbage) {
      buckets.garbage.push(finalName);
      return;
    }

    const tags = item.tags || [];

    // 低倍率下载池
    if (tags.includes('download')) {
      buckets.download.push(finalName);
    }
    if (userConfig.isolateDownload && tags.includes('download')) {
      return;
    }

    // 家宽隔离
    if (userConfig.enableResidential && tags.includes('residential')) {
      buckets.residential.push(finalName);
      const resiKey = item.regionInfo?.id || item.regionInfo?.name || 'other';
      if (!buckets.resiRegionMap[resiKey]) buckets.resiRegionMap[resiKey] = [];
      buckets.resiRegionMap[resiKey].push(finalName);
      return;
    }

    // 高倍率隔离
    if (userConfig.isolateHighMulti && (item.attrs?.multiNum || 1) > (userConfig.highMultiThreshold ?? 2.5)) {
      buckets.highMulti.push(finalName);
      return;
    }

    // 实验节点隔离
    if (userConfig.isolateExperimental && tags.includes('experimental')) {
      buckets.experimental.push(finalName);
      return;
    }

    // 进入地区桶与主力标准池
    const rKey = item.regionInfo ? (item.regionInfo.id || item.regionInfo.name) : 'other';
    if (!buckets[rKey]) buckets[rKey] = [];
    buckets[rKey].push(finalName);

    if (rKey !== 'cn') {
      buckets.allStandard.push(finalName);
    }

    // 🌟 将节点加入其命中的所有业务特征池 (AI, 流媒体, 游戏等)
    (item.featurePools || []).forEach(p => {
      if (!buckets[p]) buckets[p] = [];
      if (!buckets[p].includes(finalName)) {
        buckets[p].push(finalName);
      }
    });
  });

  // 3. 处理小众地区与大洲折叠
  const regionNames = {
    cn: '大陆节点', hk: '香港节点', tw: '台湾节点', jp: '日本节点',
    kr: '韩国节点', sg: '新加坡节点', us: '美国节点'
  };

  const threshold = userConfig.minorNodeThreshold ?? 3;

  regionDefs.forEach(r => {
    const key = r.id || r.name;
    if (regionNames[key]) return;
    const nodes = buckets[key];
    if (nodes && nodes.length > 0) {
      if (nodes.length >= threshold) {
        regionNames[key] = `${r.name}节点`;
      } else {
        const targetContinent = r.group || 'other';
        if (!buckets[targetContinent]) buckets[targetContinent] = [];
        buckets[targetContinent].push(...nodes);
        buckets[key] = [];
      }
    }
  });

  // 处理大洲折叠
  CONTINENT_DEFS.forEach(continent => {
    if (buckets[continent.id]?.length >= threshold) {
      regionNames[continent.id] = `${continent.name}节点`;
    } else {
      buckets.other.push(...(buckets[continent.id] || []));
      buckets[continent.id] = [];
    }
  });

  // 4. 构建策略组
  const activeRegionGroups = Object.keys(regionNames)
    .filter(k => buckets[k]?.length > 0)
    .map(k => regionNames[k]);
  if (buckets.other?.length > 0) activeRegionGroups.push('其他节点');

  if (logger && typeof logger.debug === 'function') {
    Object.keys(regionNames).forEach(k => {
      const gName = regionNames[k];
      const list = buckets[k] || [];
      if (list.length > 0) {
        const rDef = regionDefs.find(r => (r.id || r.name) === k);
        const iconPrefix = rDef?.icon ? `${rDef.icon} ` : '';
        const lowMultiCount = list.filter(name => {
          const item = classifiedNodes.find(n => (n.proxy?.name || n.rawName) === name);
          return item?.tags?.includes('download') || item?.attrs?.isLowMulti;
        }).length;
        const mainCount = list.length - lowMultiCount;
        const detailParts = [`主力: ${mainCount}`];
        if (lowMultiCount > 0) detailParts.push(`低倍率: ${lowMultiCount}`);
        logger.debug(`📦 [${iconPrefix}${gName}] 汇入 ${list.length} 个节点 (${detailParts.join(' | ')})`);
      }
    });

    if (buckets.other?.length > 0) {
      logger.debug(`📦 [🌐 其他节点] 汇入 ${buckets.other.length} 个节点`);
    }
    if (buckets.special?.length > 0) {
      logger.debug(`📦 [📌 特殊节点] 汇入 ${buckets.special.length} 个节点`);
    }
    if (userConfig.enableResidential && buckets.residential?.length > 0) {
      logger.debug(`📦 [🏠 家宽优选] 汇入 ${buckets.residential.length} 个节点`);
    }
    if (userConfig.isolateHighMulti && buckets.highMulti?.length > 0) {
      logger.debug(`📦 [🛑 高倍率节点] 汇入 ${buckets.highMulti.length} 个节点`);
    }
  }

  const resiPrefix = (userConfig.enableResidential && buckets.residential.length) ? ['家宽优选'] : [];
  const modeMap = { auto: '自动选择', manual: '手动选择', fallback: '故障转移', direct: 'DIRECT', reject: 'REJECT' };
  const proxyTarget = modeMap[userConfig.defaultProxyMode] || '自动选择';

  const highMultiRef = (userConfig.isolateHighMulti && buckets.highMulti.length > 0) ? [HIGH_MULTI_GROUP] : [];
  const experimentalRef = (userConfig.isolateExperimental && buckets.experimental.length > 0) ? [EXPERIMENTAL_GROUP] : [];

  const baseOptions = ['手动选择', '自动选择', '故障转移', ...highMultiRef, ...experimentalRef, ...resiPrefix, ...activeRegionGroups];
  const standardOptions = dedupe([proxyTarget, ...baseOptions]);
  const coreSelectProxies = ['自动选择', '故障转移', ...resiPrefix, ...highMultiRef, ...experimentalRef, ...buckets.special, ...activeRegionGroups, 'DIRECT'];

  const testURL = userConfig.testURL || 'https://cp.cloudflare.com/generate_204';
  const testInterval = userConfig.testInterval || 300;
  const testTolerance = userConfig.testTolerance || 50;

  const buildRegionGroup = (id, name, proxies) => {
    let type = userConfig.regionGroupType || 'url-test';
    if (mixedRegionIds.includes(id)) type = 'select';
    const base = { name, type, proxies: dedupe(proxies) };
    if (type !== 'select') {
      Object.assign(base, { url: testURL, interval: testInterval, lazy: true, ...(type === 'url-test' && { tolerance: testTolerance }) });
    }
    return base;
  };

  const appGroups = [];

  // AI 分组
  if (userConfig.enableAI && effectiveRegistries.ai) {
    const aiServices = userConfig.aiServices || ['chatgpt', 'gemini', 'claude', 'copilot'];
    const aiPreferred = (userConfig.aiPreferredRegions || ['us', 'jp', 'tw', 'sg', 'kr', 'eu']).map(id => regionNames[id]).filter(Boolean);

    aiServices.forEach(key => {
      const ai = effectiveRegistries.ai[key];
      if (!ai) return;
      const matchedNodes = buckets[ai.tag] || buckets[ai.pool] || [];
      appGroups.push(buildSelect(ai.name, [...resiPrefix, ...aiPreferred, ...matchedNodes, proxyTarget, 'DIRECT']));
    });
  }

  // 流媒体分组
  if (userConfig.enableStreaming && effectiveRegistries.streaming) {
    const streamingServices = userConfig.streamingServices || ['youtube', 'netflix', 'bilibili', 'disney', 'spotify', 'tiktok', 'bahamut', 'pixiv', 'twitch'];
    streamingServices.forEach(key => {
      const st = effectiveRegistries.streaming[key];
      if (!st) return;
      let proxies = [];
      switch (key) {
        case 'tiktok':
          proxies = [...(buckets.tiktok || buckets.tk || []), ...activeRegionGroups.filter(g => !['香港节点', '大陆节点', '中国节点', '未知识别'].includes(g)), proxyTarget, 'DIRECT'];
          break;
        case 'bahamut':
          proxies = ['台湾节点', '香港节点', proxyTarget, 'DIRECT'];
          break;
        case 'bilibili':
          proxies = userConfig.enableDomesticGroup ? ['中国分流', '台湾节点', '澳门节点', '香港节点', 'DIRECT'] : ['DIRECT', '台湾节点', '澳门节点', '香港节点'];
          break;
        default:
          proxies = [...(buckets[st.pool] || buckets[st.tag] || []), ...standardOptions, 'DIRECT'];
      }
      appGroups.push(buildSelect(st.name, proxies));
    });
  }

  // 社交分组
  if (userConfig.enableSocial && effectiveRegistries.social) {
    const socialServices = userConfig.socialServices || ['twitter', 'facebook', 'instagram', 'discord'];
    const independentSocial = userConfig.independentSocial || ['twitter'];
    const nonIndependent = socialServices.filter(k => !independentSocial.includes(k) && effectiveRegistries.social[k]);

    socialServices.forEach(key => {
      const app = effectiveRegistries.social[key];
      if (!app) return;
      if (independentSocial.includes(key)) {
        appGroups.push(buildSelect(app.name, [...standardOptions, 'DIRECT']));
      }
    });

    if (nonIndependent.length === 1) {
      appGroups.push(buildSelect(effectiveRegistries.social[nonIndependent[0]].name, [...standardOptions, 'DIRECT']));
    } else if (nonIndependent.length > 1) {
      appGroups.push(buildSelect('社交平台', [...standardOptions, 'DIRECT']));
    }
  }

  // 游戏分组
  if (userConfig.enableGame) {
    appGroups.push(buildSelect('游戏服务', ['DIRECT', ...standardOptions, ...(buckets.game || [])]));
    appGroups.push(buildSelect('游戏下载', ['DIRECT', '下载策略', '自动选择', '手动选择', ...(buckets.game || [])]));
  }

  // 专项应用分组
  if (userConfig.enableTelegram) appGroups.push(buildSelect('Telegram', [...standardOptions, 'DIRECT']));
  if (userConfig.enableGitHub) appGroups.push(buildSelect('GitHub', [...standardOptions, 'DIRECT']));
  if (userConfig.enableScholar) {
    const scholarPref = ['美国节点', '欧洲节点', '日本节点', '新加坡节点', '台湾节点', '香港节点'];
    appGroups.push(buildSelect('学术网站', [...scholarPref, proxyTarget, 'DIRECT']));
  }
  if (userConfig.enableCrypto) {
    const cryptoPref = ['台湾节点', '日本节点', '欧洲节点'];
    appGroups.push(buildSelect('加密货币', [...cryptoPref, ...resiPrefix, proxyTarget, 'DIRECT']));
  }
  if (userConfig.enablePayPal) {
    appGroups.push(buildSelect('PayPal', ['DIRECT', proxyTarget, ...activeRegionGroups, ...resiPrefix]));
  }

  if (userConfig.enableWebRTC) {
    const webrtcReturn = userConfig.enableDomesticGroup && !userConfig.proxyFirst;
    const webrtcList = webrtcReturn
      ? ['DIRECT', proxyTarget, '手动选择', '自动选择', ...activeRegionGroups]
      : [proxyTarget, 'DIRECT', '手动选择', '自动选择', ...activeRegionGroups];
    appGroups.push(buildSelect('WebRTC', webrtcList));
  }

  // 系统服务
  if (userConfig.enableSystemServices && effectiveRegistries.system) {
    const systemServices = userConfig.systemServices || ['microsoft', 'apple', 'google'];
    systemServices.forEach(key => {
      const sys = effectiveRegistries.system[key];
      if (sys) {
        const pList = key === 'google' ? [...standardOptions, 'DIRECT'] : ['DIRECT', ...standardOptions];
        appGroups.push(buildSelect(sys.name, pList));
      }
    });
  }

  if (userConfig.enableAdBlock || userConfig.enableAntiAD) {
    appGroups.push(buildSelect('广告拦截', ['REJECT-DROP', 'REJECT', 'DIRECT']));
  }

  // 5. 核心骨架组整合
  const finalGroups = [];

  if (userConfig.enableDashboard !== false && buckets.info.length > 0) {
    finalGroups.push(buildSelect('订阅与状态看板', [...buckets.info, 'DIRECT']));
  }

  finalGroups.push(
    buildSelect('手动选择', coreSelectProxies),
    { name: '自动选择', type: 'url-test', url: testURL, interval: testInterval, tolerance: testTolerance, proxies: buckets.allStandard },
    { name: '故障转移', type: 'fallback', url: testURL, interval: testInterval, proxies: activeRegionGroups }
  );

  if (userConfig.enableResidential) {
    finalGroups.push({ name: '家宽优选', type: 'fallback', url: testURL, interval: testInterval, proxies: buckets.residential });
  }

  finalGroups.push(buildSelect('下载策略', ['DIRECT', '负载均衡-轮询', '自动选择', ...buckets.download]));
  finalGroups.push({ name: '负载均衡-轮询', type: 'load-balance', strategy: 'round-robin', url: testURL, interval: 300, lazy: true, proxies: buckets.download, hidden: true });

  if (userConfig.isolateHighMulti && buckets.highMulti.length > 0) {
    finalGroups.push(buildSelect(HIGH_MULTI_GROUP, buckets.highMulti));
  }

  if (userConfig.isolateExperimental && buckets.experimental.length > 0) {
    finalGroups.push(buildSelect(EXPERIMENTAL_GROUP, buckets.experimental));
  }

  if (userConfig.enableDomesticGroup) {
    const cnCore = ['大陆节点', '香港节点', '澳门节点', '台湾节点'];
    const cnProxies = (userConfig.enableDomesticGroup && !userConfig.proxyFirst)
      ? [...cnCore, proxyTarget, 'DIRECT']
      : ['DIRECT', ...cnCore, proxyTarget];
    finalGroups.push(buildSelect('中国分流', cnProxies));
  }

  finalGroups.push(...appGroups);

  if (userConfig.enableIPv6) {
    finalGroups.push(buildSelect('IPv6控制台', ['REJECT', '手动选择', 'DIRECT']));
  }

  let fallbackProxies = [proxyTarget, '自动选择', '手动选择', '故障转移', '下载策略'];
  if (proxyTarget !== 'DIRECT') {
    userConfig.proxyFirst ? fallbackProxies.push('DIRECT') : fallbackProxies.unshift('DIRECT');
  }
  finalGroups.push(buildSelect('漏网之鱼', dedupe(fallbackProxies)));

  // 地区组
  Object.entries(regionNames).forEach(([id, name]) => {
    if (buckets[id] && buckets[id].length > 0) {
      finalGroups.push(buildRegionGroup(id, name, buckets[id]));
    }
  });

  finalGroups.push(
    buildSelect('其他节点', buckets.other),
    buildSelect('未知识别', buckets.garbage, userConfig.hideGarbageGroup)
  );

  // 自定义节点分组注入
  if (userConfig.customNodeGroups && buckets.special.length > 0) {
    for (const [keyword, targetGroups] of Object.entries(userConfig.customNodeGroups)) {
      if (!keyword || !Array.isArray(targetGroups)) continue;
      const kw = keyword.toLowerCase();
      const matched = buckets.special.filter(n => n.toLowerCase().includes(kw));
      if (!matched.length) continue;
      for (const tName of targetGroups) {
        const group = finalGroups.find(g => g.name === tName || (tName && tName.includes(g.name)) || (g.name && g.name.includes(tName)));
        if (group && group.proxies) {
          const s = new Set(group.proxies);
          matched.forEach(n => { if (!s.has(n)) group.proxies.push(n); });
        }
      }
    }
  }

  // 🏠 家宽节点注入：将指定地区的家宽节点追加到目标应用组
  if (userConfig.enableResidential && userConfig.residentialNodeGroups && buckets.residential.length > 0) {
    const resiGroups = userConfig.residentialNodeGroups;
    const existingGroupNames = new Set(finalGroups.map(g => g.name));
    const allResiNodes = buckets.residential;
    const resiRegionMap = buckets.resiRegionMap || {};
    for (const [regionKey, targetGroups] of Object.entries(resiGroups)) {
      if (!regionKey || !Array.isArray(targetGroups)) continue;
      let nodesToInject = allResiNodes;
      if (regionKey !== 'all') {
        nodesToInject = resiRegionMap[regionKey] || [];
      }
      if (nodesToInject.length === 0) continue;
      for (const targetName of targetGroups) {
        const group = finalGroups.find(g => g.name === targetName || (targetName && targetName.includes(g.name)) || (g.name && g.name.includes(targetName)));
        if (group && group.proxies) {
          const existing = new Set(group.proxies);
          nodesToInject.forEach(n => { if (!existing.has(n)) group.proxies.push(n); });
        }
      }
    }
  }

  return {
    proxyGroups: finalGroups,
    buckets
  };
}

module.exports = {
  HIGH_MULTI_GROUP,
  EXPERIMENTAL_GROUP,
  buildProxyTopology
};
