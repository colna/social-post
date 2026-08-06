"""Instagram web_profile_info 响应解析器(纯函数,无副作用)。

输入是 `GET /api/v1/users/web_profile_info/?username=<handle>` 的 JSON,
输出统一的 ProfileResult。所有字段取值都用 .get() 兜底,不抛 KeyError;
仅当 data/user 顶层结构缺失时抛 ParseError。
"""

from __future__ import annotations

import html
import re
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


def _abbrev_to_int(token: str) -> int | None:
    """把 '33M' / '4,837' / '1.2K' 这类(可能缩写的)数字转成 int。"""
    token = token.strip().replace(",", "")
    m = re.match(r"^([\d.]+)\s*([KMBkmb])?$", token)
    if not m:
        return None
    try:
        value = float(m.group(1))
    except ValueError:
        return None
    mult = {"K": 1e3, "M": 1e6, "B": 1e9}.get((m.group(2) or "").upper(), 1)
    return int(value * mult)


def _og(html_text: str, prop: str) -> str | None:
    m = re.search(
        r'<meta property="og:' + prop + r'" content="([^"]*)"', html_text
    )
    return html.unescape(m.group(1)) if m else None


def parse_profile_html(html_text: str) -> dict | None:
    """从 IG 主页 HTML 抠 user id + 基础资料(best-effort)。

    用于 web_profile_info 对商业号返回 400(IG bug)时的回退。返回 dict;
    拿不到 user id 则返回 None。粉丝/关注/帖子数来自 og:description(顺序固定:
    followers、following、posts),大号粉丝数是缩写(如 33M),为近似值。
    """
    idm = re.search(r'"profilePage_(\d+)"', html_text) or re.search(
        r'"props":\{"user":\{"id":"(\d+)"', html_text
    )
    if not idm:
        return None
    user_id = idm.group(1)

    title = _og(html_text, "title") or ""
    handle_m = re.search(r"\(@([A-Za-z0-9._]+)\)", title)
    username = handle_m.group(1) if handle_m else None
    display_name = title.split(" (@")[0].strip() or None

    avatar = _og(html_text, "image")

    desc = _og(html_text, "description") or ""
    nums = re.findall(r"[\d][\d.,]*\s*[KMBkmb]?", desc)
    follower = _abbrev_to_int(nums[0]) if len(nums) > 0 else None
    following = _abbrev_to_int(nums[1]) if len(nums) > 1 else None
    media = _abbrev_to_int(nums[2]) if len(nums) > 2 else None

    return {
        "external_id": user_id,
        "username": username,
        "display_name": display_name,
        "avatar_url": avatar,
        "follower_count": follower,
        "following_count": following,
        "media_count": media,
    }


def _feed_media_type(item: dict) -> str:
    """feed item 的 media_type:1=图,2=视频(clips 为 reel),8=carousel。"""
    mt = item.get("media_type")
    if mt == 8:
        return "carousel"
    if mt == 2:
        return "reel" if item.get("product_type") == "clips" else "video"
    return "image"


def _feed_cover(item: dict) -> str:
    """封面图:carousel 取首图,否则取自身 image_versions2 首个候选。"""
    node = item
    carousel = item.get("carousel_media")
    if isinstance(carousel, list) and carousel:
        node = carousel[0]
    candidates = (node.get("image_versions2") or {}).get("candidates") or []
    if candidates:
        return candidates[0].get("url") or ""
    return ""


def _parse_feed_item(item: dict) -> PostItem:
    """解析 /api/v1/feed/user/{id}/ 的单条 item(结构与 web_profile_info 的 node 不同)。"""
    code = item.get("code") or ""
    mtype = _feed_media_type(item)
    path = "reel" if mtype == "reel" else "p"

    taken_ts = _to_int(item.get("taken_at"))
    taken_at = (
        datetime.fromtimestamp(taken_ts, tz=timezone.utc)
        if taken_ts is not None
        else None
    )

    caption_node = item.get("caption")
    caption = caption_node.get("text") if isinstance(caption_node, dict) else None

    return PostItem(
        shortcode=code,
        url=f"https://www.instagram.com/{path}/{code}/",
        type=mtype,
        cover_url=_feed_cover(item),
        caption=caption or None,
        like_count=_to_int(item.get("like_count")),
        comment_count=_to_int(item.get("comment_count")),
        taken_at=taken_at,
        raw=item,
    )


def parse_feed_items(json_data: dict) -> list[PostItem]:
    """把 user feed 接口的 JSON(顶层 `items` 数组)解析成 PostItem 列表。"""
    items = json_data.get("items") if isinstance(json_data, dict) else None
    if not isinstance(items, list):
        return []
    return [_parse_feed_item(it) for it in items if isinstance(it, dict)]


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
