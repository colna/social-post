"""统一数据模型(pydantic v2)。

内部字段用 snake_case;对外 HTTP 响应通过 alias 输出 camelCase,
供 Node 端消费。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """所有对外模型的基类:自动生成 camelCase alias,同时允许用字段名填充。"""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


class CrawlOptions(CamelModel):
    # max_posts=None 表示不限条数;since/until 为 unix 秒,限定帖子发布时间段
    max_posts: int | None = None
    since: int | None = None
    until: int | None = None


class PostItem(CamelModel):
    shortcode: str
    url: str
    type: str  # image | video | carousel | reel
    cover_url: str
    caption: str | None = None
    like_count: int | None = None
    comment_count: int | None = None
    taken_at: datetime | None = None
    raw: dict | None = None


class AccountProfile(CamelModel):
    handle: str
    display_name: str | None = None
    avatar_url: str | None = None
    bio: str | None = None
    follower_count: int | None = None
    following_count: int | None = None
    media_count: int | None = None
    is_verified: bool = False
    is_private: bool = False
    external_url: str | None = None
    external_id: str | None = None


class ProfileResult(CamelModel):
    account: AccountProfile
    posts: list[PostItem]
    fetched_at: datetime


class CrawlRequest(CamelModel):
    """POST /crawl/{platform} 请求体。"""

    handle: str
    max_posts: int | None = None
    since: int | None = None
    until: int | None = None
    cookie: str | None = None
