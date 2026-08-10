"""平台爬虫注册表。新增平台只需在此登记。"""

from __future__ import annotations

from app.crawlers.base import PlatformCrawler
from app.crawlers.facebook import FacebookCrawler
from app.crawlers.instagram import InstagramCrawler

CRAWLERS: dict[str, PlatformCrawler] = {
    InstagramCrawler.key: InstagramCrawler(),
    FacebookCrawler.key: FacebookCrawler(),
}


def get_crawler(platform: str) -> PlatformCrawler | None:
    """按平台 key 取爬虫,未知平台返回 None。"""
    return CRAWLERS.get(platform)
