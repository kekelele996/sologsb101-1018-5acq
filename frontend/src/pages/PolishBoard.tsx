/**
 * /polish 打磨与推光工序录入
 * 按道次生成目数序列，未打磨完的道次禁止进入下一道罩漆。
 * 消费 Polish、Coat；复用 <StageTag>、<StatBadge>、<EmptyPanel>。
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import StatBadge from '@/components/common/StatBadge';
import StageTag from '@/components/common/StageTag';
import { useCoatProgress } from '@/hooks/useCoatProgress';
import { useIdbTable } from '@/hooks/useIdbTable';
import { useBodyStore } from '@/stores/bodyStore';
import { useCoatStore } from '@/stores/coatStore';
import {
  GRIT_SEQUENCE,
  POLISH_METHOD_COLOR,
  POLISH_METHOD_LABEL,
  POLISH_METHOD_OPTIONS,
  createEmptyPolishDraft,
  suggestGrit,
  type Polish,
  type PolishDraft,
  type PolishMethod,
} from '@/types/polish';
import { BODY_SHAPE_LABEL } from '@/types/body';

export default function PolishBoard() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<PolishDraft>();
  const polishTable = useIdbTable<Polish>((database) => database.polishes, { sortByUpdatedAt: false });

  const bodies = useBodyStore((state) => state.bodies);
  const currentBodyId = useBodyStore((state) => state.currentBodyId);
  const setCurrentBodyId = useBodyStore((state) => state.setCurrentBodyId);
  const coats = useCoatStore((state) => state.coats);
  const updateCoat = useCoatStore((state) => state.updateCoat);
  const { progressOf } = useCoatProgress();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Polish | null>(null);

  const activeBody = bodies.find((body) => body.id === currentBodyId) ?? bodies[0] ?? null;
  const bodyId = activeBody?.id ?? '';

  const bodyCoats = useMemo(
    () => coats.filter((coat) => coat.bodyId === bodyId).sort((a, b) => a.seq - b.seq),
    [coats, bodyId],
  );

  const rows = useMemo(
    () =>
      polishTable.rows
        .filter((row) => row.bodyId === bodyId)
        .sort((a, b) => (a.seq === b.seq ? a.grit - b.grit : a.seq - b.seq)),
    [polishTable.rows, bodyId],
  );

  /** 已涂但尚未打磨的道次：未打磨完禁止进入下一道罩漆 */
  const blocked = useMemo(
    () =>
      bodyCoats.filter(
        (coat) => coat.state === 'toPolish' && !rows.some((row) => row.seq === coat.seq),
      ),
    [bodyCoats, rows],
  );

  const stat = bodyId ? progressOf(bodyId) : null;
  const totalMinutes = rows.reduce((sum, row) => sum + row.durationMin, 0);
  const maxGrit = rows.reduce((max, row) => Math.max(max, row.grit), 0);

  const openCreate = (): void => {
    if (!bodyId) {
      message.warning('请先选择胎体');
      return;
    }
    const nextSeq = bodyCoats.length === 0 ? 1 : Math.max(...bodyCoats.map((coat) => coat.seq));
    setEditing(null);
    form.setFieldsValue(createEmptyPolishDraft(bodyId, nextSeq));
    setOpen(true);
  };

  const openEdit = (row: Polish): void => {
    setEditing(row);
    form.setFieldsValue({
      bodyId: row.bodyId,
      seq: row.seq,
      grit: row.grit,
      method: row.method,
      durationMin: row.durationMin,
      operator: row.operator,
    });
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    if (editing) {
      await polishTable.update(editing.id, values);
      message.success('已更新打磨记录');
    } else {
      await polishTable.create(values, 'polish');
      message.success('已新增打磨记录');
    }
    setOpen(false);
  };

  /** 按道次生成目数序列：为每个尚无打磨记录的道次生成一条建议记录 */
  const generateSequence = async (): Promise<void> => {
    const targets = bodyCoats.filter((coat) => !rows.some((row) => row.seq === coat.seq));
    if (targets.length === 0) {
      message.info('所有道次均已有打磨记录');
      return;
    }
    for (const coat of targets) {
      await polishTable.create(
        {
          bodyId,
          seq: coat.seq,
          grit: suggestGrit(coat.seq),
          method: coat.seq >= 3 ? 'burnish' : 'water',
          durationMin: 30 + coat.seq * 5,
          operator: '',
        },
        'polish',
      );
    }
    message.success(`已按 ${targets.length} 个道次生成目数序列（${GRIT_SEQUENCE.slice(0, targets.length).join(' / ')}）`);
  };

  /** 打磨完成后把道次推进到已完成 */
  const finishPolish = async (row: Polish): Promise<void> => {
    const coat = bodyCoats.find((item) => item.seq === row.seq);
    if (!coat) {
      message.warning('未找到对应道次');
      return;
    }
    await updateCoat(coat.id, { state: 'done', needRecheck: false });
    message.success(`第 ${row.seq} 道打磨完成，道次已置为已完成`);
  };

  const columns: ColumnsType<Polish> = [
    {
      title: '关联道次',
      dataIndex: 'seq',
      width: 120,
      render: (seq: number) => {
        const coat = bodyCoats.find((item) => item.seq === seq);
        return coat ? <StageTag state={coat.state} seq={seq} needRecheck={coat.needRecheck} /> : `第 ${seq} 道`;
      },
    },
    { title: '磨料目数', dataIndex: 'grit', width: 110, render: (value: number) => <Tag color="gold">{value} 目</Tag> },
    {
      title: '手法',
      dataIndex: 'method',
      width: 100,
      render: (value: PolishMethod) => <Tag color={POLISH_METHOD_COLOR[value]}>{POLISH_METHOD_LABEL[value]}</Tag>,
    },
    { title: '耗时', dataIndex: 'durationMin', width: 100, render: (value: number) => `${value} 分钟` },
    { title: '操作人', dataIndex: 'operator', width: 110, render: (value: string) => value || '未填写' },
    {
      title: '操作',
      key: 'action',
      width: 250,
      render: (_value, record) => (
        <Space size={4} wrap>
          <Tooltip title="打磨完成并回写道次状态">
            <Button size="small" type="link" onClick={() => void finishPolish(record)}>
              完成打磨
            </Button>
          </Tooltip>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="删除该打磨记录"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void polishTable.remove(record.id).then(() => message.success('已删除'))}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>打磨与推光工序</h2>
          <p>按道次生成目数序列并登记手法与耗时；未打磨完的道次禁止进入下一道罩漆。</p>
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
          <Button icon={<ThunderboltOutlined />} onClick={() => void generateSequence()}>
            按道次生成序列
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增打磨记录
          </Button>
        </Space>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="打磨记录" value={rows.length} suffix="条" tone="primary" />
        <StatBadge label="累计耗时" value={totalMinutes} suffix="分钟" tone="info" />
        <StatBadge label="最高目数" value={maxGrit || '-'} suffix="目" tone="warning" />
        <StatBadge label="道次完成率" value={`${stat?.coatPercent ?? 0}%`} percent={stat?.coatPercent ?? 0} tone="success" />
        <StatBadge label="阻塞道次" value={blocked.length} suffix="道" tone="danger" />
      </div>

      {blocked.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={`第 ${blocked.map((coat) => coat.seq).join('、')} 道尚未打磨完成，禁止进入下一道罩漆`}
          description="请先补登打磨记录并点击「完成打磨」，把道次推进为已完成。"
        />
      ) : (
        <Alert type="success" showIcon style={{ marginBottom: 14 }} message="当前胎体道次打磨均已闭环，可继续下一道罩漆" />
      )}

      <Card className="gb-table-card" styles={{ body: { padding: 0 } }}>
        {rows.length === 0 ? (
          <EmptyPanel
            title={bodyCoats.length === 0 ? '该胎体尚未编排道次' : '还没有打磨记录'}
            description={
              bodyCoats.length === 0
                ? '先到「髹涂道次」页编排道次，再按道次生成打磨目数序列。'
                : '可点击「按道次生成序列」按 320→2000 目自动铺排，再逐条补录操作人。'
            }
            actionText="按道次生成序列"
            onAction={() => void generateSequence()}
            secondaryText="新增打磨记录"
            onSecondary={openCreate}
            size="small"
          />
        ) : (
          <Table<Polish> rowKey="id" size="small" pagination={{ pageSize: 8 }} columns={columns} dataSource={rows} />
        )}
      </Card>

      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 10 }}>
        标准目数序列：{GRIT_SEQUENCE.join(' → ')} 目；当前胎体打磨 {rows.length} 条记录。
      </Typography.Text>

      <Modal
        open={open}
        title={editing ? `编辑第 ${editing.seq} 道打磨记录` : '新增打磨记录'}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="seq" label="关联道次" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select
                options={(bodyCoats.length > 0
                  ? bodyCoats.map((coat) => ({ value: coat.seq, label: `第 ${coat.seq} 道 · ${coat.colorName}` }))
                  : [{ value: 1, label: '第 1 道' }]
                )}
              />
            </Form.Item>
            <Form.Item name="grit" label="磨料目数" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={GRIT_SEQUENCE.map((grit) => ({ value: grit, label: `${grit} 目` }))} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="method" label="手法" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[...POLISH_METHOD_OPTIONS]} />
            </Form.Item>
            <Form.Item name="durationMin" label="耗时（分钟）" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={1} max={600} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="operator" label="操作人">
            <Input placeholder="如：王丽" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
