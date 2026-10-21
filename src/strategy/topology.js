/**
 * 策略组拓扑与分发结构生成器
 *
 * 负责大区智能折叠、功能策略组构建（AI、流媒体、游戏等）、节点入桶路由以及自定义分组注入。
 */

const { getEnhancedRegionDefs, CONTINENT_DEFS } = require('../core/shared/regions');
const { getTrustedProxyMetadata } = require('../core/node-trust');
const { FIELDS_BY_KEY } = require('../data');
const { ADS_GROUPS, DOWNLOAD_GROUPS, SKELETON_GROUP_DEFS } = require('../config/catalog');
const { evaluateCustomTopology, evaluateGroupDefinition, DEFAULT_MODE_MAP } = require('./topology-engine');
const { validateGroups } = require('./matcher');
const { filterGroupsByDirection } = require('../config/groups');
const { resolvePoolDefinitions, createPoolMatchers } = require('./pools');
const { POOL_NAMES } = require('../data/default-pools');
// 目标组名归一化工具与展示层 (presentation) 共用同一实现，避免装饰剥离规则两侧漂移。
const { stripGroupDecoration, NON_CN_EXCLUDED_GROUPS, CN_CORE_PROXY_GROUPS } = require('./presentation');

// 组名唯一来源是池定义，避免同一名字在两处各写一遍
const HIGH_MULTI_GROUP = POOL_NAMES.highMulti;
const EXPERIMENTAL_GROUP = POOL_NAMES.experimental;

// 由专用分支/策略独立维护的桶，通用 featurePools 遍历不重复入桶
const DEDICATED_FEATURE_POOLS = new Set(['residential', 'lowMulti', 'experimental']);

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
 * @param {Set<string>} params.referencedTargets 被分流规则实际引用到的目标组名（去装饰）
 * @returns {Array<object>} 声明式策略组配方列表
 */
