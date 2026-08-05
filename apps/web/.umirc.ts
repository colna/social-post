import { defineConfig } from 'umi';

export default defineConfig({
  npmClient: 'pnpm',
  // 修复 esbuild minifier helper 命名冲突(umi 已知问题)
  esbuildMinifyIIFE: true,
  plugins: ['@umijs/plugins/dist/tailwindcss'],
  tailwindcss: {},
  routes: [
    {
      path: '/',
      component: '@/layouts/index',
      routes: [{ path: '/', component: '@/pages/index' }],
    },
  ],
  // 前端访问的后端地址,构建时注入(UMI_APP_ 前缀会暴露到浏览器)
  // 默认 '/api':本地走下方 proxy(免 CORS),生产用 UMI_APP_API_BASE 指向后端全地址
  define: {
    'process.env.UMI_APP_API_BASE': process.env.UMI_APP_API_BASE || '/api',
  },
  // 本地开发跨域代理:/api → 后端
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
  },
});
