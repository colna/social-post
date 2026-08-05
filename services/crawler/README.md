# social-post crawler service

FastAPI 微服务,用 [Scrapling](https://github.com/D4Vinci/Scrapling) 抓取社交平台公开主页,
返回统一结构(账户画像 + 帖子列表,含封面图与完整文案)。当前实现 Instagram,平台可插拔。

## 架构

```
HTTP  ──►  main.py (路由 + Bearer 鉴权)
            └► registry.get_crawler(platform)
                 └► crawlers/instagram.py  构造 URL/headers
                      ├► fetcher.fetch_json   (scrapling 薄封装,延迟 import)
                      └► parsers/instagram.py (纯函数解析 → ProfileResult)
```

- `fetcher.py` 是唯一接触网络与 scrapling 的地方,scrapling **延迟 import**:
  未安装 scrapling 时仍可 import app、跑 parser/API 测试(测试用 monkeypatch 替换 `fetch_json`)。
- 内部字段 snake_case;HTTP 响应输出 camelCase(`displayName`、`coverUrl`、`likeCount` 等)。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `CRAWLER_TOKEN` | `change-me-shared-secret` | 调用方 Bearer token,生产必须覆盖 |
| `IG_COOKIE` | `` | Instagram 登录态 Cookie;可被单次请求 body 的 `cookie` 覆盖 |
| `SCRAPLING_MODE` | `fetch` | `fetch`=普通 Fetcher;`stealth`=StealthyFetcher(反爬) |

参考仓库根 `.env.example`。不要把真实 Cookie / token 提交进仓库。

## 本地运行

```bash
cd services/crawler
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 接口

- `GET /health` → `{"status":"ok"}`(无需鉴权)
- `POST /crawl/{platform}` — Header `Authorization: Bearer <CRAWLER_TOKEN>`

```bash
curl -s -X POST http://localhost:8000/crawl/instagram \
  -H "Authorization: Bearer change-me-shared-secret" \
  -H "Content-Type: application/json" \
  -d '{"handle":"instagram","maxPosts":30,"cookie":null}'
```

返回(camelCase 摘要):

```json
{
  "account": { "handle": "...", "displayName": "...", "followerCount": 0, "externalId": "..." },
  "posts": [ { "shortcode": "...", "url": "...", "type": "image", "coverUrl": "...",
               "caption": "...", "likeCount": 0, "commentCount": 0, "takenAt": "..." } ],
  "fetchedAt": "2026-08-05T00:00:00Z"
}
```

未知平台 → 404;token 错误 → 401;上游抓取/解析失败 → 502。

## 测试

parser 与 API 测试完全离线(fixture JSON + monkeypatch),**不需要安装 scrapling、不触网**:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt          # 不含 scrapling
python -m pytest -q
```

> Python <3.11 上 pydantic v2 无法原生 eval `X | None` 联合语法,`requirements-dev.txt`
> 已带 `eval_type_backport`(3.11+ 无需,部署镜像用 3.11)。

## Docker

```bash
docker build -t social-post-crawler .
docker run -p 8000:8000 \
  -e CRAWLER_TOKEN=your-secret \
  -e IG_COOKIE='sessionid=...; ds_user_id=...' \
  social-post-crawler
```

`fetch` 模式无需浏览器。若用 `SCRAPLING_MODE=stealth`(StealthyFetcher),需在镜像内预装
Playwright/camoufox 浏览器,见 Dockerfile 中注释掉的 `playwright install` 行。

## 部署(Railway / Render)

- **Start command**:`uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  (平台通过 `$PORT` 注入端口,Dockerfile 里的 8000 仅本地默认。)
- **环境变量**:在平台面板配置 `CRAWLER_TOKEN`、`IG_COOKIE`、`SCRAPLING_MODE`。
- **Railway**:识别 Dockerfile 直接构建;或用 Nixpacks + `requirements.txt`。
- **Render**:选 "Docker" 类型,Health Check Path 设为 `/health`。
- stealth 模式在容器里跑无头浏览器,内存建议 ≥1GB。

## 扩展新平台

1. 在 `app/crawlers/<platform>.py` 实现 `PlatformCrawler`(`key` + `async fetch_profile`)。
2. 在 `app/parsers/<platform>.py` 写纯函数解析器,输出 `ProfileResult`。
3. 在 `app/registry.py` 的 `CRAWLERS` 注册实例。
