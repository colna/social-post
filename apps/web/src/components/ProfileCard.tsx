import { Avatar, Card, Space, Statistic, Tag } from 'antd';
import type { Account } from '@/services/types';

function fmt(n?: number | null): string {
  if (n == null) return '-';
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return String(n);
}

export default function ProfileCard({ account }: { account: Account }) {
  return (
    <Card size="small">
      <div className="flex items-start gap-4">
        <Avatar size={64} src={account.avatarUrl || undefined}>
          {account.handle.slice(0, 2).toUpperCase()}
        </Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">
              {account.displayName || account.handle}
            </span>
            <span className="text-gray-400">@{account.handle}</span>
            {account.isVerified && <Tag color="blue">已认证</Tag>}
            {account.isPrivate && <Tag>私密</Tag>}
          </div>
          {account.bio && (
            <div className="mt-1 whitespace-pre-line text-gray-600 text-sm">
              {account.bio}
            </div>
          )}
          <Space size="large" className="mt-3">
            <Statistic title="粉丝" value={fmt(account.followerCount)} />
            <Statistic title="关注" value={fmt(account.followingCount)} />
            <Statistic title="帖子" value={fmt(account.mediaCount)} />
          </Space>
        </div>
      </div>
    </Card>
  );
}
