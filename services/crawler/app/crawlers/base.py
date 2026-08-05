"""平台爬虫协议:每个平台实现一个 PlatformCrawler。"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.models import CrawlOptions, ProfileResult


@runtime_checkable
class PlatformCrawler(Protocol):
    """可插拔平台爬虫接口。"""

    key: str

    async def fetch_profile(
        self,
        handle: str,
        opts: CrawlOptions,
        cookie: str | None,
    ) -> ProfileResult:
        """抓取并解析某账户主页,返回统一结构。"""
        ...