function buildBuiltinAppRecipes({
  userConfig = {},
  effectiveRegistries = {},
  regionNames = {},
  buckets = {},
  referencedTargets = new Set()
}) {
  const recipes = [];

  // 建组口径：只有「被规则引用到的目标」才建组，组不再由开关直接驱动。
  // 开关只决定规则是否生成（进而决定目标是否出现），组永远跟着规则走——单一来源。

  // 1. AI 分组：配方直接取自 catalog 条目（match + proxies + preferredRegions），
  //    因此这里生成的组与用户 `groups: [{ ref: <键> }]` 引用到的声明完全同构——同一份定义，不是两条路径。
  if (effectiveRegistries.ai) {
    Object.keys(effectiveRegistries.ai).forEach(key => {
      const ai = effectiveRegistries.ai[key];
      if (!ai) return;
      if (!referencedTargets.has(ai.name)) return;
      // aiPreferredRegions 为全局覆写（与内置组目录构建口径一致）
      const prefList = Array.isArray(userConfig.aiPreferredRegions) && userConfig.aiPreferredRegions.length > 0
        ? userConfig.aiPreferredRegions
        : ai.preferredRegions;
      const servicePreferred = (prefList || []).map(id => regionNames[id]).filter(Boolean);
      // 内置条目 = 完整组声明（match + proxies 齐备）；用户 customsServices 条目多半只给了 reg，
      // 此时回落到「偏好地区 + 特征桶」内置模板，保持既有行为不变。
      const proxies = ai.proxies || [
        '@residentialGroup',
        ...servicePreferred,
        ...(buckets[ai.tag] || buckets[ai.pool] || []),
        '@defaultProxy',
        'DIRECT'
      ];
      recipes.push({
        name: ai.name,
        type: ai.type || 'select',
        match: ai.match,
        exclude: ai.exclude,
        proxies,
        preferredRegions: prefList
      });
    });
  }

  // 2. 流媒体分组：与 AI 同构，配方直接取自 catalog 条目（match + proxies + preferredRegions），
  //    因此这里生成的组与用户 `groups: [{ ref: <键> }]` 引用到的声明完全同构——同一份定义，不是两条路径。
  if (effectiveRegistries.streaming) {
    Object.keys(effectiveRegistries.streaming).forEach(key => {
      const st = effectiveRegistries.streaming[key];
      if (!st) return;
      if (!referencedTargets.has(st.name)) return;

      // 用户自建条目 (customServices) 多半只给了 reg，回落「特征桶 + 偏好地区」内置模板，保持既有行为
      const matched = buckets[st.pool] || buckets[st.tag] || [];
      const pref = (st.preferredRegions || []).map(id => regionNames[id]).filter(Boolean);
      const defaultProxies = [...matched, ...pref, '@standardOptions', 'DIRECT'];

      recipes.push({
        name: st.name,
        type: st.type || 'select',
        match: st.match,
        exclude: st.exclude,
        proxies: st.proxies || defaultProxies,
        preferredRegions: st.preferredRegions
      });
    });
  }

  // 3. 社交分组：一服务一组（与 AI / 流媒体同构）。
  //    合并组与「独立/合并」二分已取消：每个社交服务都是一条完整组声明，可单独引用、单独排序。
  if (effectiveRegistries.social) {
    Object.keys(effectiveRegistries.social).forEach(key => {
      const s = effectiveRegistries.social[key];
      if (!s || !referencedTargets.has(s.name)) return;
      const matched = buckets[s.pool] || buckets[s.tag] || [];
      const pref = (s.preferredRegions || []).map(id => regionNames[id]).filter(Boolean);
      recipes.push({
        name: s.name,
        type: s.type || 'select',
        match: s.match,
        exclude: s.exclude,
        proxies: s.proxies || [...matched, ...pref, '@standardOptions', 'DIRECT']
      });
    });
  }

  // 4. 游戏分组：配方直接取自 catalog 聚合条目（match + proxies），
  //    因此这里生成的组与用户 `groups: [{ ref: <聚合键> }]` 引用到的声明完全同构——同一份定义，不是两条路径。
  if (effectiveRegistries.aggregates) {
    const gameAggs = Object.values(effectiveRegistries.aggregates || {})
      .filter(agg => agg.category === 'game');

    gameAggs.forEach(agg => {
      if (!referencedTargets.has(agg.name)) return;
      recipes.push({
        name: agg.name,
        type: agg.type || 'select',
        match: agg.match,
        exclude: agg.exclude,
        proxies: agg.proxies
      });
    });
  }

  // 5. 开发者与学术服务：配方直接取自 catalog 条目（含 match / proxies / preferredRegions）
  if (effectiveRegistries.dev) {
    Object.keys(effectiveRegistries.dev).forEach(key => {
      const conf = effectiveRegistries.dev[key];
      if (!conf) return;
      if (!referencedTargets.has(conf.name)) return;

      // 用户自建条目回落模板，保持既有行为
      const pref = (conf.preferredRegions || []).map(id => regionNames[id]).filter(Boolean);
      const defaultProxies = pref.length > 0
        ? [...pref, '@defaultProxy', 'DIRECT']
        : ['@standardOptions', 'DIRECT'];

      recipes.push({
        name: conf.name,
        type: conf.type || 'select',
        match: conf.match,
        exclude: conf.exclude,
        proxies: conf.proxies || defaultProxies,
        preferredRegions: conf.preferredRegions
      });
    });
  }

  // 6. 专项应用分组 (由 effectiveRegistries.specialized 驱动)
  //    成员的 `@preferredRegions` 由拓扑引擎按条目 preferredRegions 展开（不再在此处手工预展开）
  const specializedMap = effectiveRegistries.specialized || {};
  for (const spec of Object.values(specializedMap)) {
    if (!referencedTargets.has(spec.name)) continue;

    let proxies = spec.proxies ? [...spec.proxies] : ['@standardOptions', 'DIRECT'];

    // 处理 WebRTC 回国模式偏好
    if (spec.key === 'webrtc' && userConfig.trafficDirection === 'return') {
      proxies = ['DIRECT', '@defaultProxy', '手动选择', '自动选择', '@activeRegions'];
    }

    recipes.push({
      name: spec.name,
      type: spec.type || 'select',
      match: spec.match,
      exclude: spec.exclude,
      proxies,
      preferredRegions: spec.preferredRegions
    });
  }

  // 7. 系统服务：配方直接取自 catalog 条目（含 match / proxies）
  if (effectiveRegistries.system) {
    Object.keys(effectiveRegistries.system).forEach(key => {
      const sys = effectiveRegistries.system[key];
      if (sys && referencedTargets.has(sys.name)) {
        recipes.push({
          name: sys.name,
          type: sys.type || 'select',
          match: sys.match,
          exclude: sys.exclude,
          proxies: sys.proxies || ['DIRECT', '@standardOptions']
        });
      }
    });
  }

  // 8. 广告拦截：组配方取自目录条目（ad-block / anti-ad 两条规则来源声明的是同一个组名，合并时归一）
  const adsGroup = (effectiveRegistries.groups || {})['ad-block'] || ADS_GROUPS['ad-block'];
  if (referencedTargets.has(adsGroup.name)) {
    recipes.push({
      name: adsGroup.name,
      type: adsGroup.type || 'select',
      proxies: adsGroup.proxies
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
  ruleTargets = [],
  logger = null
}) {
  // 0. 校验声明式策略组 (groups) match/exclude 配方合规性
  //    校验针对全量声明（含未生效方向），保证「换个方向才报错」的幽灵配置不存在
  validateGroups(userConfig.groups);

  // 方向只筛选声明，不做同名仲裁：同名组各写一个方向，激活哪个由 trafficDirection 决定
  const direction = userConfig.trafficDirection === 'return' ? 'return' : 'split';

  // 确保 registries 优先从 catalog 获取单一事实来源

  const effectiveRegistries = (registries && Object.keys(registries).length > 0)
    ? registries
    : (userConfig.catalog ? userConfig.catalog.toRegistries() : {});

  // 规则引用到的目标组名：内置应用组与「中国分流」是否存在，由它决定（引用即激活）
  const referencedTargets = new Set(Array.isArray(ruleTargets) ? ruleTargets : []);

  const regionDefs = getEnhancedRegionDefs();
  const mixedRegionIds = [...CONTINENT_DEFS.map(c => c.id), 'other'];

  // 1. 初始化分发桶
  // 节点池由数据表 + 用户 `pools` 声明决定：低倍率池恒在，三个隔离池由 `enableIsolation` 打开。
  const poolDefs = resolvePoolDefinitions(userConfig);
  const poolMatchers = createPoolMatchers(poolDefs);

  const buckets = {
    unknown: [],
    info: [],
    allStandard: [],
    special: [],
    other: [],
    resiRegionMap: {}
  };

  poolDefs.forEach(def => {
    buckets[def.bucket] = [];
  });

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

    // 2.2 节点专属策略组声明 (保持现有语义：groupTags 专用于目标定制组，不随大流进入常规地区桶与主力标准池)
    const groupTags = item.groupTags || getTrustedProxyMetadata(item.proxy, 'groupTags');
    const hasGroupTags = Array.isArray(groupTags) && groupTags.length > 0;
    if (hasGroupTags) {
      return;
    }

    // 2.3 业务特征池与专用池并行分发 (多维事实保留，不互相截断)
    // 🌟 将节点加入其命中的通用业务特征池 (AI, 流媒体, 游戏等)；跳过由专用分支独立维护的桶，避免重复入桶
    (item.featurePools || []).forEach(p => {
      if (DEDICATED_FEATURE_POOLS.has(p)) return;
      if (!buckets[p]) buckets[p] = [];
      addToBucket(buckets[p], finalName);
    });

    // 2.3.1 节点池分发：一份节点可以同时属于多个池（池只描述身份，不互相截断）
    const matchedPools = poolMatchers.filter(matcher => matcher.test(item));
    matchedPools.forEach(({ def }) => {
      if (!buckets[def.bucket]) buckets[def.bucket] = [];
      addToBucket(buckets[def.bucket], finalName);
    });

    // 家宽池按地区记录，供 residentialNodeGroups 注入使用
    if (matchedPools.some(({ def }) => def.name === POOL_NAMES.residential)) {
      const resiKey = item.regionInfo?.id || 'other';
      if (!buckets.resiRegionMap[resiKey]) buckets.resiRegionMap[resiKey] = [];
      addToBucket(buckets.resiRegionMap[resiKey], finalName);
    }

    // 2.4 主力地区组与全量标准池门禁判定 (Main Region & AllStandard Gating)
    if (item.isUnknownRegion) {
      addToBucket(buckets.unknown, finalName);
      return;
    }

    // 隔离门禁：命中隔离池的成员从主力地区桶与全量标准池中剔除（池桶里仍然保留）
    if (matchedPools.some(({ def }) => def.isolate)) {
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
          return item?.attrs?.isLowMulti;
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
    poolDefs.forEach(def => {
      const members = buckets[def.bucket] || [];
      if (members.length > 0) {
        logger.debug(`📦 [节点池 ${def.name}] 汇入 ${members.length} 个节点`);
      }
    });
  }

  // 池的建组条件：`always` 池直接物化；`onDemand` 池要等某条分流规则把它当目标（引用即激活）
  const isPoolMaterialized = def => def.group === 'always' || referencedTargets.has(def.name);
  const poolMembers = def => buckets[def.bucket] || [];
  const activePool = name => {
    const def = poolDefs.find(d => d.name === name);
    return (def && isPoolMaterialized(def) && poolMembers(def).length > 0) ? def : null;
  };

  const residentialPool = activePool(POOL_NAMES.residential);
  const highMultiPool = activePool(POOL_NAMES.highMulti);
  const experimentalPool = activePool(POOL_NAMES.experimental);

  const resiPrefix = residentialPool ? [POOL_NAMES.residential] : [];
  const proxyTarget = DEFAULT_MODE_MAP[userConfig.defaultProxyMode] || '自动选择';

  const highMultiRef = highMultiPool ? [HIGH_MULTI_GROUP] : [];
  const experimentalRef = experimentalPool ? [EXPERIMENTAL_GROUP] : [];

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
    regionNames,
    standardOptions,
    residentialGroup: resiPrefix,
    domesticGroup: referencedTargets.has('中国分流') ? ['中国分流'] : ['DIRECT'],
    nonCnRegions: activeRegionGroups.filter(g => !NON_CN_EXCLUDED_GROUPS.includes(g))
  };

  const appRecipes = buildBuiltinAppRecipes({
    userConfig,
    effectiveRegistries,
    regionNames,
    activeRegionGroups,
    buckets,
    referencedTargets
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

  // 池 → 组：规格（type / hidden）一律取自池声明，装配层只决定建组顺序与「空池不建组」。
  // 内置池、自定义池共用这一条物化路径，避免同一种组在代码里出现第二份配方。
  const materializePool = (def) => {
    if (!def) return null;
    const members = poolMembers(def);
    if (members.length === 0) return null;
    if (def.type === 'fallback') {
      return {
        name: def.name,
        type: 'fallback',
        url: testURL,
        interval: testInterval,
        proxies: members,
        ...(def.hidden === true ? { hidden: true } : {})
      };
    }
    return buildSelect(def.name, members, def.hidden === true);
  };

  const lowMultiPool = activePool(POOL_NAMES.lowMulti);

  // 内置池按声明顺序物化，装配层不再手工决定先后
  poolDefs
    .filter(def => def.builtin && def.group === 'always')
    .forEach(def => {
      const group = materializePool(def);
      if (group) finalGroups.push(group);
    });

  // 汇集全量节点池成员字典，供 DSL 中的 @pool:<池名> 统一展开
  const allPoolMembers = {};
  poolDefs.forEach(def => {
    allPoolMembers[def.name] = poolMembers(def);
  });

  // 方向语义骨架组：成员顺序写在各方向的数据声明里（config/catalog.js），
  // 此处只按 trafficDirection 取对应变体并交给统一求值器，不再现场推导顺序。
  const assembleSkeleton = (def) => evaluateGroupDefinition(def, {
    classifiedNodes,
    buckets,
    userConfig,
    existingGroups: finalGroups,
    groups: [],
    activeRegionGroups,
    regionNames,
    standardOptions,
    residentialGroup: resiPrefix,
    domesticGroup: engineContext.domesticGroup,
    nonCnRegions: engineContext.nonCnRegions,
    poolMembers: allPoolMembers,
    cnCoreGroups: CN_CORE_PROXY_GROUPS.filter(name => activeRegionGroups.includes(name)),
    downloadGroup: lowMultiPool ? ['下载策略'] : [],
    logger
  });

  // 下载相关组（下载策略 / 负载均衡-轮询）：出厂声明在 config/catalog.js，
  // 拓扑只负责「低倍率池非空时装配」；成员由 `@pool:低倍率节点` 展开。
  if (lowMultiPool) {
    const { evaluatedGroups } = evaluateCustomTopology({
      groups: DOWNLOAD_GROUPS,
      existingGroups: finalGroups,
      classifiedNodes,
      buckets,
      userConfig,
      standardOptions,
      residentialGroup: resiPrefix,
      activeRegionGroups,
      regionNames,
      nonCnRegions: engineContext.nonCnRegions,
      domesticGroup: engineContext.domesticGroup,
      poolMembers: allPoolMembers,
      logger
    });
    finalGroups.push(...evaluatedGroups);
  }

  // 自定义池：与内置池同一条物化路径，按声明顺序追加
  poolDefs
    .filter(def => !def.builtin && isPoolMaterialized(def))
    .forEach(def => {
      const group = materializePool(def);
      if (group) finalGroups.push(group);
    });

  // 中国分流组：只有某条生效规则把它当目标时才生成（引用即激活）
  if (referencedTargets.has('中国分流')) {
    const domesticGroup = assembleSkeleton(SKELETON_GROUP_DEFS.domestic[direction]);
    if (domesticGroup) finalGroups.push(domesticGroup);
  }

  finalGroups.push(...appGroups);

  if (userConfig.enableIPv6) {
    finalGroups.push(buildSelect('IPv6控制台', ['REJECT', '手动选择', 'DIRECT']));
  }

  // 兜底组：成员顺序同样由方向声明给出（split 以默认代理起头，return 以 DIRECT 起头）
  const finalGroup = assembleSkeleton(SKELETON_GROUP_DEFS.final[direction]);
  if (finalGroup) finalGroups.push(finalGroup);

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

  // 声明式自定义策略组装配 (groups DSL 引擎)
  if (Array.isArray(userConfig.groups) && userConfig.groups.length > 0) {
    const { evaluatedGroups } = evaluateCustomTopology({
      groups: filterGroupsByDirection(userConfig.groups, direction),
      existingGroups: finalGroups,
      classifiedNodes,
      buckets,
      userConfig,
      standardOptions,
      residentialGroup: resiPrefix,
      activeRegionGroups,
      regionNames,
      nonCnRegions: engineContext.nonCnRegions,
      domesticGroup: engineContext.domesticGroup,
      poolMembers: allPoolMembers,
      logger
    });
    for (const eg of evaluatedGroups) {
      const idx = finalGroups.findIndex(g => stripGroupDecoration(g.name).toLowerCase() === stripGroupDecoration(eg.name).toLowerCase());
      if (idx !== -1) {
        // 同名策略组覆盖/合并现有骨架组
        const existing = finalGroups[idx];
        const mergedProxies = (Array.isArray(eg.proxies) && eg.proxies.length > 0)
          ? eg.proxies
          : existing.proxies;
        finalGroups[idx] = {
          ...existing,
          ...eg,
          name: existing.name,
          proxies: mergedProxies
        };
      } else {
        finalGroups.push(eg);
      }
    }
  }

  // 节点专属策略组注入 (来自 subscriptions 中的 groups 声明)
  classifiedNodes.forEach(item => {
    if (item.skip || item.isInfo) return;
    const groupTags = item.groupTags || getTrustedProxyMetadata(item.proxy, 'groupTags');
    if (!Array.isArray(groupTags) || groupTags.length === 0) return;
    const nodeName = item.proxy?.name || item.rawName;

    for (const rawTarget of groupTags) {
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

  // 🏠 家宽节点注入：将指定地区的家宽节点追加到目标应用组（家宽池已打开时才生效）
  if (residentialPool && userConfig.residentialNodeGroups) {
    const resiGroups = userConfig.residentialNodeGroups;
    const allResiNodes = poolMembers(residentialPool);
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
