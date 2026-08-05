"""FastAPI 应用:路由 + Bearer 鉴权。"""

from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException, Path, status

from app.config import settings
from app.errors import FetchError, ParseError
from app.models import CrawlOptions, CrawlRequest, ProfileResult
from app.registry import get_crawler

app = FastAPI(title="social-post crawler", version="0.1.0")


async def require_token(authorization: str | None = Header(default=None)) -> None:
    """校验 Authorization: Bearer <CRAWLER_TOKEN>。"""
    expected = f"Bearer {settings.crawler_token}"
    if not authorization or authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少或无效的 Bearer token",
        )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/crawl/{platform}",
    response_model=ProfileResult,
    response_model_by_alias=True,
    dependencies=[Depends(require_token)],
)
async def crawl(
    body: CrawlRequest,
    platform: str = Path(..., description="平台标识,如 instagram"),
) -> ProfileResult:
    crawler = get_crawler(platform)
    if crawler is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"未知平台: {platform}",
        )

    opts = CrawlOptions(max_posts=body.max_posts)
    try:
        return await crawler.fetch_profile(body.handle, opts, body.cookie)
    except ParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"解析上游响应失败: {exc}",
        ) from exc
    except FetchError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"抓取上游失败: {exc}",
        ) from exc
