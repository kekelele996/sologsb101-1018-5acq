/**
 * 路由表（与提示词逐字一致）
 * /bodies、/coats、/rooms、/polish、/inlays、/export
 * 页面按路由懒加载，构建时自动分包。
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { Skeleton } from 'antd';
import App from '../App';

const BodyList = lazy(() => import('../pages/BodyList'));
const CoatBoard = lazy(() => import('../pages/CoatBoard'));
const RoomLog = lazy(() => import('../pages/RoomLog'));
const PolishBoard = lazy(() => import('../pages/PolishBoard'));
const InlayBoard = lazy(() => import('../pages/InlayBoard'));
const ExportView = lazy(() => import('../pages/ExportView'));

/** ROUTES 常量：页面与导航统一引用，避免散落硬编码 */
export const ROUTES = {
  bodies: '/bodies',
  coats: '/coats',
  rooms: '/rooms',
  polish: '/polish',
  inlays: '/inlays',
  export: '/export',
} as const;

/** 懒加载页面占位 */
function RouteFallback() {
  return (
    <Skeleton
      active
      paragraph={{ rows: 6 }}
      style={{ background: '#fffdf8', padding: 16, borderRadius: 10 }}
    />
  );
}

function withSuspense(node: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to={ROUTES.bodies} replace /> },
      { path: 'bodies', element: withSuspense(<BodyList />) },
      { path: 'coats', element: withSuspense(<CoatBoard />) },
      { path: 'rooms', element: withSuspense(<RoomLog />) },
      { path: 'polish', element: withSuspense(<PolishBoard />) },
      { path: 'inlays', element: withSuspense(<InlayBoard />) },
      { path: 'export', element: withSuspense(<ExportView />) },
      { path: '*', element: <Navigate to={ROUTES.bodies} replace /> },
    ],
  },
];

export default appRoutes;
