/**
 * 六维服务注册表管理模块
 *
 * 维护 AI 助手、流媒体、社交、游戏平台、开发者工具及系统服务的基础规则元数据，支持用户自定义服务注入。
 */

/**
 * 根据用户配置动态创建并返回六维服务注册表
 * @param {object} userConfig
 * @returns {object} { ai, streaming, social, game, dev, system }
 */
function createServiceRegistries(userConfig = {}) {
  const iconOrz = userConfig.iconRepoOrz || '';
  const iconKoolson = userConfig.iconRepoKoolson || '';
  const iconLige47 = userConfig.iconRepoLige47 || '';
  const custom = userConfig.customServices || {};

  // 1. AI 助手服务注册表
  const ai = {
    chatgpt: {
      tag: 'chatgpt',
      name: '🤖 ChatGPT',
      uiIcon: '🤖',
      reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i,
      provider: 'geosite/openai',
      ruleSet: 'openai',
      iconUrl: `${iconOrz}OpenAI.png`,
      cleanName: 'ChatGPT'
    },
    gemini: {
      tag: 'gemini',
      name: '♊ Gemini',
      uiIcon: '♊',
      reg: /\bGemini\b/i,
      provider: 'geosite/google-gemini',
      ruleSet: 'gemini',
      iconUrl: `${iconKoolson}AI.png`,
      cleanName: 'Gemini'
    },
    claude: {
      tag: 'claude',
      name: '🦀 Claude',
      uiIcon: '🦀',
      reg: /\bClaude\b/i,
      provider: 'geosite/anthropic',
      ruleSet: 'claude',
      iconUrl: `${iconLige47}04ProxySoft/claude(1).png`,
      cleanName: 'Claude'
    },
    copilot: {
      tag: 'copilot',
      name: '🐙 Copilot',
      uiIcon: '🐙',
      reg: /\b(?:Copilot|Bing)\b/i,
      provider: 'geosite/bing',
      ruleSet: 'bing',
      iconUrl: `${iconKoolson}Copilot.png`,
      cleanName: 'Copilot'
    }
  };

  // 2. 流媒体服务注册表
  const streaming = {
    youtube:  { name: '▶️ YouTube', cleanName: 'YouTube', iconUrl: `${iconKoolson}YouTube.png`, provider: 'geosite/youtube', reg: /\b(?:YouTube|YT|油管)\b/i, pool: 'youtube' },
    netflix:  { name: '🎬 Netflix', cleanName: 'Netflix', iconUrl: `${iconKoolson}Netflix.png`, provider: 'geosite/netflix', reg: /\b(?:Netflix|NF|奈飞|网飞|耐飞)\b/i, pool: 'netflix' },
    disney:   { name: '🪄 Disney+', cleanName: 'Disney+', iconUrl: `${iconKoolson}Disney.png`,  provider: 'geosite/disney',  reg: /\b(?:Disney\+|Disney|迪士尼|D\+)\b/i, pool: 'disney' },
    tiktok:   { name: '🎵 TikTok',  cleanName: 'TikTok',  iconUrl: `${iconKoolson}TikTok.png`,  provider: 'geosite/tiktok',  reg: /\b(?:TikTok|抖音海外|TT)\b/i, pool: 'tiktok' },
    spotify:  { name: '🎧 Spotify', cleanName: 'Spotify', iconUrl: `${iconKoolson}Spotify.png`, provider: 'geosite/spotify', reg: /\b(?:Spotify|声田|声破天)\b/i, pool: 'spotify' },
    bahamut:  { name: '📺 Bahamut', cleanName: 'Bahamut', iconUrl: `${iconKoolson}Bahamut.png`, provider: 'geosite/bahamut' },
    pixiv:    { name: '🅿️ Pixiv',   cleanName: 'Pixiv',   iconUrl: `${iconLige47}04ProxySoft/pixiv.png`, provider: 'geosite/pixiv' },
    twitch:   { name: '🎮 Twitch',  cleanName: 'Twitch',  iconUrl: `${iconKoolson}Twitch.png`,  provider: 'geosite/twitch' },
    bilibili: { name: '📺 BiliBili',cleanName: 'BiliBili',iconUrl: `${iconOrz}Bili.png`,        provider: 'geosite/bilibili' }
  };

  // 3. 海外社交服务注册表
  const social = {
    twitter:   { name: '🐦 Twitter',   cleanName: 'Twitter',   iconUrl: `${iconKoolson}Twitter.png`,   provider: 'geosite/twitter' },
    facebook:  { name: '👥 Facebook',  cleanName: 'Facebook',  iconUrl: `${iconKoolson}Facebook.png`,  provider: 'geosite/facebook' },
    instagram: { name: '📸 Instagram', cleanName: 'Instagram', iconUrl: `${iconKoolson}Instagram.png`, provider: 'geosite/instagram' },
    discord:   { name: '🎮 Discord',   cleanName: 'Discord',   iconUrl: `${iconKoolson}Discord.png`,   provider: 'geosite/discord' },
    meta:      { name: '♾️ Meta',      cleanName: 'Meta',      iconUrl: `${iconKoolson}Meta.png`,      provider: 'geosite/facebook' }
  };

  // 4. 游戏服务注册表
  const game = {
    steam:       { provider: 'geosite/steam', rules: ['DOMAIN-SUFFIX,steamcontent.com,🎮 游戏下载', 'RULE-SET,steam-cn,🎮 游戏下载', 'RULE-SET,steam,🎮 游戏服务'] },
    'steam-cn':  { provider: 'geosite/steam@cn', rules: [] },
    epic:        { provider: 'geosite/epicgames', rules: ['DOMAIN-SUFFIX,download.epicgames.com,🎮 游戏下载', 'RULE-SET,epic,🎮 游戏服务', 'DOMAIN-SUFFIX,epicgames.com,🎮 游戏服务'] },
    riot:        { provider: 'geosite/riot', rules: ['RULE-SET,riot,🎮 游戏服务'] },
    blizzard:    { provider: 'geosite/blizzard', rules: ['RULE-SET,blizzard,🎮 游戏服务'] },
    nintendo:    { provider: 'geosite/nintendo', rules: ['RULE-SET,nintendo,🎮 游戏服务'] },
    playstation: { provider: 'geosite/playstation', rules: ['RULE-SET,playstation,🎮 游戏服务'] },
    xbox:        { provider: 'geosite/xbox', rules: ['RULE-SET,xbox,🎮 游戏服务'] },
    ubisoft:     { provider: 'geosite/ubisoft', rules: ['RULE-SET,ubisoft,🎮 游戏服务'] },
    origin:      { provider: 'geosite/origin', rules: ['RULE-SET,origin,🎮 游戏服务'] },
    ea:          { provider: 'geosite/ea', rules: ['RULE-SET,ea,🎮 游戏服务'] }
  };

  // 5. 开发者与学术注册表
  const dev = {
    github:  { name: '🐱 GitHub',   cleanName: 'GitHub',  iconUrl: `${iconKoolson}GitHub.png`,  provider: 'geosite/github' },
    scholar: { name: '🎓 学术网站', cleanName: 'Scholar', iconUrl: `${iconKoolson}Scholar.png`, provider: 'geosite/category-scholar-!cn' }
  };

  // 6. 系统基础服务注册表
  const system = {
    google:    { name: '🔍 Google',    cleanName: 'Google',    iconUrl: `${iconOrz}Google.png`,    provider: 'geosite/google',    rules: ['RULE-SET,google,🔍 Google'] },
    apple:     { name: '🍎 Apple',     cleanName: 'Apple',     iconUrl: `${iconOrz}Apple.png`,     provider: 'geosite/apple',     rules: ['RULE-SET,apple,🍎 Apple'] },
    microsoft: { name: '🪟 Microsoft', cleanName: 'Microsoft', iconUrl: `${iconOrz}Microsoft.png`, provider: 'geosite/microsoft', rules: ['RULE-SET,microsoft,🪟 Microsoft'] }
  };

  // 注入用户自定义服务
  if (custom.ai) Object.assign(ai, custom.ai);
  if (custom.streaming) Object.assign(streaming, custom.streaming);
  if (custom.social) Object.assign(social, custom.social);
  if (custom.game) Object.assign(game, custom.game);
  if (custom.system) Object.assign(system, custom.system);
  if (custom.dev) Object.assign(dev, custom.dev);

  return { ai, streaming, social, game, dev, system };
}

module.exports = {
  createServiceRegistries
};
