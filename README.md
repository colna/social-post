# social-post

可扩展的**社媒帖子采集平台**:输入「平台 + 账户」,自动抓取该账户的帖子(封面图 + 完整文案),统一展示在表格中。首期实现 **Instagram**。

## 架构

| 端 | 技术 | 部署 |
|----|------|------|
| `apps/web` | umi + tailwind + antd v6 | Vercel |
| `apps/server` | NestJS + Prisma | Vercel(Serverless)|
| `services/crawler` | FastAPI + Scrapling(Python)| Railway/Render(容器)|
| DB | Neon / Vercel Postgres | — |

数据流:`web → server(编排/落库)→ crawler(Scrapling 抓 IG web_profile_info)`。详见 [`docs/02-技术文档.md`](docs/02-技术文档.md)。

## 文档

- [需求 PRD](docs/01-PRD.md)
- [技术文档](docs/02-技术文档.md)
- [任务拆解](docs/03-任务拆解.md)
- [任务进度](docs/04-任务进度.md)

## 本地启动

```bash
cp .env.example .env   # 填 DATABASE_URL / IG_COOKIE / CRAWLER_TOKEN
pnpm install

# 1. 爬虫服务(Python)
cd services/crawler && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. 后端(Neon 已配好 DATABASE_URL)
pnpm --filter server prisma migrate deploy
pnpm server:dev

# 3. 前端
pnpm web:dev
```

## 部署

见 [`docs/05-部署.md`](docs/05-部署.md):web + server 上 Vercel(各自 `vercel.json`,Root Directory 分别设 `apps/web` / `apps/server`),crawler 上 Railway/Render(Dockerfile / `render.yaml`),DB 用 Neon。

## 环境变量

见 [`.env.example`](.env.example)。核心:`DATABASE_URL`(Neon)、`IG_COOKIE`(运营 IG 登录 cookie)、`CRAWLER_TOKEN`(server↔crawler 共享密钥)、`UMI_APP_API_BASE`。
