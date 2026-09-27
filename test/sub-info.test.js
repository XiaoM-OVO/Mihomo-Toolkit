const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('🎁 Sub-Store sub-info 操作脚本模块测试', () => {
  const scriptCode = fs.readFileSync(path.resolve(__dirname, '../substore/sub-info.js'), 'utf-8');

  function createSubInfoContext({
    proxies = [],
    args = {},
    subName = '默认机场',
    subUrl = '',
    customFlow = null,
    customFlowTransfer = null,
    customGetRemainingDays = null,
    subUserinfo = 'upload=10737418240; download=21474836480; total=107374182400; expire=1800000000',
    onWarn = () => {},
    onError = () => {}
  }) {
    const defaultFlow = {
      expires: 1800000000,
      total: 100 * 1024 * 1024 * 1024,
      usage: {
        upload: 10 * 1024 * 1024 * 1024,
        download: 20 * 1024 * 1024 * 1024
      }
    };
    const flowData = customFlow || defaultFlow;

    const sandbox = {
      $arguments: args,
      $substore: {
        error: onError,
        warn: onWarn,
        log: () => {}
      },
      flowUtils: {
        parseFlowHeaders: () => flowData,
        getFlowHeaders: async (url, ua, accept, proxy, flowUrl) => {
          return 'upload=10737418240; download=21474836480; total=107374182400; expire=1800000000';
        },
        flowTransfer: customFlowTransfer || ((n) => ({ value: (n / (1024 * 1024 * 1024)).toFixed(2), unit: 'GB' })),
        getRmainingDays: customGetRemainingDays || ((opts) => {
          if (opts && typeof opts.resetDay === 'number') {
            return 10;
          }
          return null;
        }),
        normalizeFlowHeader: (h) => ({ 'subscription-userinfo': typeof h === 'string' ? h : '' })
      },
      context: {
        source: {
          [subName]: {
            name: subName,
            url: subUrl,
            source: 'local',
            subUserinfo: subUserinfo
          }
        }
      },
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);
    return sandbox;
  }

  test('sub-info - 默认直接使用 Sub-Store 订阅名作为前缀，默认使用订阅名作为前缀', async () => {
    const proxies = [
      { name: '[AnyTLS] 香港 x2', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'MySub' },
      { name: '[AnyTLS] 日本 x1', type: 'ss', server: 'jp.node.com', port: 443, _subName: 'MySub' }
    ];

    const sandbox = createSubInfoContext({ proxies, subName: 'MySub' });
    const res = await sandbox.operator(proxies, 'clash', sandbox.context);

    const infoNode = res.find(p => p.name.includes('剩余流量'));
    assert.ok(infoNode);
    assert.ok(!infoNode.name.includes('[AnyTLS]'), '不应包含 [AnyTLS]');
    assert.ok(infoNode.name.includes('[MySub]'), '应包含订阅名 [MySub]');
    assert.equal(infoNode.isSyntheticInfo, true);
  });

  test('sub-info - 支持通过 URL 参数 infoPrefix 手动指定标签覆盖订阅名', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'MySub' },
      { name: '日本 02', type: 'ss', server: 'jp.node.com', port: 443, _subName: 'MySub' }
    ];

    const sandbox = createSubInfoContext({ proxies, args: { infoPrefix: '飞天云' }, subName: 'MySub' });
    const res = await sandbox.operator(proxies, 'clash', sandbox.context);

    const infoNode = res.find(p => p.name.includes('剩余流量'));
    assert.ok(infoNode);
    assert.ok(infoNode.name.includes('[飞天云]'), '应优先使用手动指定的 [飞天云]');
    assert.equal(infoNode.isSyntheticInfo, true);
  });

  test('sub-info - 当输入自带方括号时安全剥离，防止输出 [[Tag]] 重复嵌套', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: '[自带括号机场]' }
    ];

    const sandbox = createSubInfoContext({ proxies, subName: '[自带括号机场]' });
    const res = await sandbox.operator(proxies, 'clash', sandbox.context);

    const infoNode = res.find(p => p.name.includes('剩余流量'));
    assert.ok(infoNode);
    assert.ok(infoNode.name.includes('[自带括号机场]'), '应输出单层方括号');
    assert.ok(!infoNode.name.includes('[[自带括号机场]]'), '绝不应出现嵌套双重方括号');
  });

  test('sub-info - 支持从订阅 URL 片段（# 后）解析参数并生效', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'RawSub' }
    ];

    const sandbox = createSubInfoContext({
      proxies,
      subName: 'RawSub',
      subUrl: 'https://example.com/api/v1/client/subscribe?token=123#infoPrefix=URL覆盖机场&hideExpire=true'
    });
    const res = await sandbox.operator(proxies, 'clash', sandbox.context);

    const infoNode = res.find(p => p.name.includes('剩余流量'));
    assert.ok(infoNode);
    assert.ok(infoNode.name.includes('[URL覆盖机场]'), '应成功从 URL # 参数中解析出 infoPrefix');

    const expireNode = res.find(p => p.name.includes('到期'));
    assert.equal(expireNode, undefined, '设置了 hideExpire 时不应输出任何到期节点');
  });

  test('sub-info - 修复在节点清洗前成功自动提取机场自带的重置剩余天数（天数格式）', async () => {
    const proxies = [
      { name: '[机场名] 距离重置剩余：15 天', type: 'ss', server: '1.1.1.1', port: 80, _subName: 'MySub' },
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'MySub' }
    ];

    const sandbox = createSubInfoContext({ proxies, subName: 'MySub' });
    const res = await sandbox.operator(proxies, 'clash', sandbox.context);

    const rawResetNode = res.find(p => p.server === '1.1.1.1');
    assert.equal(rawResetNode, undefined, '原机场说明节点应已被过滤');

    const resetNode = res.find(p => p.name.includes('距离重置剩余'));
    assert.ok(resetNode, '应生成重置伪节点');
    assert.ok(resetNode.name.includes('15 天'), '应准确包含 15 天');
  });

  test('sub-info - 自动提取日期格式的重置节点（如“流量重置时间：YYYY-MM-DD”）', async () => {
    // 采用距当前整 5 天对齐的固定时间，精确断言剩余 5 天
    const DAY_MS = 86400000;
    const todayUtcMidnight = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const d = new Date(todayUtcMidnight + 5 * DAY_MS);
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

    const proxies = [
      { name: `[机场名] 流量重置时间：${dateStr}`, type: 'ss', server: '1.1.1.1', port: 80, subName: 'DateSub' },
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, subName: 'DateSub' }
    ];

    const sandbox = createSubInfoContext({ proxies, subName: 'DateSub' });
    const res = await sandbox.operator(proxies, 'clash', sandbox.context);

    const resetNode = res.find(p => p.name.includes('距离重置剩余'));
    assert.ok(resetNode, '应生成重置伪节点');
    assert.ok(resetNode.name.includes('5 天'), '固定自然日差下应精确断言为 5 天');
  });

  test('sub-info - 职责纯粹：仅清洗旧流量信息节点，不越界删除其他非信息类说明节点', async () => {
    const proxies = [
      { name: '香港-重置版高倍率-01', type: 'ss', server: 'hk1.node.com', port: 443, _subName: 'ValidSub' },
      { name: '日本-官网优化专线-02', type: 'ss', server: 'jp2.node.com', port: 443, _subName: 'ValidSub' },
      { name: '剩余流量：999 GB', type: 'ss', server: '1.1.1.1', port: 80, _subName: 'ValidSub' },
      { name: '套餐到期：2099-01-01', type: 'ss', server: '1.1.1.1', port: 80, _subName: 'ValidSub' }
    ];

    const sandbox = createSubInfoContext({ proxies, subName: 'ValidSub' });
    const res = await sandbox.operator(proxies, 'clash', sandbox.context);

    // 真实业务节点必须保留
    assert.ok(res.some(p => p.name === '香港-重置版高倍率-01'), '不应误杀“重置版高倍率”');
    assert.ok(res.some(p => p.name === '日本-官网优化专线-02'), '不应误杀“官网优化专线”');
    // 旧的机场信息节点必须被清理并由新伪节点替换
    assert.ok(!res.some(p => p.name === '剩余流量：999 GB'), '旧剩余流量节点必须被清洗');
    assert.ok(!res.some(p => p.name === '套餐到期：2099-01-01'), '旧套餐到期节点必须被清洗');
  });

  test('sub-info - 幂等性：当被多次执行时，根据 isSyntheticInfo 及自身输出正则防止节点重复堆叠', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'IdemSub' }
    ];

    // 模拟低流量状态（剩余低于 5GB），触发 🪫 流量告急
    const sandbox = createSubInfoContext({
      proxies,
      subName: 'IdemSub',
      subUserinfo: 'upload=106300440576; download=536870912; total=107374182400; expire=1800000000'
    });
    // 第一次执行
    const firstRun = await sandbox.operator(proxies, 'clash', sandbox.context);
    const countFirst = firstRun.filter(p => p.isSyntheticInfo).length;
    assert.ok(countFirst > 0);

    // 第二次执行（模拟链式操作或重入）
    const secondRun = await sandbox.operator(firstRun, 'clash', sandbox.context);
    const countSecond = secondRun.filter(p => p.isSyntheticInfo).length;
    assert.equal(countSecond, countFirst, '多次执行时不应堆叠伪信息节点');
  });

  test('sub-info - 当 cycleDays 指定但内置方法失败时，安全回退到 autoResetDays', async () => {
    const proxies = [
      { name: '[机场名] 距离重置剩余：8 天', type: 'ss', server: '1.1.1.1', port: 80, _subName: 'FallbackSub' },
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'FallbackSub' }
    ];

    const sandbox = createSubInfoContext({
      proxies,
      subName: 'FallbackSub',
      args: { cycleDays: 30 },
      customGetRemainingDays: () => null // 模拟 flowUtils 失败或返回 null
    });

    const res = await sandbox.operator(proxies, 'clash', sandbox.context);
    const resetNode = res.find(p => p.name.includes('距离重置剩余'));
    assert.ok(resetNode, '应成功兜底输出重置节点');
    assert.ok(resetNode.name.includes('8 天'), '应兜底使用 autoResetDays 提取的天数');
  });

  test('sub-info - 参数非法值校验并产生明确 warn 日志', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'WarnSub' }
    ];

    const warnings = [];
    const sandbox = createSubInfoContext({
      proxies,
      subName: 'WarnSub',
      args: { resetDay: 99, cycleDays: -5, startDate: '2025/13/40' },
      onWarn: (msg) => warnings.push(msg)
    });

    await sandbox.operator(proxies, 'clash', sandbox.context);
    assert.ok(warnings.some(w => w.includes('resetDay (99) 非法')), '应提示 resetDay 非法');
    assert.ok(warnings.some(w => w.includes('cycleDays (-5) 非法')), '应提示 cycleDays 非法');
    assert.ok(warnings.some(w => w.includes('startDate (2025/13/40) 格式不合规')), '应提示 startDate 不合规');
  });

  test('sub-info - noFlow 参数支持字符串 false 解析（避免 !noFlow 误伤）', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'NoFlowSub' }
    ];

    let fetchCalled = false;
    const sandbox = createSubInfoContext({
      proxies,
      subName: 'NoFlowSub',
      subUrl: 'https://example.com/api#noFlow=false'
    });

    sandbox.context.source.NoFlowSub.source = 'remote';
    sandbox.flowUtils.getFlowHeaders = async () => {
      fetchCalled = true;
      return 'upload=100; download=200; total=1000; expire=1800000000';
    };

    await sandbox.operator(proxies, 'clash', sandbox.context);
    assert.equal(fetchCalled, true, 'noFlow=false 字符串时不应跳过 fetch');
  });

  test('sub-info - 当未获取到 subInfo 时输出清晰的 warn 警告日志', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'EmptySub' }
    ];

    let warnMsg = '';
    const sandbox = createSubInfoContext({
      proxies,
      subName: 'EmptySub',
      subUserinfo: '',
      onWarn: (msg) => { warnMsg = msg; }
    });

    const res = await sandbox.operator(proxies, 'clash', sandbox.context);
    assert.ok(warnMsg.includes('未获取到 subscription-userinfo'), '应输出明确的 warn 提示');
    assert.equal(res.length, 1, '仅返回清洗后的原始节点');
  });

  test('sub-info - 已过期订阅输出醒目的失效提醒并阻止多余占位节点', async () => {
    const expiredTs = 1600000000;
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, subName: 'ExpiredSub' }
    ];

    const sandbox = createSubInfoContext({
      proxies,
      subName: 'ExpiredSub',
      subUserinfo: `upload=53687091200; download=53687091200; total=107374182400; expire=${expiredTs}`
    });

    const res = await sandbox.operator(proxies, 'clash', sandbox.context);
    const expiredNode = res.find(p => p.name.includes('🛑'));
    assert.ok(expiredNode, '应输出已失效停止节点');
    assert.ok(expiredNode.name.includes('已失效'), '节点名应包含失效天数说明');

    const flowNode = res.find(p => p.name.includes('流量'));
    assert.equal(flowNode, undefined, '过期时不应生成任何流量节点');
  });

  test('sub-info - 兼容 13 位毫秒级时间戳，防止年份计算溢出', async () => {
    const futureMs = 1800000000 * 1000;
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, subName: 'MsSub' }
    ];

    const sandbox = createSubInfoContext({
      proxies,
      subName: 'MsSub',
      subUserinfo: `upload=10737418240; download=21474836480; total=107374182400; expire=${futureMs}`
    });

    const res = await sandbox.operator(proxies, 'clash', sandbox.context);
    const expireNode = res.find(p => p.name.includes('套餐到期'));
    assert.ok(expireNode);
    assert.ok(expireNode.name.includes('2027-'), '应正确计算出 2027 年对应的日期');
  });

  test('sub-info - URL 中含有畸形编码时不抛出 URIError 崩溃', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, _subName: 'BadUrlSub' }
    ];

    const sandbox = createSubInfoContext({
      proxies,
      subName: 'BadUrlSub',
      subUrl: 'https://example.com/api#infoPrefix=%E0%A4%A&resetDay=15'
    });

    let res;
    await assert.doesNotReject(async () => {
      res = await sandbox.operator(proxies, 'clash', sandbox.context);
    });
    assert.ok(Array.isArray(res));
  });

  test('sub-info - 零依赖独立运行：无 flowUtils 时自动启用内置 parseSubscriptionUserinfo 解析', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, subName: 'StandaloneSub' }
    ];

    // 不提供 flowUtils 全局对象
    const sandbox = {
      $arguments: {},
      $substore: { warn: () => {}, error: () => {}, log: () => {} },
      context: {
        sourceName: 'StandaloneSub',
        source: {
          StandaloneSub: {
            name: 'StandaloneSub',
            subUserinfo: 'upload=10737418240; download=21474836480; total=107374182400; expire=1800000000'
          }
        }
      },
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);

    const res = await sandbox.operator(proxies, 'clash', sandbox.context);
    const flowNode = res.find(p => p.name.includes('剩余流量'));
    assert.ok(flowNode, '无 flowUtils 时应成功通过内置解析器生成剩余流量节点');
    assert.ok(flowNode.name.includes('StandaloneSub'), '应自动识别订阅名称作为标签');
    assert.equal(flowNode.isSyntheticInfo, true);
  });

  test('sub-info - 零依赖独立运行：无 flowUtils 时 startDate + cycleDays 独立周期算法生效', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, subName: 'CycleSub' }
    ];

    const sandbox = {
      $arguments: { startDate: '2025-01-01', cycleDays: 30 },
      $substore: { warn: () => {}, error: () => {}, log: () => {} },
      context: {
        sourceName: 'CycleSub',
        source: {
          CycleSub: {
            name: 'CycleSub',
            subUserinfo: 'upload=100; download=200; total=10000000000; expire=2000000000'
          }
        }
      },
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);

    const res = await sandbox.operator(proxies, 'clash', sandbox.context);
    const resetNode = res.find(p => p.name.includes('距离重置剩余'));
    assert.ok(resetNode, '无 flowUtils 时独立周期算法应成功计算出重置天数');
    assert.ok(/\d+\s*天/.test(resetNode.name), '应包含天数');
  });

  test('sub-info - 节点嗅探增强：支持“每月 X 号/日重置”格式自动识别', async () => {
    const proxies = [
      { name: '[每月 15 号重置] 香港 01', type: 'ss', server: '1.1.1.1', port: 80, _subName: 'MonthlySub' },
      { name: '香港 02', type: 'ss', server: 'hk2.node.com', port: 443, _subName: 'MonthlySub' }
    ];

    const sandbox = createSubInfoContext({ proxies, subName: 'MonthlySub' });
    const res = await sandbox.operator(proxies, 'clash', sandbox.context);

    const resetNode = res.find(p => p.name.includes('距离重置剩余'));
    assert.ok(resetNode, '应识别出“每月 15 号重置”并生成重置节点');
    assert.ok(/\d+\s*天/.test(resetNode.name));
  });

  test('sub-info - CommonJS 模块导出能力支持 (require)', () => {
    const subInfoModule = require('../substore/sub-info.js');
    assert.equal(typeof subInfoModule.operator, 'function', 'operator 应成功导出');
    assert.equal(typeof subInfoModule.parseSubscriptionUserinfo, 'function', 'parseSubscriptionUserinfo 应成功导出');

    const parsed = subInfoModule.parseSubscriptionUserinfo('upload=100; download=200; total=1000; expire=1800000000');
    assert.equal(parsed.total, 1000);
    assert.equal(parsed.usage.upload, 100);
    assert.equal(parsed.usage.download, 200);
    assert.equal(parsed.expires, 1800000000);
  });

  test('sub-info - 性能优化：优先复用 Sub-Store 结构化缓存，跳过重复网络请求', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, subName: 'CachedSub' }
    ];

    let networkRequested = false;
    const sandbox = createSubInfoContext({
      proxies,
      subName: 'CachedSub',
      subUrl: 'https://example.com/api/sub'
    });

    // 模拟 Sub-Store 内存中已有 userinfo 结构化缓存
    sandbox.context.source.CachedSub.userinfo = {
      total: 50 * 1024 * 1024 * 1024,
      upload: 5 * 1024 * 1024 * 1024,
      download: 10 * 1024 * 1024 * 1024,
      expire: 1850000000
    };

    sandbox.flowUtils.getFlowHeaders = async () => {
      networkRequested = true;
      return null;
    };

    const res = await sandbox.operator(proxies, 'clash', sandbox.context);
    const flowNode = res.find(p => p.name.includes('剩余流量'));
    assert.ok(flowNode, '应成功基于内存缓存生成节点');
    assert.equal(networkRequested, false, '命中现有缓存时不应触发网络请求');
  });

  test('sub-info - 官方特性对齐：支持 sub.subUserinfo 为自定义 HTTP 流量链接', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, subName: 'CustomUrlSub' }
    ];

    let customUrlRequested = false;
    const sandbox = createSubInfoContext({
      proxies,
      subName: 'CustomUrlSub',
      subUserinfo: 'https://flow.api.custom/userinfo'
    });

    sandbox.flowUtils.getFlowHeaders = async (url, ua, accept, proxy, flowUrl) => {
      if (flowUrl === 'https://flow.api.custom/userinfo') {
        customUrlRequested = true;
        // 提供 100GB 总量、20GB 已用的充足流量，确保走正常剩余流量节点
        return 'upload=10737418240; download=10737418240; total=107374182400; expire=1900000000';
      }
      return null;
    };

    const res = await sandbox.operator(proxies, 'clash', sandbox.context);
    const flowNode = res.find(p => p.name.includes('剩余流量'));
    assert.ok(flowNode, '应基于自定义流量链接生成剩余流量节点');
    assert.ok(flowNode.name.includes('🏷️'), '正常流量下必须带有 🏷️ 图标');
    assert.ok(flowNode.name.includes('80.00 GB'), '流量应精确格式化为 80.00 GB');
    assert.equal(customUrlRequested, true, '应成功向自定义流量链接发起请求');
  });

  test('sub-info - 官方特性对齐：支持 URL Hash 为 JSON 编码格式', async () => {
    const proxies = [
      { name: '香港 01', type: 'ss', server: 'hk.node.com', port: 443, subName: 'JsonHashSub' }
    ];

    const jsonConfig = { infoPrefix: 'JSON机场', hideExpire: true };
    const hash = encodeURIComponent(JSON.stringify(jsonConfig));

    const sandbox = createSubInfoContext({
      proxies,
      subName: 'JsonHashSub',
      subUrl: `https://example.com/api#${hash}`
    });

    const res = await sandbox.operator(proxies, 'clash', sandbox.context);
    const flowNode = res.find(p => p.name.includes('剩余流量'));
    assert.ok(flowNode);
    assert.ok(flowNode.name.includes('[JSON机场]'), '应成功解析 JSON Hash 中的 infoPrefix');

    const expireNode = res.find(p => p.name.includes('套餐到期'));
    assert.equal(expireNode, undefined, '应尊重 JSON Hash 中的 hideExpire');
  });
});
