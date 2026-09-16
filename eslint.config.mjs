import nextConfig from 'eslint-config-next';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Next 16 的 eslint-config-next 原生导出 flat config 数组，
 * 不再需要 @eslint/eslintrc 的 FlatCompat 包装。
 */
const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      '.sources/**',
      '.candidates/**',
      'content/**',
      'docs/**',
      'next-env.d.ts',
    ],
  },
  ...nextConfig,
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default eslintConfig;
