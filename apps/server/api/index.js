// Vercel Serverless 函数入口(纯 JS 薄壳)。
// 委托给 tsc 编译产物 dist/src/bootstrap.js —— 用 nest build(TypeScript 编译器)
// 保证 NestJS 构造函数注入所需的 decorator metadata,避免 esbuild 编译丢元数据导致 DI 崩溃。
module.exports = require('../dist/bootstrap').default;
