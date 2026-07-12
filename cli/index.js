#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { program } = require('commander');
const { operator } = require('../scripts/pure-nodes.js');
const { main: toolkitMain } = require('../scripts/mihomo-toolkit.js');

program
  .name('pure-runner')
  .description('Mihomo-Toolkit pure-nodes.js CLI runner')
  .version('1.0.0')
  .option('-u, --url <url>', 'Subscription URL or local config file path (optional if config has subscriptions)')
  .option('-o, --out <path>', 'Output file path', 'nodes.yaml')
  .option('-t, --type <type>', 'Script to run: "pure" (only pure-nodes), "full" (pure-nodes + mihomo-toolkit), or "toolkit" (only mihomo-toolkit)', 'pure')
  .option('-c, --config <path>', 'User config JSON file path (optional)')
  .option('-m, --meta <path>', 'Force object outputMode and save meta info to a JSON file (optional)')
  .parse(process.argv);

const options = program.opts();

async function fetchNodes(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    console.log(`[CLI] Downloading subscription from: ${url}`);
    const res = await fetch(url, {
      // 伪装成 Clash 客户端，否则大部分机场面板会默认下发 Base64 的 v2ray 节点链接而不是 YAML
      headers: { 'User-Agent': 'clash-verge/v1.3.8' }
    });
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    return await res.text();
  } else {
    // Local file
    console.log(`[CLI] Reading local file: ${url}`);
    return fs.readFileSync(path.resolve(process.cwd(), url), 'utf-8');
  }
}

function parseContent(content) {
  try {
    // Try parsing as YAML (Clash/Mihomo format)
    const data = yaml.parse(content);
    if (data && data.proxies && Array.isArray(data.proxies)) {
      return data;
    }
  } catch (e) {}

  // Fallback: try decoding Base64 (sometimes clash configs are base64 encoded)
  try {
    const decoded = Buffer.from(content.trim(), 'base64').toString('utf-8');
    const data = yaml.parse(decoded);
    if (data && data.proxies && Array.isArray(data.proxies)) {
      return data;
    }
  } catch (e) {}

  const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
  throw new Error("Failed to parse proxies from the content. It might not be a valid Clash YAML.\n[Preview of content]:\n" + preview);
}

async function main() {
  try {
    let userConfig = {};
    if (options.config) {
      const configPath = path.resolve(process.cwd(), options.config);
      const ext = path.extname(configPath).toLowerCase();
      const content = fs.readFileSync(configPath, 'utf-8');
      if (ext === '.yaml' || ext === '.yml') {
        userConfig = yaml.parse(content) || {};
      } else {
        userConfig = JSON.parse(content);
      }
      console.log(`[CLI] Loaded user config from ${options.config}`);
    }

    let configData = { proxies: [] };
    let hasInjectedTag = false;

    if (userConfig.subscriptions && Array.isArray(userConfig.subscriptions) && userConfig.subscriptions.length > 0) {
      console.log(`[CLI] Found ${userConfig.subscriptions.length} subscriptions in config.`);
      for (const sub of userConfig.subscriptions) {
        if (!sub.url) continue;
        try {
          const rawContent = await fetchNodes(sub.url);
          const subConfig = parseContent(rawContent);
          let subProxies = subConfig.proxies || [];
          
          if (sub.tag) {
            subProxies.forEach(p => {
              if (p.name) p.name = `[${sub.tag}] ${p.name}`;
            });
            hasInjectedTag = true;
            console.log(`[CLI] Injected tag [${sub.tag}] to ${subProxies.length} proxies from ${sub.url}`);
          }
          configData.proxies = configData.proxies.concat(subProxies);
        } catch (e) {
          console.error(`[CLI] Error processing subscription ${sub.url}: ${e.message}`);
        }
      }
    } else if (options.url) {
      const rawContent = await fetchNodes(options.url);
      configData = parseContent(rawContent);
    } else {
      throw new Error("You must provide either '-u <url>' or specify 'subscriptions' in the config file.");
    }

    console.log(`[CLI] Successfully loaded a total of ${configData.proxies.length} proxies.`);

    if (options.meta) {
      userConfig.outputMode = "object";
    }

    let pureUserConfig = { ...userConfig, ...(userConfig.pureConfig || {}) };
    let toolkitUserConfig = { ...userConfig, ...(userConfig.toolkitConfig || {}) };

    if (hasInjectedTag) {
      pureUserConfig.enableAirportTag = true;
    }

    // 在 full 模式下，清洗脚本已经洗过一次节点了，为了防止主脚本二次重命名导致混乱，
    // 我们默认给主脚本强制关闭节点重命名，除非用户在 toolkitConfig 中硬性指定。
    if (options.type === 'full' && typeof toolkitUserConfig.enableNodeRename === 'undefined') {
      toolkitUserConfig.enableNodeRename = false;
    }

    let finalProxies = configData.proxies;
    let result = null;

    if (options.type === 'pure' || options.type === 'full') {
      console.log(`[CLI] Running pure-nodes.js operator...`);
      result = await operator(configData.proxies, "clash", pureUserConfig);
      
      finalProxies = Array.isArray(result) ? result : result.proxies;
      console.log(`[CLI] pure-nodes.js processing complete. Outputting ${finalProxies.length} proxies.`);
      
      if (options.meta && !Array.isArray(result) && result.meta) {
        const metaPath = path.resolve(process.cwd(), options.meta);
        fs.writeFileSync(metaPath, JSON.stringify(result.meta, null, 2), 'utf-8');
        console.log(`[CLI] Saved meta object (buckets, stats, etc.) to ${metaPath}`);
        
        if (result.meta.stats) {
          console.log(`\n=== 📊 数据清洗统计 ===`);
          console.log(`总节点数: ${result.meta.stats.total} | 最终输出: ${result.meta.stats.outputCount}`);
          console.log(`去重剔除: ${result.meta.stats.dedupeCount} | 广告/无效: ${result.meta.stats.discardedCount}`);
          console.log(`未知地区: ${result.meta.stats.unknownCount} | 信息节点: ${result.meta.stats.infoCount}`);
          if (result.meta.stats.fissionCount > 0) console.log(`🧬 裂变增殖: 产生了 ${result.meta.stats.fissionCount} 个 IP 克隆节点`);
          console.log(`=======================\n`);
        }
      }
    }

    // Update config with the new proxies
    configData.proxies = finalProxies;
    let outputData = configData;
    
    if (options.type === 'full' || options.type === 'toolkit') {
      console.log(`[CLI] Running mihomo-toolkit.js to generate full profile...`);
      outputData = toolkitMain(outputData, toolkitUserConfig);
    }
    
    const yamlStr = yaml.stringify(outputData);
    
    const outPath = path.resolve(process.cwd(), options.out);
    fs.writeFileSync(outPath, yamlStr, 'utf-8');
    console.log(`[CLI] Saved result to ${outPath}`);

  } catch (err) {
    console.error(`[CLI] Error:`, err.message);
    process.exit(1);
  }
}

main();
