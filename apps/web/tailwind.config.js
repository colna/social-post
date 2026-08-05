/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  // 关闭 preflight,避免 tailwind 的全局 reset 覆盖 antd v6 组件样式。
  // tailwind 只用于布局微调(flex/gap/spacing),组件视觉交给 antd。
  corePlugins: {
    preflight: false,
  },
  theme: { extend: {} },
  plugins: [],
};
