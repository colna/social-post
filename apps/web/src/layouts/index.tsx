import { Outlet } from 'umi';
import { App, ConfigProvider, Layout, theme } from 'antd';
import '../global.css';

const { Header, Content } = Layout;

export default function BaseLayout() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff', borderRadius: 8 },
      }}
    >
      <App>
        <Layout className="min-h-screen">
          <Header className="flex items-center" style={{ background: '#141414' }}>
            <span className="text-white text-lg font-semibold">
              social-post · 社媒帖子采集
            </span>
          </Header>
          <Content className="p-4" style={{ background: '#f5f5f5' }}>
            <Outlet />
          </Content>
        </Layout>
      </App>
    </ConfigProvider>
  );
}
