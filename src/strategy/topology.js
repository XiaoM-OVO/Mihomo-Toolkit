/**
 * 策略组拓扑与分发结构生成器
 *
 * 负责大区智能折叠、功能策略组构建（AI、流媒体、游戏等）、节点入桶路由以及自定义分组注入。
 */

const { getEnhancedRegionDefs, CONTINENT_DEFS } = require('../core/shared/regions');
const { getTrustedProxyMetadata } = require('../core/node-trust');
const { FIELDS_BY_KEY } = require('../data');
const { evaluateCustomTopology, evaluateGroupDefinition, DEFAULT_MODE_MAP } = require('./topology-engine');
const { validateCustomGroups } = require('./matcher');
// 目标组名归一化工具与展示层 (presentation) 共用同一实现，避免装饰剥离规则两侧漂移。
const { stripGroupDecoration } = require('./presentation');

const HIGH_MULTI_GROUP = '高倍率优选';
const EXPERIMENTAL_GROUP = '实验节点';

// 由专用分支/策略独立维护的桶，通用 featurePools 遍历不重复入桶
const DEDICATED_FEATURE_POOLS = new Set(['residential', 'download', 'experimental']);

function dedupe(arr) {
  return [...new Set(arr)];
}

function addToBucket(bucket, item) {
  if (Array.isArray(bucket) && !bucket.includes(item)) {
    bucket.push(item);
  }
}

const buildSelect = (name, proxies, hidden = false) => ({
  name,
  type: 'select',
  proxies: dedupe(proxies),
  hidden
});

// 目标组名归一化：剥离前导 Emoji / 符号装饰后精确比对（既兼容「🤖 ChatGPT」这类带图标前缀的书写习惯，
// 又杜绝「节点」这类短目标名通过子串匹配误命中「香港节点」等多个无关策略组）。
// 具体实现 stripGroupDecoration 由展示层 (presentation) 提供，两处共用同一规则，避免漂移。

/**
 * 按「归一化精确匹配」解析目标策略组，禁止子串模糊命中。
 * @param {Array<object>} groups 现有策略组列表
 * @param {string} rawTarget 目标组名（允许带 Emoji/图标前缀）
 * @returns {object|null}
 */
function resolveTargetGroup(groups, rawTarget) {
  const target = stripGroupDecoration(rawTarget).toLowerCase();
  if (!target) return null;
  return groups.find(g => stripGroupDecoration(g.name).toLowerCase() === target) || null;
}

/**
 * 声明式构建全量内置应用策略组配方 (Recipes)
 * @param {object} params
 * @param {object} params.userConfig
 * @param {object} params.effectiveRegistries
 * @param {object} params.regionNames
 * @param {Array<string>} params.activeRegionGroups
 * @param {object} params.buckets
 * @returns {Array<object>} 声明式策略组配方列表
 */
