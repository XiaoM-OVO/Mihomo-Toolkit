/**
 * -----------------------------------------------------------------------------
 * Data: 内置服务编目 · 系统基础服务 (system)
 * -----------------------------------------------------------------------------
 * 单条服务声明即完整组声明，可被 groups[].ref 直接引用。
 */

'use strict';

module.exports = {
  system: {
    microsoft: {
      name: 'Microsoft',
      emoji: '🪟',
      rules: 'microsoft',
      type: 'select',
      proxies: ['DIRECT', '@standardOptions'],
      icon: { repo: 'orz', file: 'Microsoft.png' }
    },
    apple: {
      name: 'Apple',
      emoji: '🍎',
      rules: 'apple',
      type: 'select',
      proxies: ['DIRECT', '@standardOptions'],
      icon: { repo: 'orz', file: 'Apple.png' }
    },
    google: {
      name: 'Google',
      emoji: '🔍',
      rules: 'google',
      type: 'select',
      proxies: ['@standardOptions', 'DIRECT'],
      icon: { repo: 'orz', file: 'Google.png' }
    }
  }
};
