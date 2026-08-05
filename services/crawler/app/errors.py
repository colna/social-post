"""自定义异常。"""

from __future__ import annotations


class ParseError(Exception):
    """解析上游响应失败(结构缺失等)。"""


class FetchError(Exception):
    """抓取上游失败(网络错误、被封、非 2xx 等)。"""
