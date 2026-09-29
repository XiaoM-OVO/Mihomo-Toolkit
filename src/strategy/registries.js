/**
 * 六维服务注册表管理模块 (向前兼容适配器)
 *
 * 委托至 config/catalog 统一编目事实来源，维护 AI 助手、流媒体、社交、游戏平台、开发者工具及系统服务。
 */

const { buildServiceCatalog } = require('../config/catalog');

/**
 * 根据用户配置动态创建并返回六维服务注册表
 * @param {object} userConfig
 * @returns {object} { ai, streaming, social, game, dev, system }
 */
function createServiceRegistries(userConfig = {}) {
  const catalog = userConfig.catalog || buildServiceCatalog(userConfig);
  return catalog.toLegacyRegistries();
}

module.exports = {
  createServiceRegistries
};
