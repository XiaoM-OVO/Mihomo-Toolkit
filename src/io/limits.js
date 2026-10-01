/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 请求安全与资源限制校验
 * -----------------------------------------------------------------------------
 */

const DEFAULT_REQUEST_LIMITS = {
  maxSubscriptionUrls: 20,        // ?url= 参数最多允许的订阅数
  maxRemoteConfigBytes: 1048576,  // ?config= 远程配置文件最大字节数 (1MB)
  maxSubscriptionBytes: 8388608,  // 单个订阅响应体最大字节数 (8MB，流式截断防内存耗尽)
  maxTotalNodes: 5000,            // 单次构建允许的最大节点总数
  perSubscriptionMaxNodes: 3000   // 单个订阅最多允许的节点数
};

/**
 * 校验单次请求的资源限制，返回 null 表示通过，返回 Error 表示超限
 */
function validateRequestLimits({ subscriptionUrls, remoteConfigSize, totalNodes, perSubCounts, limits = {} }) {
  const merged = { ...DEFAULT_REQUEST_LIMITS, ...limits };
  if (subscriptionUrls && subscriptionUrls.length > merged.maxSubscriptionUrls) {
    return new Error(`Too many subscription URLs: ${subscriptionUrls.length} > ${merged.maxSubscriptionUrls}`);
  }
  if (remoteConfigSize && remoteConfigSize > merged.maxRemoteConfigBytes) {
    return new Error(`Remote config too large: ${remoteConfigSize} > ${merged.maxRemoteConfigBytes} bytes`);
  }
  if (totalNodes && totalNodes > merged.maxTotalNodes) {
    return new Error(`Too many total nodes: ${totalNodes} > ${merged.maxTotalNodes}`);
  }
  if (perSubCounts) {
    for (const [url, count] of Object.entries(perSubCounts)) {
      if (count > merged.perSubscriptionMaxNodes) {
        return new Error(`Subscription returned too many nodes: ${count} > ${merged.perSubscriptionMaxNodes}`);
      }
    }
  }
  return null;
}

module.exports = {
  DEFAULT_REQUEST_LIMITS,
  validateRequestLimits
};
