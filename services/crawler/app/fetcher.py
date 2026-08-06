"""scrapling 薄封装:唯一真正接触网络与 scrapling 的地方。

scrapling 采用延迟 import,使得:
  - 未安装 scrapling 时,导入本模块 / 导入 app 不报错;
  - parser 与 API 测试可通过 monkeypatch 替换 fetch_json,完全离线。
本层不写单测(依赖 scrapling)。
"""

from __future__ import annotations

import json
from typing import Any

from app.errors import FetchError


async def _raw_get(
    url: str, headers: dict[str, str], mode: str
) -> tuple[int | None, str | None]:
    """发一次 GET,返回 (status, body_text)。

    mode == "stealth" 用 scrapling StealthyFetcher(需 playwright/浏览器);
    否则(默认 fetch)直接用 curl_cffi:后者在 import 阶段会连锁加载 camoufox/playwright,
    缺 playwright 会 ModuleNotFoundError,而 IG 抓的是纯文本/JSON,curl_cffi 足矣。
    """
    if mode == "stealth":
        from scrapling.fetchers import StealthyFetcher

        page = await StealthyFetcher.async_fetch(url, headers=headers, network_idle=True)
        return getattr(page, "status", None), (
            getattr(page, "body", None) or getattr(page, "text", None)
        )

    from curl_cffi.requests import AsyncSession

    async with AsyncSession() as session:
        resp = await session.get(url, headers=headers, impersonate="chrome")
    return resp.status_code, resp.text


async def fetch_text(url: str, headers: dict[str, str], mode: str = "fetch") -> str:
    """抓取 url 返回原始文本(HTML 等)。非 2xx / 空正文归一为 FetchError。"""
    try:
        status, body = await _raw_get(url, headers, mode)
    except FetchError:
        raise
    except Exception as exc:  # 各类抓取异常统一归一
        raise FetchError(f"抓取失败: {exc}") from exc

    if status is not None and not (200 <= status < 300):
        raise FetchError(f"上游返回非 2xx 状态: {status}")
    if not body:
        raise FetchError("上游响应无正文")
    return body


async def fetch_json(url: str, headers: dict[str, str], mode: str = "fetch") -> dict:
    """抓取 url 并返回解析后的 JSON dict。

    任何网络失败 / 非 2xx / JSON 解析失败都归一为 FetchError。
    """
    body = await fetch_text(url, headers, mode)
    try:
        return json.loads(body)
    except (ValueError, TypeError) as exc:
        raise FetchError(f"响应不是合法 JSON: {exc}") from exc
