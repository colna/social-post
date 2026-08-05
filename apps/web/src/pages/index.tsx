import { useEffect, useState } from 'react';
import { useRequest } from 'ahooks';
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  List,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Tag,
} from 'antd';
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { api } from '@/services/api';
import ProfileCard from '@/components/ProfileCard';
import PostsTable from '@/components/PostsTable';

export default function HomePage() {
  const { message } = App.useApp();
  const [platform, setPlatform] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [handle, setHandle] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 平台列表
  const { data: platforms, loading: loadingPlatforms } = useRequest(
    api.platforms,
    {
      onSuccess: (list) => {
        if (list.length && !platform) setPlatform(list[0].key);
      },
    },
  );

  // 账户列表(随平台变化)
  const {
    data: accounts,
    loading: loadingAccounts,
    refresh: refreshAccounts,
  } = useRequest(() => api.accounts(platform), {
    ready: !!platform,
    refreshDeps: [platform],
    onSuccess: (list) => {
      // 平台切换后自动选中第一个账户
      if (!list.find((a) => a.id === accountId)) {
        setAccountId(list[0]?.id || '');
      }
    },
  });

  // 帖子列表(随账户/分页变化)
  const {
    data: postsData,
    loading: loadingPosts,
    refresh: refreshPosts,
  } = useRequest(() => api.posts(accountId, page, pageSize), {
    ready: !!accountId,
    refreshDeps: [accountId, page, pageSize],
  });

  useEffect(() => setPage(1), [accountId]);

  // 新增账户
  const { run: addAccount, loading: adding } = useRequest(
    () => api.createAccount(platform, handle.trim()),
    {
      manual: true,
      onSuccess: (acc) => {
        message.success(`已添加 @${acc.handle}`);
        setHandle('');
        setAccountId(acc.id);
        refreshAccounts();
      },
      onError: (e) => message.error(e.message),
    },
  );

  // 删除账户
  const { run: removeAccount } = useRequest((id: string) => api.deleteAccount(id), {
    manual: true,
    onSuccess: () => {
      message.success('已删除');
      setAccountId('');
      refreshAccounts();
    },
    onError: (e) => message.error(e.message),
  });

  // 触发抓取
  const { run: crawl, loading: crawling } = useRequest(
    () => api.crawl(accountId, 30),
    {
      manual: true,
      onSuccess: (r) => {
        message.success(`抓取完成:新增 ${r.added},共 ${r.total}`);
        refreshAccounts();
        refreshPosts();
      },
      onError: (e) => message.error(e.message),
    },
  );

  const currentAccount = accounts?.find((a) => a.id === accountId);

  if (loadingPlatforms) {
    return (
      <div className="flex justify-center py-20">
        <Spin />
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {/* 左:平台 + 账户 */}
      <div className="w-72 shrink-0">
        <Card size="small" title="平台" className="mb-4">
          <Segmented
            block
            value={platform}
            onChange={(v) => setPlatform(v as string)}
            options={(platforms || []).map((p) => ({
              label: p.name,
              value: p.key,
            }))}
          />
        </Card>

        <Card size="small" title="账户">
          <Space.Compact className="w-full mb-3">
            <Input
              placeholder="输入 handle,如 nasa"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onPressEnter={() => handle.trim() && addAccount()}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={adding}
              disabled={!handle.trim()}
              onClick={() => addAccount()}
            />
          </Space.Compact>

          <List
            size="small"
            loading={loadingAccounts}
            dataSource={accounts || []}
            locale={{ emptyText: <Empty description="暂无账户" /> }}
            renderItem={(a) => (
              <List.Item
                className={`cursor-pointer rounded px-2 ${
                  a.id === accountId ? 'bg-blue-50' : ''
                }`}
                onClick={() => setAccountId(a.id)}
                actions={[
                  <Popconfirm
                    key="del"
                    title="删除该账户及其帖子?"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      removeAccount(a.id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <DeleteOutlined
                      className="text-gray-400 hover:text-red-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>,
                ]}
              >
                <span className="truncate">@{a.handle}</span>
                {a.isVerified && (
                  <Tag color="blue" className="ml-1">
                    V
                  </Tag>
                )}
              </List.Item>
            )}
          />
        </Card>
      </div>

      {/* 右:画像 + 帖子表格 */}
      <div className="flex-1 min-w-0">
        {!accountId ? (
          <Card>
            <Empty description="请先在左侧添加并选择一个账户" />
          </Card>
        ) : (
          <Space direction="vertical" size="middle" className="w-full">
            {currentAccount && <ProfileCard account={currentAccount} />}
            <Card
              size="small"
              title={`帖子(@${currentAccount?.handle}）`}
              extra={
                <Button
                  type="primary"
                  icon={<CloudDownloadOutlined />}
                  loading={crawling}
                  onClick={() => crawl()}
                >
                  抓取
                </Button>
              }
            >
              <PostsTable
                posts={postsData?.items || []}
                total={postsData?.total || 0}
                page={page}
                pageSize={pageSize}
                loading={loadingPosts}
                onPageChange={(p, ps) => {
                  setPage(p);
                  setPageSize(ps);
                }}
              />
            </Card>
          </Space>
        )}
      </div>
    </div>
  );
}