function buildBuiltinAppRecipes({
  userConfig = {},
  effectiveRegistries = {},
  regionNames = {},
  buckets = {}
}) {
  const recipes = [];

  // 1. AI 分组
  if (userConfig.enableAI && effectiveRegistries.ai) {
    const aiServices = userConfig.aiServices || Object.keys(effectiveRegistries.ai);
    const defaultAiPref = userConfig.aiPreferredRegions || ['us', 'jp', 'tw', 'sg', 'kr', 'eu'];

    aiServices.forEach(key => {
      const ai = effectiveRegistries.ai[key];
      if (!ai) return;
      const matchedNodes = buckets[ai.tag] || buckets[ai.pool] || [];
      const prefList = userConfig.aiPreferredRegions
        ? userConfig.aiPreferredRegions
        : (ai.preferredRegions && ai.preferredRegions.length > 0 ? ai.preferredRegions : defaultAiPref);
      const servicePreferred = prefList.map(id => regionNames[id]).filter(Boolean);

      recipes.push({
        name: ai.name,
        type: 'select',
        proxies: ai.proxies || [
          '@residentialGroup',
          ...servicePreferred,
          ...matchedNodes,
          '@defaultProxy',
          'DIRECT'
        ]
      });
    });
  }

  // 2. 流媒体分组
  if (userConfig.enableStreaming && effectiveRegistries.streaming) {
    const streamingServices = userConfig.streamingServices || Object.keys(effectiveRegistries.streaming);
    streamingServices.forEach(key => {
      const st = effectiveRegistries.streaming[key];
      if (!st) return;

      const matched = buckets[st.pool] || buckets[st.tag] || [];
      const pref = (st.preferredRegions || []).map(id => regionNames[id]).filter(Boolean);
      const defaultProxies = [...matched, ...pref, '@standardOptions', 'DIRECT'];

      recipes.push({
        name: st.name,
        type: 'select',
        pool: st.pool,
        tag: st.tag,
        proxies: st.proxies || defaultProxies
      });
    });
  }

  // 3. 社交分组
  if (userConfig.enableSocial && effectiveRegistries.social) {
    const socialServices = userConfig.socialServices || Object.keys(effectiveRegistries.social);
    const independentSocial = userConfig.independentSocial || ['twitter'];
    const nonIndependent = socialServices.filter(k => !independentSocial.includes(k) && effectiveRegistries.social[k]);

    socialServices.forEach(key => {
      const app = effectiveRegistries.social[key];
      if (!app) return;
      if (independentSocial.includes(key)) {
        recipes.push({
          name: app.name,
          type: 'select',
          proxies: app.proxies || ['@standardOptions', 'DIRECT']
        });
      }
    });

    if (nonIndependent.length === 1) {
      recipes.push({
        name: effectiveRegistries.social[nonIndependent[0]].name,
        type: 'select',
        proxies: ['@standardOptions', 'DIRECT']
      });
    } else if (nonIndependent.length > 1) {
      recipes.push({
        name: '社交平台',
        type: 'select',
        proxies: ['@standardOptions', 'DIRECT']
      });
    }
  }

  // 4. 游戏分组 (由 effectiveRegistries.aggregates 驱动)
  if (userConfig.enableGame) {
    const gameBuckets = buckets.game || [];
    const gameAggs = effectiveRegistries.aggregates
      ? [effectiveRegistries.aggregates['游戏服务'], effectiveRegistries.aggregates['游戏下载']].filter(Boolean)
      : [];

    gameAggs.forEach(agg => {
      recipes.push({
        name: agg.name,
        type: 'select',
        proxies: (agg.proxies || []).map(p => (p === '@buckets.game' ? gameBuckets : p)).flat()
      });
    });
  }

  // 5. 开发者与学术服务
  if (effectiveRegistries.dev) {
    const devActive = Array.isArray(userConfig.devServices)
      ? userConfig.devServices
      : Object.keys(effectiveRegistries.dev);

    devActive.forEach(key => {
      if (key === 'github' && userConfig.enableGitHub === false) return;
      if (key === 'scholar' && userConfig.enableScholar === false) return;

      const conf = effectiveRegistries.dev[key];
      if (!conf) return;

      const pref = (conf.preferredRegions || []).map(id => regionNames[id]).filter(Boolean);
      const defaultProxies = pref.length > 0
        ? [...pref, '@defaultProxy', 'DIRECT']
        : ['@standardOptions', 'DIRECT'];

      recipes.push({
        name: conf.name,
        type: 'select',
        pool: conf.pool,
        tag: conf.tag,
        proxies: conf.proxies || defaultProxies
      });
    });
  }

  // 6. 专项应用分组 (由 effectiveRegistries.specialized 驱动)
  const specializedMap = effectiveRegistries.specialized || {};
  for (const spec of Object.values(specializedMap)) {
    if (!userConfig[spec.configKey]) continue;

    let proxies = spec.proxies ? [...spec.proxies] : ['@standardOptions', 'DIRECT'];

    // 处理 WebRTC 回国模式偏好
    if (spec.key === 'webrtc' && userConfig.enableDomesticGroup && !userConfig.proxyFirst) {
      proxies = ['DIRECT', '@defaultProxy', '手动选择', '自动选择', '@activeRegions'];
    }
    // 处理偏好大区展开 (如 Crypto 的 preferredRegions)
    if (spec.preferredRegions && proxies.includes('@preferredRegions')) {
      const pref = spec.preferredRegions.map(id => regionNames[id]).filter(Boolean);
      proxies = proxies.flatMap(p => (p === '@preferredRegions' ? pref : p));
    }

    recipes.push({
      name: spec.name,
      type: 'select',
      proxies
    });
  }

  // 6. 系统服务
  if (userConfig.enableSystemServices && effectiveRegistries.system) {
    const systemServices = userConfig.systemServices || Object.keys(effectiveRegistries.system);
    systemServices.forEach(key => {
      const sys = effectiveRegistries.system[key];
      if (sys) {
        recipes.push({
          name: sys.name,
          type: 'select',
          proxies: sys.proxies || ['DIRECT', '@standardOptions']
        });
      }
    });
  }

  // 7. 广告拦截
  if (userConfig.enableAdBlock || userConfig.enableAntiAD) {
    recipes.push({
      name: '广告拦截',
      type: 'select',
      proxies: ['REJECT-DROP', 'REJECT', 'DIRECT']
    });
  }

  return recipes;
}

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
  // 0. 校验声明式策略组 (customGroups) match/exclude 配方合规性
  validateCustomGroups(userConfig.customGroups);

  // 确保 registries 优先从 catalog 获取单一事实来源

  const effectiveRegistries = (registries && Object.keys(registries).length > 0)
    ? registries
    : (userConfig.catalog ? userConfig.catalog.toRegistries() : {});

  const regionDefs = getEnhancedRegionDefs();
  const mixedRegionIds = [...CONTINENT_DEFS.map(c => c.id), 'other'];

  // 1. 初始化分发桶
  const buckets = {
    unknown: [],
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
      addToBucket(buckets.info, finalName);
      return;
    }

    if (item.isSpecial) {
      addToBucket(buckets.special, finalName);
      return;
    }

    // 2.2 节点专属策略组声明 (保持现有语义：customGroups 专用于目标定制组，不随大流进入常规地区桶与主力标准池)
    const customGroups = item.customGroups || getTrustedProxyMetadata(item.proxy, 'customGroups');
    const hasCustomGroups = Array.isArray(customGroups) && customGroups.length > 0;
    if (hasCustomGroups) {
      return;
    }

    const tags = item.tags || [];
    const multi = item.attrs?.multiNum ?? 1;
    const isHighMulti = multi > (userConfig.highMultiThreshold ?? 2.5);

    // 2.3 业务特征池与专用池并行分发 (多维事实保留，不互相截断)
    // 🌟 将节点加入其命中的通用业务特征池 (AI, 流媒体, 游戏等)；跳过由专用分支独立维护的桶，避免重复入桶
    (item.featurePools || []).forEach(p => {
      if (DEDICATED_FEATURE_POOLS.has(p)) return;
      if (!buckets[p]) buckets[p] = [];
      addToBucket(buckets[p], finalName);
    });

    // 家宽池 (由 enableResidential 策略控制是否入桶)
    if (userConfig.enableResidential && tags.includes('residential')) {
      addToBucket(buckets.residential, finalName);
      const resiKey = item.regionInfo?.id || 'other';
      if (!buckets.resiRegionMap[resiKey]) buckets.resiRegionMap[resiKey] = [];
      addToBucket(buckets.resiRegionMap[resiKey], finalName);
    }

    // 低倍率下载池
    if (tags.includes('download')) {
      addToBucket(buckets.download, finalName);
    }

    // 高倍率专用池
    if (userConfig.isolateHighMulti && isHighMulti) {
      addToBucket(buckets.highMulti, finalName);
    }

    // 实验专用池 (由 isolateExperimental 策略控制是否入桶)
    if (userConfig.isolateExperimental && tags.includes('experimental')) {
      addToBucket(buckets.experimental, finalName);
    }

    // 2.4 主力地区组与全量标准池门禁判定 (Main Region & AllStandard Gating)
    if (item.isUnknownRegion) {
      addToBucket(buckets.unknown, finalName);
      return;
    }

    // 隔离门禁：命中隔离策略时从主力地区桶与全量标准池中剔除
    if (userConfig.isolateDownload && tags.includes('download')) {
      return;
    }
    if (userConfig.enableResidential && tags.includes('residential')) {
      return;
    }
    if (userConfig.isolateHighMulti && isHighMulti) {
      return;
    }
    if (userConfig.isolateExperimental && tags.includes('experimental')) {
      return;
    }

    // 2.5 正常合格进入大区桶与主力标准池
    const rKey = item.regionInfo
      ? (item.regionInfo.id || regionDefs.find(r => r.name === item.regionInfo.name)?.id || 'other')
      : 'other';
    if (!buckets[rKey]) buckets[rKey] = [];
    addToBucket(buckets[rKey], finalName);

    if (rKey !== 'cn') {
      addToBucket(buckets.allStandard, finalName);
    }
  });

  // 3. 处理小众地区与大洲折叠
  const defaultCoreList = FIELDS_BY_KEY.coreRegions ? FIELDS_BY_KEY.coreRegions.default : ['cn', 'hk', 'tw', 'jp', 'kr', 'sg', 'us'];
  const rawCoreList = Array.isArray(userConfig.coreRegions) ? userConfig.coreRegions : defaultCoreList;
  const coreRegionIds = new Set(rawCoreList.map(k => String(k).toLowerCase()));

  const regionNames = {};

  // 先把已登记的地区元数据录入可用映射表，供下游 AI 偏好组等引用解析
  regionDefs.forEach(r => {
    regionNames[r.id] = r.groupName;
  });
  CONTINENT_DEFS.forEach(c => {
    regionNames[c.id] = c.groupName;
  });

  const threshold = userConfig.minorNodeThreshold ?? 3;

  regionDefs.forEach(r => {
    const isCore = coreRegionIds.has(r.id.toLowerCase()) || coreRegionIds.has(r.name.toLowerCase());
    const nodes = buckets[r.id];
    if (nodes && nodes.length > 0) {
      if (isCore || nodes.length >= threshold) {
        // 主力免折叠大区或节点数达到阈值：保持独立建组
      } else {
        // 小众地区节点折叠进大洲组或 other
        const targetContinent = r.foldGroup || r.group || 'other';
        if (!buckets[targetContinent]) buckets[targetContinent] = [];
        buckets[targetContinent].push(...nodes);
        buckets[r.id] = [];
      }
    }
  });

  // 处理大洲折叠
  CONTINENT_DEFS.forEach(continent => {
    const isCore = coreRegionIds.has(continent.id.toLowerCase());
    const nodes = buckets[continent.id];
    if (nodes && nodes.length > 0) {
      if (!isCore && nodes.length < threshold) {
        buckets.other.push(...nodes);
        buckets[continent.id] = [];
      }
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
        const rDef = regionDefs.find(r => r.id === k) || CONTINENT_DEFS.find(c => c.id === k);
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
  const proxyTarget = DEFAULT_MODE_MAP[userConfig.defaultProxyMode] || '自动选择';

  const highMultiRef = (userConfig.isolateHighMulti && buckets.highMulti.length > 0) ? [HIGH_MULTI_GROUP] : [];
  const experimentalRef = (userConfig.isolateExperimental && buckets.experimental.length > 0) ? [EXPERIMENTAL_GROUP] : [];

  const baseOptions = ['手动选择', '自动选择', '故障转移', ...highMultiRef, ...experimentalRef, ...resiPrefix, ...activeRegionGroups];
  const standardOptions = dedupe([proxyTarget, ...baseOptions]);
  const coreSelectProxies = ['自动选择', '故障转移', ...resiPrefix, ...highMultiRef, ...experimentalRef, ...buckets.special, ...activeRegionGroups, 'DIRECT'];

  const testURL = userConfig.testURL || FIELDS_BY_KEY.testURL.default;
  const testInterval = userConfig.testInterval || FIELDS_BY_KEY.testInterval.default;
  const testTolerance = userConfig.testTolerance || FIELDS_BY_KEY.testTolerance.default;

  const buildRegionGroup = (id, name, proxies) => {
    let type = userConfig.regionGroupType || 'url-test';
    if (mixedRegionIds.includes(id)) type = 'select';
    const base = { name, type, proxies: dedupe(proxies) };
    if (type !== 'select') {
      Object.assign(base, { url: testURL, interval: testInterval, lazy: true, ...(type === 'url-test' && { tolerance: testTolerance }) });
    }
    return base;
  };

  const engineContext = {
    classifiedNodes,
    buckets,
    userConfig,
    activeRegionGroups,
    standardOptions,
    residentialGroup: resiPrefix,
    domesticGroup: userConfig.enableDomesticGroup ? ['中国分流'] : ['DIRECT'],
    nonCnRegions: activeRegionGroups.filter(g => !['香港节点', '大陆节点', '中国节点', '未知识别'].includes(g))
  };

  const appRecipes = buildBuiltinAppRecipes({
    userConfig,
    effectiveRegistries,
    regionNames,
    activeRegionGroups,
    buckets
  });

  const appGroups = appRecipes
    .map(recipe => evaluateGroupDefinition(recipe, engineContext))
    .filter(Boolean);


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

  const fallbackProxies = [proxyTarget, '自动选择', '手动选择', '故障转移', '下载策略'];
  if (proxyTarget !== 'DIRECT') {
    if (userConfig.proxyFirst) {
      fallbackProxies.push('DIRECT');
    } else {
      fallbackProxies.unshift('DIRECT');
    }
  }
  finalGroups.push(buildSelect('漏网之鱼', dedupe(fallbackProxies)));

  // 地区组与哈希负载均衡
  Object.entries(regionNames).forEach(([id, name]) => {
    const regionNodes = buckets[id];
    if (regionNodes && regionNodes.length > 0) {
      if (userConfig.enableRegionHashLB && regionNodes.length > 1) {
        const cleanRegionName = name.replace(/节点$/, '');
        // 内部一律使用纯净中文名，Emoji 徽标由展示层 (presentation) 在终末统一渲染，
        // 避免硬编码 ⚖️ 在 groupIconMode: "icon" 下无法剥离
        const hashGroupName = `负载均衡-哈希 (${cleanRegionName})`;
        finalGroups.push({
          name: hashGroupName,
          type: 'load-balance',
          strategy: 'consistent-hashing',
          url: testURL,
          interval: testInterval,
          lazy: true,
          proxies: dedupe(regionNodes),
          hidden: true
        });
        finalGroups.push(buildRegionGroup(id, name, [hashGroupName, ...regionNodes]));
      } else {
        finalGroups.push(buildRegionGroup(id, name, regionNodes));
      }
    }
  });

  finalGroups.push(
    buildSelect('其他节点', buckets.other),
    buildSelect('未知识别', buckets.unknown, userConfig.hideUnknownGroup)
  );

  // 声明式自定义策略组装配 (customGroups DSL 引擎)
  if (Array.isArray(userConfig.customGroups) && userConfig.customGroups.length > 0) {
    const { evaluatedGroups } = evaluateCustomTopology({
      customGroups: userConfig.customGroups,
      existingGroups: finalGroups,
      classifiedNodes,
      buckets,
      userConfig,
      standardOptions,
      residentialGroup: resiPrefix,
      logger
    });
    for (const eg of evaluatedGroups) {
      const idx = finalGroups.findIndex(g => stripGroupDecoration(g.name).toLowerCase() === stripGroupDecoration(eg.name).toLowerCase());
      if (idx !== -1) {
        // 同名策略组覆盖/合并现有骨架组
        finalGroups[idx] = { ...finalGroups[idx], ...eg };
      } else {
        finalGroups.push(eg);
      }
    }
  }

  // 节点专属策略组注入 (来自 subscriptions 中的 groups 声明)
  classifiedNodes.forEach(item => {
    if (item.skip || item.isInfo) return;
    const customGroups = item.customGroups || getTrustedProxyMetadata(item.proxy, 'customGroups');
    if (!Array.isArray(customGroups) || customGroups.length === 0) return;
    const nodeName = item.proxy?.name || item.rawName;

    for (const rawTarget of customGroups) {
      if (!rawTarget || typeof rawTarget !== 'string') continue;
      const tName = rawTarget.trim();
      const group = resolveTargetGroup(finalGroups, tName);
      if (group && Array.isArray(group.proxies)) {
        if (!group.proxies.includes(nodeName)) {
          group.proxies.unshift(nodeName);
        }
      } else if (!group) {
        // 若目标组不存在，动态自动创建新策略组（名称剥离图标前缀，维持纯名称基线）
        finalGroups.push(buildSelect(stripGroupDecoration(tName), [nodeName, 'DIRECT']));
      }
    }
  });

  // 🏠 家宽节点注入：将指定地区的家宽节点追加到目标应用组
  if (userConfig.enableResidential && userConfig.residentialNodeGroups && buckets.residential.length > 0) {
    const resiGroups = userConfig.residentialNodeGroups;
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
        const group = resolveTargetGroup(finalGroups, targetName);
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
  buildBuiltinAppRecipes,
  buildProxyTopology
};
