// 展示层格式化工具(纯函数,便于单测)

export function formatCount(n?: number | null): string {
  if (n == null) return '-';
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
}

export const POST_TYPE_COLOR: Record<string, string> = {
  image: 'green',
  video: 'volcano',
  reel: 'magenta',
  carousel: 'geekblue',
};

export function postTypeColor(t: string): string {
  return POST_TYPE_COLOR[t] || 'default';
}
