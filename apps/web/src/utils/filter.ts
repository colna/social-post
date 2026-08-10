// 账户表格筛选(纯函数,便于单测)。
// 供 IG / FB 共用的 ProTable search 表单调用。

export interface AccountLike {
  handle: string;
  displayName?: string | null;
  lastCrawledAt?: string | null;
}

export interface AccountFilter {
  // 账号 handle:子串匹配(忽略大小写、忽略首尾空格)
  handle?: string;
  // 展示名:子串匹配(忽略大小写)
  displayName?: string;
  // 最近抓取时间段:ProTable dateRange 默认输出 ['YYYY-MM-DD','YYYY-MM-DD'] 字符串
  lastCrawledAt?: [string, string] | string[] | null;
}

function includesCI(hay: string | null | undefined, needle: string): boolean {
  return (hay ?? '').toLowerCase().includes(needle);
}

// 把 'YYYY-MM-DD' 解析成当天起点 / 终点的本地时间戳;非法返回 null。
function dayBound(dateStr: string, end: boolean): number | null {
  if (!dateStr) return null;
  const suffix = end ? 'T23:59:59.999' : 'T00:00:00.000';
  const t = new Date(`${dateStr}${suffix}`).getTime();
  return Number.isNaN(t) ? null : t;
}

export function filterAccounts<T extends AccountLike>(
  list: T[],
  f: AccountFilter,
): T[] {
  let out = list;

  const handle = f.handle?.trim().toLowerCase();
  if (handle) out = out.filter((a) => includesCI(a.handle, handle));

  const displayName = f.displayName?.trim().toLowerCase();
  if (displayName) out = out.filter((a) => includesCI(a.displayName, displayName));

  const range = f.lastCrawledAt;
  if (Array.isArray(range) && range[0] && range[1]) {
    const start = dayBound(range[0], false);
    const end = dayBound(range[1], true);
    out = out.filter((a) => {
      if (!a.lastCrawledAt) return false; // 从未抓取的排除在时间段筛选外
      const t = new Date(a.lastCrawledAt).getTime();
      if (Number.isNaN(t)) return false;
      if (start != null && t < start) return false;
      if (end != null && t > end) return false;
      return true;
    });
  }

  return out;
}
