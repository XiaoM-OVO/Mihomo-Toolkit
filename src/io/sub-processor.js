/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 订阅源抓取调度与预处理网关 (Subscription Processor)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 并发调度多订阅 HTTP 抓取与直接 URI 识别
 * 2. 结合 Stale 缓存实施失败平滑容灾降级
 * 3. 提取订阅信息、识别机场标签、嗅探重置日
 * 4. 树状输出解析统计日志
 */

const { parseContent, parseSubscriptionInfo, isExpiredNow } = require('./parsers');
const { generateInfoNodes } = require('./sub-info');
const { redactUrl } = require('./ssrf');
const { fetchNodes, resolveProxyUrl, subStaleCache, pruneSubStaleCache } = require('./fetcher');
const {
  filterRawInfoNodes,
  extractResetText,
  createFetchErrorNode
} = require('../strategy/dashboard');

function isSubEnabled(s) {
  if (!s || typeof s !== 'object') return false;
  return s.enable !== false && s.enabled !== false && s.disabled !== true;
}

/**
 * 处理所有订阅源或单 URL，并完成前置解析与看板合成
 */
async function processSubscriptionSources({ subscriptions, url, userConfig, options, logger }) {
  const showFullUrl = userConfig.redactLevel === 'off';
  const debug = !!options.debug;
  const enableDashboard = userConfig.enableDashboard !== false;
  const fetchRetry = typeof userConfig.fetchRetry === 'number' ? userConfig.fetchRetry : 2;
  const fetchTimeoutSec = typeof userConfig.fetchTimeout === 'number' ? userConfig.fetchTimeout : 15;
  const staleMaxAgeMs = (typeof userConfig.fetchStaleTtl === 'number' ? userConfig.fetchStaleTtl : 24) * 60 * 60 * 1000;

  let configData = { proxies: [] };
  let hasInjectedTag = false;
  let hasFailedSub = false;
  const collectedSubInfos = [];

  function recordSubInfo(subInfo, subTag) {
    if (!subInfo) return;
    const { upload, download, total, expire } = parseSubscriptionInfo(subInfo);
    collectedSubInfos.push({
      tag: subTag,
      upload,
      download,
      total,
      expire,
      expired: isExpiredNow(expire)
    });
  }

  // 1. 多订阅并发抓取分支
  if (subscriptions && Array.isArray(subscriptions) && subscriptions.length > 0) {
    const urlSubs = subscriptions.filter(isSubEnabled).filter(s => s.url).length;

    const fetchTasks = subscriptions.map(async (sub) => {
      if (!isSubEnabled(sub)) {
        return { sub, rawResult: null, error: null, disabled: true };
      }
      if (!sub.url && !sub.uri) return { sub, rawResult: null, error: null };
      try {
        let rawResult;
        if (sub.uri) {
          rawResult = { content: sub.uri, subInfo: null };
        } else {
          const subKey = sub.url;
          try {
            rawResult = await fetchNodes(sub.url, {
              showFullUrl, debug,
              proxyUrl: resolveProxyUrl(userConfig),
              strategy: userConfig.fetchProxyStrategy,
              perSubProxy: sub.proxy,
              retry: typeof sub.retry === 'number' ? sub.retry : fetchRetry,
              timeoutMs: fetchTimeoutSec * 1000
            });
            if (!rawResult.content || (parseContent(rawResult.content).proxies || []).length === 0) {
              throw new Error('Subscription returned no nodes');
            }
          } catch (e) {
            const stale = subStaleCache.get(subKey);
            if (stale && Date.now() - stale.timestamp < staleMaxAgeMs) {
              logger.warn(`⚠️ 订阅拉取失败，降级使用上次成功数据: ${e.message}`);
              rawResult = { content: stale.content, subInfo: stale.subInfo, stale: true };
            } else {
              throw e;
            }
          }
          if (rawResult && !rawResult.stale) {
            subStaleCache.set(subKey, { content: rawResult.content, subInfo: rawResult.subInfo, timestamp: Date.now() });
            pruneSubStaleCache(staleMaxAgeMs);
          }
        }
        return { sub, rawResult, error: null };
      } catch (e) {
        hasFailedSub = true;
        return { sub, rawResult: null, error: e };
      }
    });

    const fetchedResults = await Promise.all(fetchTasks);
    const subSummaries = [];

    for (const { sub, rawResult, error, disabled } of fetchedResults) {
      if (disabled) {
        const tag = sub.tag || (sub.url ? redactUrl(sub.url, showFullUrl) : (sub.name || '自建'));
        subSummaries.push({ disabled: true, tag, type: sub.uri ? 'uri' : 'url' });
        continue;
      }
      if (!rawResult && !error) continue;
      try {
        if (error) throw error;
        recordSubInfo(rawResult.subInfo, sub.tag);
        const subConfig = parseContent(rawResult.content);
        let subProxies = subConfig.proxies || [];

        if (sub.uri && sub.name && subProxies.length > 0) {
          subProxies[0].name = sub.name;
        }

        if (sub.uri) {
          const nameHint = subProxies[0] ? subProxies[0].name : '未知';
          logger.debug(`URI 节点: ${nameHint}${sub.tag ? ` [${sub.tag}]` : ''}`);
        }

        let effectiveTag = sub.tag;
        let effectiveIndexPrefix = sub.indexPrefix;
        if (!effectiveTag) {
          const reg = /^\[([^\]]{1,12})\]/i;
          const tagCounts = {};
          for (const p of subProxies) {
            if (p.name) {
              const m = p.name.match(reg);
              if (m) {
                const tag = m[1].trim();
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
              }
            }
          }
          let bestTag = '';
          let maxCount = 0;
          for (const [t, c] of Object.entries(tagCounts)) {
            if (c > maxCount) { maxCount = c; bestTag = t; }
          }
          effectiveTag = bestTag;
          if (!effectiveTag && sub.url && sub.url.startsWith('http')) {
            try { effectiveTag = new URL(sub.url).hostname; } catch (e) {}
          }
          if (!effectiveTag) effectiveTag = '订阅';
        }

        const resetText = extractResetText(sub, subProxies);
        const rawCount = subProxies.length;
        subProxies = filterRawInfoNodes(subProxies, logger);
        const filteredCount = rawCount - subProxies.length;

        if (sub.tag) {
          subProxies.forEach(p => {
            if (!p._subTag) p._subTag = sub.tag;
          });
        }

        if (sub.uri && sub.tag) {
          const whitelist = userConfig.whitelistKeywords || [];
          const tagLower = sub.tag.toLowerCase();
          if (!whitelist.some(k => k.toLowerCase() === tagLower)) {
            if (!userConfig.whitelistKeywords) userConfig.whitelistKeywords = [];
            userConfig.whitelistKeywords.push(sub.tag);
          }
        }

        if (effectiveIndexPrefix) {
          subProxies.forEach(p => { p._indexPrefix = effectiveIndexPrefix; });
        }

        const { nodes: synthNodes, expireDays } = enableDashboard
          ? generateInfoNodes(rawResult.subInfo, effectiveTag, { isStale: !!rawResult.stale })
          : { nodes: [], expireDays: -1 };

        if (enableDashboard && resetText && (expireDays === -1 || expireDays > 30)) {
          synthNodes.push({
            name: `🔄 [${effectiveTag}] ${resetText}`,
            type: 'direct',
            server: '1.0.0.1',
            port: 80,
            isSyntheticInfo: true
          });
        }

        if (synthNodes.length > 0) {
          synthNodes.forEach(n => logger.debug(`ℹ️ [合成信息] 「${n.name}」`));
          subProxies.unshift(...synthNodes);
        }

        if (sub.tag && urlSubs > 1) {
          hasInjectedTag = true;
        }

        if ((userConfig.passthrough || userConfig.preserveRawConfig) && subConfig && typeof subConfig === 'object') {
          for (const [k, v] of Object.entries(subConfig)) {
            if (k !== 'proxies' && configData[k] === undefined) {
              configData[k] = v;
            }
          }
        }

        configData.proxies = configData.proxies.concat(subProxies);

        const nodeCount = subProxies.length;
        subSummaries.push({
          type: sub.uri ? 'uri' : 'url',
          nameHint: sub.uri ? (subProxies[0] ? subProxies[0].name : '未知') : '',
          tag: sub.tag || effectiveTag,
          total: nodeCount,
          filtered: filteredCount,
          synth: synthNodes.length
        });
      } catch (e) {
        const subId = sub.uri ? 'direct-uri' : redactUrl(sub.url, showFullUrl);
        logger.error(`Error processing subscription ${subId}: ${e.message}`);

        let effectiveTag = sub.tag;
        if (!effectiveTag && sub.url && sub.url.startsWith('http')) {
          try { effectiveTag = new URL(sub.url).hostname; } catch (err) {}
        }
        if (!effectiveTag) effectiveTag = '订阅';

        if (enableDashboard) {
          const failNode = createFetchErrorNode(effectiveTag, e.message);
          configData.proxies.push(failNode);
        }

        let shortMsg = e.message || '抓取失败';
        if (/fetch failed/i.test(shortMsg)) shortMsg = '网络连接失败';
        else if (/timeout/i.test(shortMsg)) shortMsg = '拉取超时';
        else if (/HTTP Error: (\d+)/i.test(shortMsg)) shortMsg = `HTTP ${shortMsg.match(/HTTP Error: (\d+)/i)[1]}`;
        else if (/no nodes/i.test(shortMsg)) shortMsg = '未解析到有效节点';

        subSummaries.push({
          type: sub.uri ? 'uri' : 'url',
          nameHint: '',
          tag: effectiveTag,
          total: 0,
          failed: true,
          failReason: shortMsg
        });
      }
    }

    if (subSummaries.length > 0) {
      logger.log(`📡 订阅解析完成 (${subSummaries.length} 个源):`);
      subSummaries.forEach((s, idx) => {
        const isLast = idx === subSummaries.length - 1;
        const branch = isLast ? '└──' : '├──';
        if (s.disabled) {
          logger.log(`    ${branch} ⏸️ [${s.tag}]: 已停用 (跳过)`);
        } else if (s.failed) {
          logger.log(`    ${branch} ❌ [${s.tag}]: 拉取失败 (${s.failReason})`);
        } else {
          const icon = s.type === 'uri' ? '📌' : '🌐';
          const details = [];
          if (s.filtered > 0) details.push(`过滤 ${s.filtered}`);
          if (s.synth > 0) details.push(`合成 ${s.synth}`);
          const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
          const namePart = s.type === 'uri' ? `${s.nameHint}${s.tag ? ` [${s.tag}]` : ''}` : `[${s.tag}]`;
          logger.log(`    ${branch} ${icon} ${namePart}: ${s.total} 个节点${detailStr}`);
        }
      });
    }
  } else if (url) {
    // 2. 单 URL / URI 分支
    let rawResult;
    if (/^(vless|vmess|trojan|ss):\/\//i.test(url)) {
      logger.debug(`URI 节点: ${url.split('#').pop() || '未知'}`);
      rawResult = { content: url, subInfo: null };
    } else {
      rawResult = await fetchNodes(url, {
        showFullUrl, debug, logger,
        proxyUrl: resolveProxyUrl(userConfig),
        strategy: userConfig.fetchProxyStrategy,
        retry: fetchRetry,
        timeoutMs: fetchTimeoutSec * 1000
      });
    }
    recordSubInfo(rawResult.subInfo, '');
    configData = parseContent(rawResult.content);
    const nodeCount = configData.proxies ? configData.proxies.length : 0;
    logger.log(`📡 节点解析完成: ${nodeCount} 个节点`);
    if (enableDashboard) {
      const { nodes: synthNodes } = generateInfoNodes(rawResult.subInfo, '');
      if (synthNodes.length > 0 && configData.proxies) {
        configData.proxies.unshift(...synthNodes);
      }
    }
  } else {
    throw new Error('No URL or subscriptions provided.');
  }

  return {
    configData,
    collectedSubInfos,
    hasFailedSub,
    hasInjectedTag
  };
}

module.exports = {
  isSubEnabled,
  processSubscriptionSources
};
