import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import './styles/main.css';
import { appRoutes } from './router';

/** 大漆主题：朱漆红主色 + 描金辅助色 + 宋体字族 */
const theme = {
  token: {
    colorPrimary: '#8c2f1f',
    colorInfo: '#3a6ea5',
    colorSuccess: '#2f6f4f',
    colorWarning: '#c9963c',
    colorTextBase: '#2a1c16',
    borderRadius: 8,
    fontFamily:
      '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "PingFang SC", "Microsoft YaHei", serif',
  },
  components: {
    Layout: { headerBg: '#fffdf8', siderBg: '#241713' },
    Card: { headerBg: '#fffaf0' },
  },
};

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载节点');
}

/** 路由由 src/router/index.tsx 提供，App 负责整体布局与外层导航 */
const router = createBrowserRouter(appRoutes);

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
