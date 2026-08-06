"""Instagram 平台爬虫:构造请求 → 抓取 → 解析。"""

from __future__ import annotations

from urllib.parse import quote

from app import fetcher
from app.config import settings
from app.models import CrawlOptions, ProfileResult
from app.parsers.instagram import parse_feed_items, parse_web_profile_info

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
# web_profile_info 现在通常只返回资料 + 帖子数量,不再返回 timeline 明细,
# 需要帖子列表时回退到用户 feed 接口(按 user id 查)。
USER_FEED_URL = "https://www.instagram.com/api/v1/feed/user/{user_id}/?count={count}"


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

        max_posts = opts.max_posts if opts.max_posts is not None else 30

        # web_profile_info 未带 timeline 明细(现状)时,回退到 user feed 接口拿帖子
        if max_posts > 0 and not result.posts and result.account.external_id:
            feed_url = USER_FEED_URL.format(
                user_id=quote(str(result.account.external_id)),
                count=max_posts,
            )
            feed_json = await fetcher.fetch_json(
                feed_url, headers=headers, mode=settings.scrapling_mode
            )
            result.posts = parse_feed_items(feed_json)

        # 按 max_posts 截断
        if max_posts >= 0:
            result.posts = result.posts[:max_posts]
        return result
