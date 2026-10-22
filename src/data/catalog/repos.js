/**
 * -----------------------------------------------------------------------------
 * Data: 出厂仓库与图标源前缀 (Catalog Repositories)
 * -----------------------------------------------------------------------------
 * 数值取自字段注册表，避免与用户可配置项的默认值形成第二真相源。
 */

'use strict';

const { FIELDS_BY_KEY } = require('../field-registry');

const DEFAULT_REPOS = {
  cdn: FIELDS_BY_KEY.ruleProviderCDN.default,
  geosite: FIELDS_BY_KEY.geositeRepo.default,
  geoip: FIELDS_BY_KEY.geoipRepo.default,
  icons: {
    orz: FIELDS_BY_KEY.iconRepoOrz.default,
    koolson: FIELDS_BY_KEY.iconRepoKoolson.default,
    lige47: FIELDS_BY_KEY.iconRepoLige47.default
  }
};

module.exports = { DEFAULT_REPOS };
