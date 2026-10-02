/**
 * 应用外壳：左侧导航 + 顶部当前胎体上下文 + 页脚数据说明
 * 首屏负责初始化 IndexedDB 并播种演示数据，然后载入各 store。
 */
import { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { App as AntdApp, Badge, Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import {
  AppstoreOutlined,
  BgColorsOutlined,
  CloudOutlined,
  DashboardOutlined,
  ExportOutlined,
  FormatPainterOutlined,
  HighlightOutlined,
} from '@ant-design/icons';
import { ROUTES } from './router';
import { useBodyStore } from './stores/bodyStore';
import { useCoatStore } from './stores/coatStore';
import { useRoomStore } from './stores/roomStore';
import { initDatabase } from './utils/db';
import { BODY_MATERIAL_LABEL, BODY_SHAPE_LABEL, BODY_STATE_LABEL } from './types/body';

const { Header, Sider, Content, Footer } = Layout;

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  const bodies = useBodyStore((state) => state.bodies);
  const currentBodyId = useBodyStore((state) => state.currentBodyId);
  const loadBodies = useBodyStore((state) => state.loadBodies);
  const coats = useCoatStore((state) => state.coats);
  const loadCoats = useCoatStore((state) => state.loadCoats);
  const rooms = useRoomStore((state) => state.rooms);
  const loadRooms = useRoomStore((state) => state.loadRooms);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await initDatabase();
        if (cancelled) return;
        await Promise.all([loadBodies(), loadCoats(), loadRooms()]);
      } catch (error) {
        if (cancelled) return;
        message.error(`本地数据库初始化失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBodies, loadCoats, loadRooms, message]);

  const currentBody = bodies.find((body) => body.id === currentBodyId) ?? null;
  const selectedKey = location.pathname.startsWith('/coats')
    ? ROUTES.coats
    : location.pathname.startsWith('/rooms')
      ? ROUTES.rooms
      : location.pathname.startsWith('/polish')
        ? ROUTES.polish
        : location.pathname.startsWith('/inlays')
          ? ROUTES.inlays
          : location.pathname.startsWith('/export')
            ? ROUTES.export
            : ROUTES.bodies;

  return (
    <Layout style={{ minHeight: '100vh', background: 'transparent' }}>
      <Sider width={228} breakpoint="lg" collapsedWidth={0} style={{ background: '#241713', borderRight: '3px solid #8c2f1f' }}>
        <div style={{ padding: '18px 16px 10px' }}>
          <Typography.Title level={5} style={{ color: '#f2dfb8', margin: 0 }}>
            漆器髹涂工序档案
          </Typography.Title>
          <Typography.Text style={{ color: 'rgba(242,223,184,0.62)', fontSize: 12 }}>
            gblacquer · 髹涂与荫房
          </Typography.Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          style={{ background: 'transparent' }}
          onClick={({ key }) => navigate(key)}
          items={[
            { key: ROUTES.bodies, icon: <AppstoreOutlined />, label: '胎体与器型' },
            { key: ROUTES.coats, icon: <FormatPainterOutlined />, label: '髹涂道次' },
            { key: ROUTES.rooms, icon: <CloudOutlined />, label: '荫房记录' },
            { key: ROUTES.polish, icon: <BgColorsOutlined />, label: '打磨推光' },
            { key: ROUTES.inlays, icon: <HighlightOutlined />, label: '镶嵌纹饰' },
            { key: ROUTES.export, icon: <ExportOutlined />, label: '质检与导出' },
          ]}
        />
        <div style={{ padding: '12px 16px', color: 'rgba(242,223,184,0.6)', fontSize: 12 }}>
          <Space direction="vertical" size={2}>
            <span>
              <DashboardOutlined /> 胎体 {bodies.length} 件
            </span>
            <span>髹涂道次 {coats.length} 道</span>
            <span>荫房记录 {rooms.length} 条</span>
          </Space>
        </div>
      </Sider>

      <Layout style={{ background: 'transparent' }}>
        <Header
          style={{
            background: '#fffdf8',
            borderBottom: '1px solid rgba(140,47,31,0.16)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 20,
          }}
        >
          <Space size={10} wrap>
            <Typography.Text strong>当前胎体：</Typography.Text>
            {currentBody ? (
              <>
                <Tag color="#8c2f1f">{currentBody.code}</Tag>
                <Tag>{BODY_MATERIAL_LABEL[currentBody.material]}</Tag>
                <Tag>{BODY_SHAPE_LABEL[currentBody.shape]} · {currentBody.sizeMm}mm</Tag>
                <Tag color="gold">{BODY_STATE_LABEL[currentBody.state]}</Tag>
              </>
            ) : (
              <Tag>未选择胎体</Tag>
            )}
          </Space>
          <Space>
            <Button size="small" onClick={() => navigate(ROUTES.coats)}>
              进入道次编排
            </Button>
            <Badge count={coats.filter((coat) => coat.needRecheck).length} color="#c9963c" title="待复检道次" />
          </Space>
        </Header>

        <Content style={{ padding: 20, minHeight: 320 }}>
          <Outlet />
        </Content>

        <Footer style={{ textAlign: 'center', background: 'transparent', color: 'rgba(42,28,22,0.45)' }}>
          数据仅保存在本机浏览器（IndexedDB / localStorage）·{' '}
          <Link to={ROUTES.export}>导出 JSON 备份</Link>
        </Footer>
      </Layout>
    </Layout>
  );
}
