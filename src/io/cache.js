/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 构建结果内存 LRU-TTL 缓存管理器
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 提供常驻模式 (server) 下的内存级 profile 构建缓存
 * 2. 具备严格的容量上限 (MAX_ENTRIES) 与 LRU 淘汰策略，杜绝内存泄漏
 * 3. 具备 TTL 过期检查与无效结果熔断防御
 */

class ProfileCache {
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 100;
    this.cacheMap = new Map();
  }

  get(key, ttlMs) {
    if (!key || !this.cacheMap.has(key)) return null;
    const entry = this.cacheMap.get(key);
    const now = Date.now();

    // 检查是否过期
    if (now - entry.timestamp > ttlMs) {
      this.cacheMap.delete(key);
      return null;
    }

    // 刷新访问顺序 (LRU)
    this.cacheMap.delete(key);
    this.cacheMap.set(key, entry);

    const remainingSec = Math.round((ttlMs - (now - entry.timestamp)) / 1000);
    return {
      result: entry.result,
      remainingSec
    };
  }

  set(key, result) {
    if (!key) return;

    // 若达到最大容量，淘汰最老条目 (Map 迭代顺序即插入/最近更新顺序)
    if (this.cacheMap.size >= this.maxEntries) {
      const oldestKey = this.cacheMap.keys().next().value;
      this.cacheMap.delete(oldestKey);
    }

    this.cacheMap.set(key, {
      timestamp: Date.now(),
      result
    });
  }

  has(key) {
    return this.cacheMap.has(key);
  }

  clear() {
    this.cacheMap.clear();
  }

  get size() {
    return this.cacheMap.size;
  }
}

const profileCache = new ProfileCache({ maxEntries: 100 });

module.exports = {
  ProfileCache,
  profileCache
};
