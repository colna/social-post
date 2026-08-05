import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import express, { type Request, type Response } from 'express';
import { AppModule } from '../src/app.module';

// Vercel Serverless 入口:复用同一个 Nest 实例(冷启动只 bootstrap 一次)。
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
