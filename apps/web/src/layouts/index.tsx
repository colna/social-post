import { Outlet } from 'umi';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import '../global.css';

export default function BaseLayout() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{ token: { colorPrimary: '#1677ff', borderRadius: 6 } }}
    >
      <App>
        <Outlet />
      </App>
    </ConfigProvider>
  );
}
