'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createEnvelope,
  getEnvelopes,
  clearEnvelopes,
  resetEnvelopeStore,
  createEnvelopesBypass
} = require('../../src/pipeline/envelope');
const { runNodesPipeline } = require('../../src/pipeline/nodes');

describe('【Pipeline】节点只读 Envelope 包装与旁路接入 (envelope)', () => {
  it('rawName 原值完整保留，normalizedRawName 单独 trim', () => {
    const rawWithSpaces = '\t  🇭🇰 香港 01 x1.0  \n ';
    const proxy = {
      name: rawWithSpaces,
      server: '1.2.3.4',
      port: 443,
      type: 'vless',
      uuid: 'u1'
    };

    const env = createEnvelope(proxy, 0);
    assert.ok(env);
    assert.equal(env.rawName, rawWithSpaces, 'rawName 必须保留原始字符串，绝不提前 trim');
    assert.equal(env.normalizedRawName, '🇭🇰 香港 01 x1.0', 'normalizedRawName 应安全 trim');
    assert.equal(env.rawProxy, proxy, 'rawProxy 必须持有原对象引用');
  });

  it('创建 Envelope 绝不增删改原 proxy 的任何属性与值', () => {
    const originalProxy = {
      name: '🇭🇰 香港 01',
      server: '1.2.3.4',
      port: 443,
      type: 'ss',
      cipher: 'aes-128-gcm',
      password: 'pwd',
      customField: 'hello'
    };

    const keysBefore = Object.keys(originalProxy);
    const snapshotBefore = JSON.stringify(originalProxy);

    const env = createEnvelope(originalProxy, 3);
    assert.ok(env);

    const keysAfter = Object.keys(originalProxy);
    const snapshotAfter = JSON.stringify(originalProxy);

    assert.deepEqual(keysAfter, keysBefore, '原 proxy 的属性键集合不得改变');
    assert.equal(snapshotAfter, snapshotBefore, '原 proxy 的内容不得被原地修改');
  });

  it('传入可变 metadata 时深拷贝并递归冻结副本，绝不改动或冻结调用方原对象', () => {
    const proxy = { name: '🇭🇰 香港 01', server: '1.2.3.4', port: 443 };
    const callerMeta = {
      groupKey: 'hk',
      regionName: '香港',
      countryCode: 'HK',
      city: null,
      lines: ['IEPL'],
      rawMatchedLines: ['IEPL'],
      cleanLines: 'IEPL',
      features: ['residential'],
      multiplier: { value: 1, hasExplicit: false },
      status: 'complete',
      extra: {
        values: ['item1', 'item2'],
        config: { enabled: true }
      }
    };

    const env = createEnvelope(proxy, 0, callerMeta);
    assert.ok(env);

    // 1. Envelope 内部副本必须完全深度冻结（包含任意层级的嵌套对象与数组）
    assert.ok(Object.isFrozen(env.metadata), 'env.metadata 必须被冻结');
    assert.ok(Object.isFrozen(env.metadata.lines), 'env.metadata.lines 必须被冻结');
    assert.ok(Object.isFrozen(env.metadata.features), 'env.metadata.features 必须被冻结');
    assert.ok(Object.isFrozen(env.metadata.multiplier), 'env.metadata.multiplier 必须被冻结');
    assert.ok(Object.isFrozen(env.metadata.extra), 'env.metadata.extra 必须被冻结');
    assert.ok(Object.isFrozen(env.metadata.extra.values), 'env.metadata.extra.values 必须被冻结');
    assert.ok(Object.isFrozen(env.metadata.extra.config), 'env.metadata.extra.config 必须被冻结');

    // 尝试篡改深层嵌套属性必须抛出 TypeError
    assert.throws(() => {
      env.metadata.extra.values.push('item3');
    }, TypeError);

    assert.throws(() => {
      env.metadata.extra.config.enabled = false;
    }, TypeError);

    // 2. 调用方自己的原对象与嵌套结构绝不得被意外冻结
    assert.equal(Object.isFrozen(callerMeta), false, '调用方 metadata 原对象不得被冻结');
    assert.equal(Object.isFrozen(callerMeta.extra), false, '调用方 extra 子对象不得被冻结');
    assert.equal(Object.isFrozen(callerMeta.extra.values), false, '调用方 extra.values 数组不得被冻结');

    // 3. 调用方后续修改原对象不会影响已生成的 Envelope 副本
    callerMeta.extra.values.push('mutated');
    assert.equal(callerMeta.extra.values.length, 3);
    assert.equal(env.metadata.extra.values.length, 2, '调用方原对象的修改不得穿透到 Envelope 副本');

    // 4. 循环引用对象也能安全深拷贝和深冻结而不发生调用栈溢出
    const circularMeta = { tag: 'circular' };
    circularMeta.self = circularMeta;
    const circularEnv = createEnvelope(proxy, 1, circularMeta);
    assert.ok(circularEnv);
    assert.ok(Object.isFrozen(circularEnv.metadata));
    assert.equal(circularEnv.metadata.self, circularEnv.metadata);
  });

  it('冻结、sealed 对象和重复对象引用都可安全处理', () => {
    // 1. 冻结对象
    const frozenProxy = Object.freeze({
      name: '🇯🇵 日本 01',
      server: '2.3.4.5',
      port: 443,
      type: 'trojan',
      password: 'pwd'
    });

    const envFrozen = createEnvelope(frozenProxy, 0);
    assert.ok(envFrozen, '冻结对象必须能正常创建 Envelope');
    assert.equal(envFrozen.rawProxy, frozenProxy);

    // 2. Sealed 对象
    const sealedProxy = Object.seal({
      name: '🇺🇸 美国 01',
      server: '3.4.5.6',
      port: 443,
      type: 'vless',
      uuid: 'u2'
    });

    const envSealed = createEnvelope(sealedProxy, 1);
    assert.ok(envSealed, 'Sealed 对象必须能正常创建 Envelope');

    // 3. 重复对象引用（同一对象在数组中多次出现）
    const sharedProxy = {
      name: '🇸🇬 新加坡 01',
      server: '4.5.6.7',
      port: 443,
      type: 'ss',
      cipher: 'aes-128-gcm',
      password: 'pwd'
    };

    const envFirst = createEnvelope(sharedProxy, 5);
    const envSecond = createEnvelope(sharedProxy, 10);

    assert.notEqual(envFirst, envSecond, '两次创建应生成独立的 Envelope 记录');
    assert.equal(envFirst.identity.globalInputIndex, 5);
    assert.equal(envSecond.identity.globalInputIndex, 10);

    const lookupList = getEnvelopes(sharedProxy);
    assert.equal(lookupList.length, 2, 'WeakMap 反查必须完整保留历史记录，不得静默覆盖');
    assert.equal(lookupList[0].identity.globalInputIndex, 5);
    assert.equal(lookupList[1].identity.globalInputIndex, 10);
  });

  it('批次生命周期管理：新批次重置已存在 proxy 历史，且同批次内重复引用正常保留', () => {
    const proxyA = { name: '香港 01', server: '1.1.1.1', port: 80 };
    const proxyB = { name: '日本 01', server: '2.2.2.2', port: 80 };

    // 批次 1：包含 proxyA 两次重复引用与 proxyB 一次引用
    createEnvelopesBypass([proxyA, proxyB, proxyA]);
    const listA_batch1 = getEnvelopes(proxyA);
    const listB_batch1 = getEnvelopes(proxyB);

    assert.equal(listA_batch1.length, 2, '批次 1 内重复出现两次应记录 2 条 Envelope');
    assert.equal(listA_batch1[0].identity.globalInputIndex, 0);
    assert.equal(listA_batch1[1].identity.globalInputIndex, 2);
    assert.equal(listB_batch1.length, 1);

    // 批次 2：长期驻留的 proxyA 再次运行一次
    createEnvelopesBypass([proxyA]);
    const listA_batch2 = getEnvelopes(proxyA);
    assert.equal(listA_batch2.length, 1, '新批次应重置历史累计，列表不得无界膨胀');
    assert.equal(listA_batch2[0].identity.globalInputIndex, 0);

    // 显式清理接口测试
    clearEnvelopes(proxyA);
    assert.deepEqual(getEnvelopes(proxyA), []);

    resetEnvelopeStore();
    assert.deepEqual(getEnvelopes(proxyB), []);
  });

  it('globalInputIndex 按输入位置稳定生成且 Envelope 深度冻结', () => {
    const p1 = { name: 'Node 1', server: '1.1.1.1', port: 80 };
    const p2 = { name: 'Node 2', server: '2.2.2.2', port: 80 };

    const env1 = createEnvelope(p1, 0);
    const env2 = createEnvelope(p2, 1);

    assert.equal(env1.identity.globalInputIndex, 0);
    assert.equal(env2.identity.globalInputIndex, 1);

    assert.ok(Object.isFrozen(env1));
    assert.ok(Object.isFrozen(env1.identity));
    assert.ok(Object.isFrozen(env1.metadata));

    // 尝试写入被拦截
    assert.throws(() => {
      env1.metadata = null;
    }, TypeError);

    assert.throws(() => {
      env1.identity.globalInputIndex = 999;
    }, TypeError);
  });

  it('非法输入防御：null、数组、非对象安全返回且不抛出 WeakMap 异常', () => {
    assert.equal(createEnvelope(null, 0), null);
    assert.equal(createEnvelope(undefined, 0), null);
    assert.equal(createEnvelope('string', 0), null);
    assert.equal(createEnvelope(12345, 0), null);
    assert.equal(createEnvelope([], 0), null);

    assert.deepEqual(getEnvelopes(null), []);
    assert.deepEqual(getEnvelopes(undefined), []);
    assert.deepEqual(getEnvelopes('string'), []);
    assert.deepEqual(getEnvelopes([]), []);
  });

  it('synthetic 标志只被观察，不作为新的可信授权条件', () => {
    const syntheticProxy = {
      name: '📊 订阅剩余流量',
      server: '127.0.0.1',
      port: 80,
      type: 'vless',
      uuid: 'dummy',
      isSyntheticInfo: true
    };

    const env = createEnvelope(syntheticProxy, 0);
    assert.equal(env.isSyntheticInfo, true, 'isSyntheticInfo 应被忠实观察');

    const normalProxy = {
      name: '🇭🇰 香港 01',
      server: '1.2.3.4',
      port: 443,
      type: 'vless',
      uuid: 'dummy'
    };

    const envNormal = createEnvelope(normalProxy, 1);
    assert.equal(envNormal.isSyntheticInfo, false);
  });

  it('单节点旁路异常与非法输入批次不会中断旧流水线', async () => {
    let nameCallCount = 0;
    const transientThrowingProxy = {
      get name() {
        nameCallCount++;
        // 仅在旁路提取阶段 (第1次被访问) 模拟抛出异常
        if (nameCallCount === 1) {
          throw new Error('旁路提取阶段模拟抛错');
        }
        // 后续旧流水线访问时返回合法的节点名称
        return '🇭🇰 香港 02';
      },
      server: '1.2.3.5',
      port: 443,
      type: 'vless',
      uuid: 'u2'
    };

    const normalProxy = {
      name: '🇭🇰 香港 01',
      server: '1.2.3.4',
      port: 443,
      type: 'vless',
      uuid: 'u1'
    };

    // 1. 单元级 createEnvelopesBypass 隔离验证：单节点异常记录并跳过，不中断其他节点
    const unconditionalThrowing = {};
    Object.defineProperty(unconditionalThrowing, 'name', {
      get() {
        throw new Error('无条件崩溃');
      }
    });

    const batchResult = createEnvelopesBypass([unconditionalThrowing, null, normalProxy]);
    assert.equal(batchResult.bypassErrors, 2, '两个异常/非法节点应被计入 bypassErrors');
    assert.equal(batchResult.envelopes.length, 1, '正常节点依然成功生成 Envelope');
    assert.equal(batchResult.envelopes[0].rawProxy, normalProxy);

    // 2. 集成级验证：即使有节点在旁路步骤抛错、输入数组含 null/undefined，runNodesPipeline 依然平稳运行
    const input = [
      null,
      transientThrowingProxy,
      undefined,
      normalProxy
    ];

    const output = await runNodesPipeline(input, { enableDedupe: false, enableNodeRename: false });
    assert.ok(Array.isArray(output));
    assert.equal(output.length, 2, '两个合法节点均成功进入旧流水线并产出');
    assert.ok(output.some(p => p.server === '1.2.3.4'));
    assert.ok(output.some(p => p.server === '1.2.3.5'));
  });
});
