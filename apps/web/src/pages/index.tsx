import { useRef, useState, type ReactNode } from 'react';
import { useRequest } from 'ahooks';
import {
  ProLayout,
  PageContainer,
  ProTable,
  ModalForm,
  ProFormText,
  ProDescriptions,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import {
  App,
  Avatar,
  Button,
  Image,
  Popconfirm,
  Space,
  Tag,
  Typography,
  Drawer,
} from 'antd';
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  FacebookFilled,
  InstagramOutlined,
  PlusOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { api } from '@/services/api';
import type { Account, Platform, Post } from '@/services/types';
import { formatCount, formatTime, postTypeColor } from '@/utils/format';

const PLATFORM_ICON: Record<string, ReactNode> = {
  instagram: <InstagramOutlined />,
  facebook: <FacebookFilled />,
};

export default function HomePage() {
  const { message } = App.useApp();
  const [platform, setPlatform] = useState('');
  const [crawlingId, setCrawlingId] = useState('');
  const [drawerAccount, setDrawerAccount] = useState<Account | null>(null);
  const accountsRef = useRef<ActionType>();
  const postsRef = useRef<ActionType>();

  const { data: platforms = [] } = useRequest(api.platforms, {
    onSuccess: (list: Platform[]) => {
      if (!platform) {
        const first = list.find((p) => p.enabled) || list[0];
        if (first) setPlatform(first.key);
      }
    },
  });

  const menuData = platforms.map((p) => ({
    path: p.key,
    name: p.name,
    icon: PLATFORM_ICON[p.key],
    disabled: !p.enabled,
  }));

  // 抓取
  async function handleCrawl(account: Account) {
    setCrawlingId(account.id);
    const hide = message.loading(`正在抓取 @${account.handle} ...`, 0);
    try {
      const r = await api.crawl(account.id, 30);
      message.success(`抓取完成:新增 ${r.added},共 ${r.total}`);
      accountsRef.current?.reload();
      if (drawerAccount?.id === account.id) postsRef.current?.reload();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      hide();
      setCrawlingId('');
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteAccount(id);
      message.success('已删除');
      accountsRef.current?.reload();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  const accountColumns: ProColumns<Account>[] = [
    {
      title: '账号',
      dataIndex: 'handle',
      render: (_, r) => (
        <Space>
          <Avatar size="small" src={r.avatarUrl || undefined}>
            {r.handle.slice(0, 2).toUpperCase()}
          </Avatar>
          <span>@{r.handle}</span>
          {r.isVerified && <Tag color="blue">V</Tag>}
        </Space>
      ),
    },
    { title: '展示名', dataIndex: 'displayName', render: (v) => v || '-' },
    {
      title: '粉丝',
      dataIndex: 'followerCount',
      render: (_, r) => formatCount(r.followerCount),
    },
    {
      title: '帖子数',
      dataIndex: 'mediaCount',
      render: (_, r) => formatCount(r.mediaCount),
    },
    {
      title: '最近抓取',
      dataIndex: 'lastCrawledAt',
      render: (_, r) => formatTime(r.lastCrawledAt),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 220,
      render: (_, r) => [
        <Button
          key="crawl"
          type="link"
          size="small"
          icon={<CloudDownloadOutlined />}
          loading={crawlingId === r.id}
          onClick={() => handleCrawl(r)}
        >
          抓取
        </Button>,
        <Button
          key="posts"
          type="link"
          size="small"
          icon={<UnorderedListOutlined />}
          onClick={() => setDrawerAccount(r)}
        >
          帖子
        </Button>,
        <Popconfirm
          key="del"
          title="删除该账户及其帖子?"
          onConfirm={() => handleDelete(r.id)}
        >
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  const postColumns: ProColumns<Post>[] = [
    {
      title: '封面',
      dataIndex: 'coverUrl',
      width: 88,
      render: (_, r) => (
        <Image
          src={r.coverUrl}
          width={64}
          height={64}
          style={{ objectFit: 'cover', borderRadius: 6 }}
          fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23eee'/%3E%3C/svg%3E"
        />
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (_, r) => <Tag color={postTypeColor(r.type)}>{r.type}</Tag>,
    },
    {
      title: '文案',
      dataIndex: 'caption',
      render: (_, r) =>
        r.caption ? (
          <Typography.Paragraph
            style={{ marginBottom: 0 }}
            ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}
          >
            {r.caption}
          </Typography.Paragraph>
        ) : (
          <span style={{ color: '#bbb' }}>(无文案)</span>
        ),
    },
    {
      title: '点赞',
      dataIndex: 'likeCount',
      width: 80,
      render: (_, r) => formatCount(r.likeCount),
    },
    {
      title: '评论',
      dataIndex: 'commentCount',
      width: 80,
      render: (_, r) => formatCount(r.commentCount),
    },
    {
      title: '发布时间',
      dataIndex: 'takenAt',
      width: 170,
      render: (_, r) => formatTime(r.takenAt),
    },
    {
      title: '原帖',
      dataIndex: 'url',
      width: 70,
      render: (_, r) => (
        <a href={r.url} target="_blank" rel="noreferrer">
          打开
        </a>
      ),
    },
  ];

  return (
    <ProLayout
      title="社媒帖子采集"
      logo={<InstagramOutlined style={{ fontSize: 22 }} />}
      layout="mix"
      fixSiderbar
      fixedHeader
      siderWidth={200}
      location={{ pathname: platform }}
      menuDataRender={() => menuData}
      menuItemRender={(item, dom) =>
        item.disabled ? (
          <span style={{ cursor: 'not-allowed' }}>
            {dom} <Tag>敬请期待</Tag>
          </span>
        ) : (
          <span onClick={() => item.path && setPlatform(item.path)}>{dom}</span>
        )
      }
      menuProps={{ selectedKeys: [platform] }}
      collapsedButtonRender={false}
    >
      <PageContainer
        header={{
          title: `${platforms.find((p) => p.key === platform)?.name || ''} · 账户管理`,
        }}
      >
        <ProTable<Account>
          actionRef={accountsRef}
          rowKey="id"
          search={false}
          options={{ reload: true, density: false, setting: false }}
          params={{ platform }}
          request={async () => {
            if (!platform) return { data: [], success: true, total: 0 };
            const data = await api.accounts(platform);
            return { data, success: true, total: data.length };
          }}
          columns={accountColumns}
          pagination={{ pageSize: 10 }}
          toolBarRender={() => [
            <ModalForm
              key="add"
              title="新增账户"
              width={420}
              trigger={
                <Button type="primary" icon={<PlusOutlined />}>
                  新增账户
                </Button>
              }
              modalProps={{ destroyOnClose: true }}
              onFinish={async (v: { handle: string }) => {
                try {
                  await api.createAccount(platform, v.handle.trim());
                  message.success(`已添加 @${v.handle.trim()}`);
                  accountsRef.current?.reload();
                  return true;
                } catch (e) {
                  message.error((e as Error).message);
                  return false;
                }
              }}
            >
              <ProFormText
                name="handle"
                label="账号 handle"
                placeholder="如 nasa"
                rules={[
                  { required: true, message: '请输入 handle' },
                  {
                    pattern: /^[A-Za-z0-9._]+$/,
                    message: '只允许字母、数字、. 和 _',
                  },
                ]}
              />
            </ModalForm>,
          ]}
        />
      </PageContainer>

      <Drawer
        open={!!drawerAccount}
        onClose={() => setDrawerAccount(null)}
        width={760}
        title={drawerAccount ? `@${drawerAccount.handle} 的帖子` : ''}
        extra={
          drawerAccount && (
            <Button
              type="primary"
              icon={<CloudDownloadOutlined />}
              loading={crawlingId === drawerAccount.id}
              onClick={() => handleCrawl(drawerAccount)}
            >
              抓取
            </Button>
          )
        }
      >
        {drawerAccount && (
          <>
            <ProDescriptions<Account>
              column={2}
              dataSource={drawerAccount}
              style={{ marginBottom: 16 }}
              columns={[
                { title: '展示名', dataIndex: 'displayName' },
                {
                  title: '粉丝',
                  dataIndex: 'followerCount',
                  render: (_, r) => formatCount(r.followerCount),
                },
                {
                  title: '关注',
                  dataIndex: 'followingCount',
                  render: (_, r) => formatCount(r.followingCount),
                },
                {
                  title: '帖子数',
                  dataIndex: 'mediaCount',
                  render: (_, r) => formatCount(r.mediaCount),
                },
                { title: '简介', dataIndex: 'bio', span: 2 },
              ]}
            />
            <ProTable<Post>
              actionRef={postsRef}
              rowKey="id"
              search={false}
              options={false}
              params={{ accountId: drawerAccount.id }}
              request={async (p) => {
                const r = await api.posts(
                  drawerAccount.id,
                  p.current ?? 1,
                  p.pageSize ?? 10,
                );
                return { data: r.items, total: r.total, success: true };
              }}
              columns={postColumns}
              pagination={{ pageSize: 10 }}
            />
          </>
        )}
      </Drawer>
    </ProLayout>
  );
}
