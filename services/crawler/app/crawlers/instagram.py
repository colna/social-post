"""Instagram 平台爬虫:构造请求 → 抓取 → 解析。"""

from __future__ import annotations

from urllib.parse import quote

from app import fetcher
from app.config import settings
from app.models import CrawlOptions, ProfileResult
from app.parsers.instagram import parse_web_profile_info

# Instagram 私有 web API 需要固定的 app id
IG_APP_ID = "936619743392459"
DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
WEB_PROFILE_INFO_URL = (
    "https://www.instagram.com/api/v1/users/web_profile_info/?username={handle}"
)


class InstagramCrawler:
    key = "instagram"

    async def fetch_profile(
        self,
        handle: str,
        opts: CrawlOptions,
        cookie: str | None,
    ) -> ProfileResult:
        url = WEB_PROFILE_INFO_URL.format(handle=quote(handle))
        headers = {
            "x-ig-app-id": IG_APP_ID,
            "User-Agent": DESKTOP_UA,
            "Accept": "application/json",
        }
        cookie_value = cookie if cookie else settings.ig_cookie
        if cookie_value:
            headers["Cookie"] = cookie_value

        json_data = await fetcher.fetch_json(
            url, headers=headers, mode=settings.scrapling_mode
        )
        result = parse_web_profile_info(json_data)

        # 按 max_posts 截断
        if opts.max_posts is not None and opts.max_posts >= 0:
            result.posts = result.posts[: opts.max_posts]
        return result
