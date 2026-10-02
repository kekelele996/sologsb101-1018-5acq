/**
 * /inlays 纹饰与螺钿 / 蛋壳镶嵌登记
 * 支持按类型与位置筛选、批量调整图案分类，并在器型示意区叠加显示。
 * 消费 Inlay、Body；复用 <FilterBar>、<EmptyPanel>、<StatBadge>。
 */
import { useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import FilterBar, { useFilterQuery, type FilterSelectConfig } from '@/components/common/FilterBar';
import StatBadge from '@/components/common/StatBadge';
import { useIdbTable } from '@/hooks/useIdbTable';
import { useBodyStore } from '@/stores/bodyStore';
import { BODY_SHAPE_LABEL } from '@/types/body';
import {
  INLAY_PATTERN_OPTIONS,
  INLAY_POSITION_OPTIONS,
  INLAY_TYPE_COLOR,
  INLAY_TYPE_LABEL,
  INLAY_TYPE_OPTIONS,
  createEmptyInlayDraft,
  type Inlay,
  type InlayDraft,
  type InlayType,
} from '@/types/inlay';

const FILTER_KEYS = ['type', 'position'] as const;

const FILTER_SELECTS: ReadonlyArray<FilterSelectConfig> = [
  { key: 'type', label: '镶嵌类型', options: INLAY_TYPE_OPTIONS },
  { key: 'position', label: '位置', options: INLAY_POSITION_OPTIONS.map((item) => ({ value: item, label: item })) },
];

/** 位置 → 器型示意区中的坐标（百分比） */
const POSITION_COORDS: Record<string, { left: string; top: string }> = {
  外壁: { left: '8%', top: '46%' },
  内壁: { left: '46%', top: '52%' },
  盖面: { left: '40%', top: '8%' },
  底足: { left: '40%', top: '82%' },
  口沿: { left: '58%', top: '30%' },
  通体: { left: '40%', top: '66%' },
};

export default function InlayBoard() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<InlayDraft>();
  const inlayTable = useIdbTable<Inlay>((database) => database.inlays, { sortByUpdatedAt: false });

  const bodies = useBodyStore((state) => state.bodies);
  const currentBodyId = useBodyStore((state) => state.currentBodyId);
  const setCurrentBodyId = useBodyStore((state) => state.setCurrentBodyId);

  const url = useFilterQuery(FILTER_KEYS);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Inlay | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchType, setBatchType] = useState<InlayType>('nacre');

  const activeBody = bodies.find((body) => body.id === currentBodyId) ?? bodies[0] ?? null;
  const bodyId = activeBody?.id ?? '';

  const filtered = useMemo(() => {
    const keyword = url.keyword.trim();
    const types = url.values.type ?? [];
    const positions = url.values.position ?? [];
    return inlayTable.rows.filter((row) => {
      if (keyword.length > 0) {
        const haystack = `${row.pattern}${row.materialNote}${row.position}`;
        if (!haystack.includes(keyword)) return false;
      }
      if (types.length > 0 && !types.includes(row.type)) return false;
      if (positions.length > 0 && !positions.includes(row.position)) return false;
      return true;
    });
  }, [inlayTable.rows, url.keyword, url.values]);

  const bodyInlays = useMemo(() => filtered.filter((row) => row.bodyId === bodyId), [filtered, bodyId]);

  const openCreate = (): void => {
    if (!bodyId) {
      message.warning('请先登记胎体');
      return;
    }
    setEditing(null);
    form.setFieldsValue(createEmptyInlayDraft(bodyId));
    setOpen(true);
  };

  const openEdit = (row: Inlay): void => {
    setEditing(row);
    form.setFieldsValue({
      bodyId: row.bodyId,
      type: row.type,
      pattern: row.pattern,
      position: row.position,
      materialNote: row.materialNote,
    });
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    if (editing) {
      await inlayTable.update(editing.id, values);
      message.success('已更新镶嵌登记');
    } else {
      await inlayTable.create(values, 'inlay');
      message.success('已新增镶嵌登记');
    }
    setOpen(false);
  };

  const columns: ColumnsType<Inlay> = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      filters: INLAY_TYPE_OPTIONS.map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value, record) => record.type === value,
      render: (value: InlayType) => <Tag color={INLAY_TYPE_COLOR[value]}>{INLAY_TYPE_LABEL[value]}</Tag>,
    },
    { title: '图案', dataIndex: 'pattern', width: 140 },
    { title: '位置', dataIndex: 'position', width: 100, render: (value: string) => <Tag>{value}</Tag> },
    {
      title: '所属胎体',
      dataIndex: 'bodyId',
      width: 130,
      render: (value: string) => bodies.find((body) => body.id === value)?.code ?? value,
    },
    {
      title: '材料与工艺',
      dataIndex: 'materialNote',
      render: (value: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {value || '未填写'}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 170,
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="删除该镶嵌记录"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void inlayTable.remove(record.id).then(() => message.success('已删除'))}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const typeCount = useMemo(() => {
    const result: Record<string, number> = {};
    inlayTable.rows.forEach((row) => {
      result[row.type] = (result[row.type] ?? 0) + 1;
    });
    return result;
  }, [inlayTable.rows]);

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>镶嵌纹饰登记</h2>
          <p>登记螺钿、蛋壳、描金、戗金纹饰与位置，并在器型示意区叠加检视；支持批量调整图案分类。</p>
        </div>
        <Space wrap>
          <Select
            style={{ minWidth: 220 }}
            placeholder="选择胎体"
            value={bodyId || undefined}
            options={bodies.map((body) => ({
              value: body.id,
              label: `${body.code} · ${BODY_SHAPE_LABEL[body.shape]}`,
            }))}
            onChange={(value: string) => setCurrentBodyId(value)}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增镶嵌
          </Button>
        </Space>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="镶嵌总数" value={inlayTable.rows.length} suffix="条" tone="primary" />
        <StatBadge label="螺钿" value={typeCount.nacre ?? 0} suffix="条" tone="info" />
        <StatBadge label="蛋壳" value={typeCount.eggshell ?? 0} suffix="条" />
        <StatBadge label="描金" value={typeCount.goldTrace ?? 0} suffix="条" tone="warning" />
        <StatBadge label="戗金" value={typeCount.incisedGold ?? 0} suffix="条" tone="danger" />
      </div>

      <FilterBar
        keyword={url.keyword}
        onKeywordChange={url.setKeyword}
        selects={FILTER_SELECTS}
        values={url.values}
        onValuesChange={url.setValues}
        onReset={url.reset}
        keywordPlaceholder="搜索图案 / 材料备注…"
        actions={
          <Space size={6} wrap>
            <Select
              size="small"
              style={{ width: 130 }}
              value={batchType}
              options={[...INLAY_TYPE_OPTIONS]}
              onChange={(value: InlayType) => setBatchType(value)}
            />
            <Button
              size="small"
              disabled={selectedIds.length === 0}
              onClick={() => {
                const now = Date.now();
                const rows = inlayTable.rows
                  .filter((row) => selectedIds.includes(row.id))
                  .map((row) => ({ ...row, type: batchType, updatedAt: now }));
                void inlayTable.bulkPut(rows).then(() => {
                  message.success(`已批量改为${INLAY_TYPE_LABEL[batchType]}`);
                  setSelectedIds([]);
                });
              }}
            >
              批量调整分类
            </Button>
          </Space>
        }
      />

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}>
          <Card title={`器型示意 · ${activeBody ? activeBody.code : '未选择'}`} size="small">
            <div className="gb-vessel">
              <div className={`gb-vessel__shape is-${activeBody?.shape ?? 'bowl'}`} />
              {bodyInlays.map((row, index) => {
                const coord = POSITION_COORDS[row.position] ?? { left: '30%', top: `${20 + index * 12}%` };
                return (
                  <span
                    key={row.id}
                    className="gb-vessel__mark"
                    style={{ left: coord.left, top: coord.top, color: INLAY_TYPE_COLOR[row.type] }}
                  >
                    {INLAY_TYPE_LABEL[row.type]}·{row.pattern}
                  </span>
                );
              })}
            </div>
            <div className="gb-vessel__legend">
              {bodyInlays.length === 0 ? (
                <Typography.Text type="secondary">该胎体暂无镶嵌纹饰</Typography.Text>
              ) : (
                bodyInlays.map((row) => (
                  <Tag key={row.id} color={INLAY_TYPE_COLOR[row.type]}>
                    {row.position} · {INLAY_TYPE_LABEL[row.type]}
                  </Tag>
                ))
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card className="gb-table-card" styles={{ body: { padding: 0 } }}>
            {filtered.length === 0 ? (
              <EmptyPanel
                title={inlayTable.rows.length === 0 ? '还没有镶嵌登记' : '当前条件下没有记录'}
                description={
                  inlayTable.rows.length === 0
                    ? '登记第一处螺钿或蛋壳纹饰，填写图案、位置与材料工艺备注。'
                    : '试着调整镶嵌类型或位置筛选。'
                }
                actionText="新增镶嵌"
                onAction={openCreate}
                secondaryText="重置筛选"
                onSecondary={url.reset}
                size="small"
              />
            ) : (
              <Table<Inlay>
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8 }}
                columns={columns}
                dataSource={filtered}
                rowSelection={{
                  selectedRowKeys: selectedIds,
                  onChange: (keys) => setSelectedIds(keys.map((key) => String(key))),
                }}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={open}
        title={editing ? '编辑镶嵌登记' : '新增镶嵌登记'}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="bodyId" label="所属胎体" rules={[{ required: true }]}>
            <Select
              options={bodies.map((body) => ({
                value: body.id,
                label: `${body.code} · ${BODY_SHAPE_LABEL[body.shape]}`,
              }))}
            />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="type" label="镶嵌类型" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[...INLAY_TYPE_OPTIONS]} />
            </Form.Item>
            <Form.Item name="position" label="位置" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={INLAY_POSITION_OPTIONS.map((item) => ({ value: item, label: item }))} />
            </Form.Item>
          </Space>
          <Form.Item name="pattern" label="图案" rules={[{ required: true, message: '请填写图案名' }]}>
            <Select
              showSearch
              placeholder="如：缠枝莲"
              options={INLAY_PATTERN_OPTIONS.map((item) => ({ value: item, label: item }))}
            />
          </Form.Item>
          <Form.Item name="materialNote" label="材料与工艺备注">
            <Input.TextArea rows={3} placeholder="如：0.8mm 螺钿片，刻纹嵌贴后磨显" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
