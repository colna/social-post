import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 本机 shell 全局 NODE_ENV=production 会让 React 加载 production 构建(act 不可用),
    // 测试里强制切回 test。
    env: { NODE_ENV: 'test' },
  },
});
