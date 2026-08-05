"""Instagram web_profile_info 响应解析器(纯函数,无副作用)。

输入是 `GET /api/v1/users/web_profile_info/?username=<handle>` 的 JSON,
输出统一的 ProfileResult。所有字段取值都用 .get() 兜底,不抛 KeyError;
仅当 data/user 顶层结构缺失时抛 ParseError。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.errors import ParseError
from app.models import AccountProfile, PostItem, ProfileResult


def _to_int(value: Any) -> int | None:
    """尽量把上游数字字段转成 int,失败返回 None。"""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_caption(node: dict) -> str | None:
    """caption 藏在 edge_media_to_caption.edges[0].node.text,可能为空。"""
    edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
    if not edges:
        return None
    text = (edges[0].get("node") or {}).get("text")
    return text if text else None


def _extract_like_count(node: dict) -> int | None:
    """优先 edge_liked_by,退回 edge_media_preview_like。"""
    liked = (node.get("edge_liked_by") or {}).get("count")
    if liked is not None:
        return _to_int(liked)
    preview = (node.get("edge_media_preview_like") or {}).get("count")
    return _to_int(preview)


def _determine_type(node: dict, is_reel: bool) -> str:
    """按 __typename / is_video / product_type 判定帖子类型。"""
    typename = node.get("__typename")
    if typename == "GraphSidecar":
        return "carousel"
    if node.get("is_video"):
        return "reel" if is_reel else "video"
    return "image"


def _parse_post(node: dict) -> PostItem:
    shortcode = node.get("shortcode") or ""
    product_type = node.get("product_type")
    # reel 判定:clips 类型即认为是 reel
    is_reel = bool(node.get("is_video")) and product_type == "clips"
    path = "reel" if is_reel else "p"
    url = f"https://www.instagram.com/{path}/{shortcode}/"

    taken_ts = _to_int(node.get("taken_at_timestamp"))
    taken_at = (
        datetime.fromtimestamp(taken_ts, tz=timezone.utc)
        if taken_ts is not None
        else None
    )

    return PostItem(
        shortcode=shortcode,
        url=url,
        type=_determine_type(node, is_reel),
        cover_url=node.get("display_url") or "",
        caption=_extract_caption(node),
        like_count=_extract_like_count(node),
        comment_count=_to_int((node.get("edge_media_to_comment") or {}).get("count")),
        taken_at=taken_at,
        raw=node,
    )


def parse_web_profile_info(json_data: dict) -> ProfileResult:
    """把 web_profile_info JSON 解析成 ProfileResult。"""
    data = json_data.get("data") if isinstance(json_data, dict) else None
    user = data.get("user") if isinstance(data, dict) else None
    if not isinstance(user, dict):
        raise ParseError("响应缺少 data.user,无法解析 Instagram 主页")

    account = AccountProfile(
        handle=user.get("username") or "",
        display_name=user.get("full_name") or None,
        avatar_url=user.get("profile_pic_url_hd") or user.get("profile_pic_url") or None,
        bio=user.get("biography") or None,
        follower_count=_to_int((user.get("edge_followed_by") or {}).get("count")),
        following_count=_to_int((user.get("edge_follow") or {}).get("count")),
        media_count=_to_int(
            (user.get("edge_owner_to_timeline_media") or {}).get("count")
        ),
        is_verified=bool(user.get("is_verified")),
        is_private=bool(user.get("is_private")),
        external_url=user.get("external_url") or None,
        external_id=user.get("id") or None,
    )

    edges = (user.get("edge_owner_to_timeline_media") or {}).get("edges") or []
    posts: list[PostItem] = []
    for edge in edges:
        node = edge.get("node") if isinstance(edge, dict) else None
        if isinstance(node, dict):
            posts.append(_parse_post(node))

    return ProfileResult(
        account=account,
        posts=posts,
        fetched_at=datetime.now(tz=timezone.utc),
    )
