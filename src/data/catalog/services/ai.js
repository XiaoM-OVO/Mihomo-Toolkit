/**
 * -----------------------------------------------------------------------------
 * Data: 内置服务编目 · AI 助手 (ai)
 * -----------------------------------------------------------------------------
 * 单条服务声明即完整组声明，可被 groups[].ref 直接引用。
 */

'use strict';

module.exports = {
  ai: {
    chatgpt: {
      name: 'ChatGPT',
      emoji: '🤖',
      reg: /\b(?:GPT|ChatGPT|OpenAI)\b/i,
      rules: 'openai',
      type: 'select',
      match: { pool: 'chatgpt' },
      proxies: ['@residentialGroup', '@preferredRegions', '@matchedNodes', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'orz', file: 'OpenAI.png' }
    },
    gemini: {
      name: 'Gemini',
      emoji: '♊',
      reg: /\bGemini\b/i,
      rules: { name: 'gemini', path: 'google-gemini' },
      type: 'select',
      match: { pool: 'gemini' },
      proxies: ['@residentialGroup', '@preferredRegions', '@matchedNodes', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'koolson', file: 'AI.png' }
    },
    claude: {
      name: 'Claude',
      emoji: '🦀',
      reg: /\bClaude\b/i,
      rules: { name: 'claude', path: 'anthropic' },
      type: 'select',
      match: { pool: 'claude' },
      proxies: ['@residentialGroup', '@preferredRegions', '@matchedNodes', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'lige47', file: '04ProxySoft/claude(1).png' }
    },
    copilot: {
      name: 'Copilot',
      emoji: '🐙',
      reg: /\b(?:Copilot|Bing)\b/i,
      rules: { name: 'bing', path: 'bing' },
      type: 'select',
      match: { pool: 'copilot' },
      proxies: ['@residentialGroup', '@preferredRegions', '@matchedNodes', '@defaultProxy', 'DIRECT'],
      icon: { repo: 'koolson', file: 'Copilot.png' }
    }
  },
};
