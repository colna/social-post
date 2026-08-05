const tsparser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: [
      'src/.umi/**',
      'src/.umi-production/**',
      'dist/**',
      'node_modules/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
