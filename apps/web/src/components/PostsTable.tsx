import { Image, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Post } from '@/services/types';

const TYPE_COLOR: Record<string, string> = {
  image: 'green',
  video: 'volcano',
  reel: 'magenta',
  carousel: 'geekblue',
};

function fmtTime(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
}

export interface PostsTableProps {
  posts: Post[];
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  onPageChange: (page: number, pageSize: number) => void;
}

export default function PostsTable({
  posts,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
}: PostsTableProps) {
  const columns: ColumnsType<Post> = [
    {
      title: '封面',
      dataIndex: 'coverUrl',
      width: 96,
      render: (src: string) => (
        <Image
          src={src}
          width={72}
          height={72}
          style={{ objectFit: 'cover', borderRadius: 6 }}
          fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='72' height='72' fill='%23eee'/%3E%3C/svg%3E"
        />
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (t: string) => <Tag color={TYPE_COLOR[t] || 'default'}>{t}</Tag>,
    },
    {
      title: '文案',
      dataIndex: 'caption',
      render: (c?: string | null) =>
        c ? (
          <Typography.Paragraph
            className="!mb-0"
            ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}
          >
            {c}
          </Typography.Paragraph>
        ) : (
          <span className="text-gray-400">(无文案)</span>
        ),
    },
    { title: '点赞', dataIndex: 'likeCount', width: 80, render: (v) => v ?? '-' },
    { title: '评论', dataIndex: 'commentCount', width: 80, render: (v) => v ?? '-' },
    {
      title: '发布时间',
      dataIndex: 'takenAt',
      width: 170,
      render: fmtTime,
    },
    {
      title: '原帖',
      dataIndex: 'url',
      width: 70,
      render: (url: string) => (
        <a href={url} target="_blank" rel="noreferrer">
          打开
        </a>
      ),
    },
  ];

  return (
    <Table<Post>
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={posts}
      columns={columns}
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        showTotal: (t) => `共 ${t} 条`,
        onChange: onPageChange,
      }}
    />
  );
}
