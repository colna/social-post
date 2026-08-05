import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import express, { type Request, type Response } from 'express';
import { AppModule } from './app.module';

// Serverless 处理器:复用同一个 Nest 实例(冷启动只 bootstrap 一次)。
// 由 nest build(tsc)编译到 dist/src/bootstrap.js,保留 NestJS DI 所需的
// decorator metadata;Vercel 函数入口 api/index.js 直接 require 这份编译产物。
const server = express();
let ready: Promise<void> | null = null;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
}

export default async function handler(req: Request, res: Response) {
  if (!ready) ready = bootstrap();
  await ready;
  server(req, res);
}
