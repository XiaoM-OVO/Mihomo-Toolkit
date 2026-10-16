module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        ReadableStream: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        structuredClone: 'readonly',
        performance: 'readonly',
      },
    },
    rules: {
      // —— 死代码与无用声明 ——
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-unused-private-class-members': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }], // 允许明确带 return/break 的无限循环

      // —— 正确性缺陷（可捕获真实错误的静态规则）——
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'no-self-assign': ['error', { props: true }],
      'no-self-compare': 'error',
      'no-return-assign': ['error', 'always'],
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'array-callback-return': 'error',
      'no-async-promise-executor': 'error',
      'no-loop-func': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-shadow-restricted-names': 'error',
      'no-template-curly-in-string': 'warn',
      'no-throw-literal': 'warn',
      'no-shadow': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-promise-executor-return': 'error',
      'no-unmodified-loop-condition': 'error',
      'consistent-return': 'warn',

      // —— 风格与可读性 ——
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }], // 允许显式容错与安全兜底的空 catch
      'no-console': 'off', // 允许核心日志与终端输出
    },
  },
  {
    files: ['test/**/*.js'],
    rules: {
      // 测试中的轮询退避惯用法与 mock 计数自增不在静态可见范围内，会产生误报
      'no-promise-executor-return': 'off',
      'no-unmodified-loop-condition': 'off',
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', '*.min.js'],
  },
];
