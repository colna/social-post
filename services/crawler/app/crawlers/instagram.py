"""Instagram 平台爬虫:构造请求 → 抓取 → 解析。"""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote

from app import fetcher
from app.config import settings
from app.errors import FetchError
from app.models import AccountProfile, CrawlOptions, ProfileResult
from app.parsers.instagram import (
    parse_feed_items,
    parse_profile_html,
    parse_web_profile_info,
)

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
# web_profile_info 对「商业/专业号」会返回 400(IG 侧 ig_business_category_subvertical
# asset 被删的 bug),此时回退到主页 HTML 抠 user id + 基础资料。
PROFILE_HTML_URL = "https://www.instagram.com/{handle}/"


class InstagramCrawler:
    key = "instagram"

    async def fetch_profile(
        self,
        handle: str,
        opts: CrawlOptions,
        cookie: str | None,
    ) -> ProfileResult:
        headers = {
            "x-ig-app-id": IG_APP_ID,
            "User-Agent": DESKTOP_UA,
            "Accept": "application/json",
        }
        cookie_value = cookie if cookie else settings.ig_cookie
        if cookie_value:
            headers["Cookie"] = cookie_value

        try:
            json_data = await fetcher.fetch_json(
                WEB_PROFILE_INFO_URL.format(handle=quote(handle)),
                headers=headers,
                mode=settings.scrapling_mode,
            )
            result = parse_web_profile_info(json_data)
        except FetchError:
            # 商业号 web_profile_info 会 400,回退到主页 HTML 解析
            result = await self._fetch_via_html(handle, cookie_value)

        max_posts = opts.max_posts if opts.max_posts is not None else 30

        # 帖子未随资料返回时(现状,含回退路径),走 user feed 接口拿帖子
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

    async def _fetch_via_html(
        self, handle: str, cookie_value: str | None
    ) -> ProfileResult:
        """web_profile_info 失败时的回退:从主页 HTML 抠 user id + 基础资料。"""
        html_headers = {"User-Agent": DESKTOP_UA}
        if cookie_value:
            html_headers["Cookie"] = cookie_value

        html_text = await fetcher.fetch_text(
            PROFILE_HTML_URL.format(handle=quote(handle)),
            headers=html_headers,
            mode=settings.scrapling_mode,
        )
        info = parse_profile_html(html_text)
        if not info or not info.get("external_id"):
            raise FetchError("无法从主页 HTML 解析 user id")

        account = AccountProfile(
            handle=info.get("username") or handle,
            display_name=info.get("display_name"),
            avatar_url=info.get("avatar_url"),
            bio=None,
            follower_count=info.get("follower_count"),
            following_count=info.get("following_count"),
            media_count=info.get("media_count"),
            is_verified=False,
            is_private=False,
            external_url=None,
            external_id=info.get("external_id"),
        )
        return ProfileResult(
            account=account, posts=[], fetched_at=datetime.now(tz=timezone.utc)
        )
