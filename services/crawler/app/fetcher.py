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


async def fetch_json(url: str, headers: dict[str, str], mode: str = "fetch") -> dict:
    """抓取 url 并返回解析后的 JSON dict。

    mode == "stealth" 用 scrapling StealthyFetcher(需 playwright/浏览器);
    否则(默认 fetch)直接用 curl_cffi 请求。
    任何网络失败 / 非 2xx / JSON 解析失败都归一为 FetchError。
    """
    try:
        if mode == "stealth":
            from scrapling.fetchers import StealthyFetcher

            page = await StealthyFetcher.async_fetch(
                url,
                headers=headers,
                network_idle=True,
            )
            status = getattr(page, "status", None)
            body = getattr(page, "body", None) or getattr(page, "text", None)
        else:
            # 直接用 curl_cffi(impersonate 伪装浏览器 TLS 指纹),不走 scrapling.fetchers:
            # 后者在 import 阶段会连锁加载 camoufox/playwright 引擎,缺 playwright 时
            # 整个导入就 ModuleNotFoundError。IG 抓的是纯 JSON 接口,curl_cffi 足矣。
            from curl_cffi.requests import AsyncSession

            async with AsyncSession() as session:
                resp = await session.get(
                    url,
                    headers=headers,
                    impersonate="chrome",
                )
            status = resp.status_code
            body = resp.text
    except FetchError:
        raise
    except Exception as exc:  # 各类抓取异常统一归一
        raise FetchError(f"抓取失败: {exc}") from exc

    if status is not None and not (200 <= status < 300):
        raise FetchError(f"上游返回非 2xx 状态: {status}")

    if body is None:
        raise FetchError("上游响应无正文")

    try:
        return json.loads(body)
    except (ValueError, TypeError) as exc:
        raise FetchError(f"响应不是合法 JSON: {exc}") from exc
