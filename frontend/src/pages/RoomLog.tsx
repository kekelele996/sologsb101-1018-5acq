/**
 * /rooms 荫房值班
 * 两块职责：
 *  1. 架位占用：入荫申请排队、固定容量架位分配、出房登记后空位给队首、退回重试（只写荫房侧）。
 *  2. 荫房温湿度记录：按区间判定适宜 / 偏干 / 偏湿；偏干偏湿由髹涂组自行同步道次待复检。
 * 消费 Room、DryingEntry、Body；不写髹涂道次。复用 <FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { useEffect, useMemo, useState } from 'react';
import {
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
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  EditOutlined,
  LoginOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import FilterBar, { useFilterQuery, type FilterSelectConfig } from '@/components/common/FilterBar';
import StatBadge from '@/components/common/StatBadge';
import { useBodyStore } from '@/stores/bodyStore';
import { useRoomStore } from '@/stores/roomStore';
import {
  ROOM_VERDICT_COLOR,
  ROOM_VERDICT_LABEL,
  ROOM_VERDICT_OPTIONS,
  createEmptyRoomDraft,
  type Room,
  type RoomDraft,
  type RoomVerdict,
} from '@/types/room';
import { BODY_SHAPE_LABEL } from '@/types/body';
import { RACK_CAPACITY, type DryingEntry } from '@/types/drying';
import { dewPoint, dryingAdvice, dryingHours, judgeVerdict, rangeHint, roomStayHours } from '@/utils/humidity';

const FILTER_KEYS = ['verdict'] as const;

const FILTER_SELECTS: ReadonlyArray<FilterSelectConfig> = [
  { key: 'verdict', label: '判定', options: ROOM_VERDICT_OPTIONS },
];

export default function RoomLog() {
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<RoomDraft>();
  const [applyForm] = Form.useForm<{ bodyId: string }>();
  const [rejectForm] = Form.useForm<{ reason: string }>();

  const bodies = useBodyStore((state) => state.bodies);
  const rooms = useRoomStore((state) => state.rooms);
  const dryingEntries = useRoomStore((state) => state.dryingEntries);
  const loadDryingEntries = useRoomStore((state) => state.loadDryingEntries);
  const createRoom = useRoomStore((state) => state.createRoom);
  const updateRoom = useRoomStore((state) => state.updateRoom);
  const removeRoom = useRoomStore((state) => state.removeRoom);
  const applyForEntry = useRoomStore((state) => state.applyForEntry);
  const registerExit = useRoomStore((state) => state.registerExit);
  const rejectEntry = useRoomStore((state) => state.rejectEntry);
  const retryEntry = useRoomStore((state) => state.retryEntry);

  const url = useFilterQuery(FILTER_KEYS);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<DryingEntry | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [draftTemp, setDraftTemp] = useState(24);
  const [draftHumidity, setDraftHumidity] = useState(75);

  useEffect(() => {
    void loadDryingEntries();
  }, [loadDryingEntries]);

  const bodyCode = (bodyId: string): string => bodies.find((body) => body.id === bodyId)?.code ?? bodyId;

  const latestRoomOfBody = (bodyId: string): Room | undefined =>
    rooms
      .filter((room) => room.bodyId === bodyId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];

  /** 某条排队申请前面还压着几件（直接从当前列表派生，保证响应式） */
  const aheadOf = (entryId: string): number => {
    const entry = dryingEntries.find((item) => item.id === entryId);
    if (!entry || entry.status !== 'queued') return 0;
    return dryingEntries.filter((item) => item.status === 'queued' && item.queueNo < entry.queueNo).length;
  };

  const inRoomList = useMemo(
    () => dryingEntries.filter((entry) => entry.status === 'inRoom').sort((a, b) => (a.slotNo ?? 0) - (b.slotNo ?? 0)),
    [dryingEntries],
  );
  const queuedList = useMemo(
    () => dryingEntries.filter((entry) => entry.status === 'queued').sort((a, b) => a.queueNo - b.queueNo),
    [dryingEntries],
  );
  const rejectedList = useMemo(
    () => dryingEntries.filter((entry) => entry.status === 'rejected').sort((a, b) => b.updatedAt - a.updatedAt),
    [dryingEntries],
  );
  const occupied = inRoomList.length;

  const filtered = useMemo(() => {
    const keyword = url.keyword.trim();
    const verdicts = url.values.verdict ?? [];
    return rooms.filter((room) => {
      if (keyword.length > 0) {
        const haystack = `${bodyCode(room.bodyId)}${room.date}${room.tempC}${room.humidityPct}`;
        if (!haystack.includes(keyword)) return false;
      }
      if (verdicts.length > 0 && !verdicts.includes(room.verdict)) return false;
      if (dateFrom.length > 0 && room.date < dateFrom) return false;
      if (dateTo.length > 0 && room.date > dateTo) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, url.keyword, url.values, dateFrom, dateTo, bodies]);

  const stat = useMemo(() => {
    const total = rooms.length;
    const suitable = rooms.filter((room) => room.verdict === 'suitable').length;
    const dry = rooms.filter((room) => room.verdict === 'dry').length;
    const wet = rooms.filter((room) => room.verdict === 'wet').length;
    const avgHumidity =
      total === 0 ? 0 : Math.round(rooms.reduce((sum, room) => sum + room.humidityPct, 0) / total);
    return {
      total,
      suitable,
      dry,
      wet,
      over: dry + wet,
      suitablePercent: total === 0 ? 0 : Math.round((suitable / total) * 100),
      avgHumidity,
    };
  }, [rooms]);

  const openCreate = (): void => {
    const bodyId = bodies[0]?.id ?? '';
    if (!bodyId) {
      message.warning('请先在胎体台账中登记胎体');
      return;
    }
    setEditing(null);
    const draft = createEmptyRoomDraft(bodyId);
    setDraftTemp(draft.tempC);
    setDraftHumidity(draft.humidityPct);
    form.setFieldsValue(draft);
    setOpen(true);
  };

  const openEdit = (room: Room): void => {
    setEditing(room);
    setDraftTemp(room.tempC);
    setDraftHumidity(room.humidityPct);
    form.setFieldsValue(room);
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    const verdict = judgeVerdict(values.tempC, values.humidityPct);
    if (editing) {
      await updateRoom(editing.id, values);
      message.success(`已更新 ${values.date} 的荫房记录（判定：${ROOM_VERDICT_LABEL[verdict]}）`);
    } else {
      await createRoom(values);
      if (verdict === 'suitable') {
        message.success('已记录荫房温湿度，环境适宜');
      } else {
        message.warning(`判定为${ROOM_VERDICT_LABEL[verdict]}，已记录；关联道次转待复检，等髹涂组处理`);
      }
    }
    setOpen(false);
  };

  const openApply = (): void => {
    if (bodies.length === 0) {
      message.warning('请先在胎体台账中登记胎体');
      return;
    }
    applyForm.resetFields();
    setApplyOpen(true);
  };

  const submitApply = async (): Promise<void> => {
    const values = await applyForm.validateFields();
    const result = await applyForEntry(values.bodyId);
    if (!result.ok) {
      if (result.retryable) {
        modal.confirm({
          title: '入荫失败，已回滚本次申请',
          content: `${result.reason ?? '未知原因'}。已入房的胎体不受影响，可重试本次申请。`,
          okText: '重试',
          cancelText: '取消',
          onOk: () => void submitApply(),
        });
      } else {
        message.warning(result.reason ?? '入荫失败');
      }
      return;
    }
    setApplyOpen(false);
    if (result.checkedIn) {
      message.success(`已分配架位，入房成功（架位 ${result.entry?.slotNo ?? '-'} 号）`);
    } else {
      message.warning(`架位已满，已排队：前面还压着 ${result.aheadCount ?? 0} 件`);
    }
  };

  const handleExit = (entry: DryingEntry): void => {
    void registerExit(entry.id).then((result) => {
      if (!result.ok) {
        message.warning(result.reason ?? '出房登记失败');
        return;
      }
      const promoted = result.promoted ? `；空位已给队首 ${bodyCode(result.promoted.bodyId)}` : '';
      message.success(`已出房（架位 ${result.freedSlot} 号）${promoted}`);
    });
  };

  const submitReject = async (): Promise<void> => {
    if (!rejectTarget) return;
    const values = await rejectForm.validateFields();
    await rejectEntry(rejectTarget.id, values.reason ?? '');
    message.success('已退回该申请');
    setRejectTarget(null);
  };

  const handleRetry = (entry: DryingEntry): void => {
    void retryEntry(entry.id).then((result) => {
      if (!result.ok) {
        message.warning(result.reason ?? '重试失败');
        return;
      }
      if (result.checkedIn) message.success(`已重新分配架位（${result.entry?.slotNo ?? '-'} 号）`);
      else message.warning(`已重新排队，前面还压着 ${result.aheadCount ?? 0} 件`);
    });
  };

  const inRoomColumns: ColumnsType<DryingEntry> = [
    { title: '架位', dataIndex: 'slotNo', width: 70, render: (value: number | null) => <Tag color="#2f6f4f">{value} 号</Tag> },
    { title: '胎体', dataIndex: 'bodyId', width: 130, render: (value: string) => <Tag color="#8c2f1f">{bodyCode(value)}</Tag> },
    { title: '入房时间', dataIndex: 'inAt', width: 150 },
    {
      title: '最近判定',
      key: 'verdict',
      width: 120,
      render: (_value, record) => {
        const room = latestRoomOfBody(record.bodyId);
        return room ? <Tag color={ROOM_VERDICT_COLOR[room.verdict]}>{ROOM_VERDICT_LABEL[room.verdict]}</Tag> : <Typography.Text type="secondary">暂无</Typography.Text>;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_value, record) => (
        <Popconfirm
          title="出房登记"
          description="登记后空位自动给队首申请。"
          okText="确认出房"
          cancelText="取消"
          onConfirm={() => handleExit(record)}
        >
          <Button size="small" type="link" icon={<LogoutOutlined />}>
            出房登记
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const queuedColumns: ColumnsType<DryingEntry> = [
    { title: '排队序', dataIndex: 'queueNo', width: 80, render: (value: number) => <Tag>{value}</Tag> },
    { title: '胎体', dataIndex: 'bodyId', width: 130, render: (value: string) => <Tag color="#8c2f1f">{bodyCode(value)}</Tag> },
    {
      title: '前面还压着',
      key: 'ahead',
      width: 140,
      render: (_value, record) => {
        const ahead = aheadOf(record.id);
        return ahead === 0 ? <Tag color="#2f6f4f">队首</Tag> : <Tag color="#c9963c">{ahead} 件</Tag>;
      },
    },
    { title: '申请时间', dataIndex: 'createdAt', width: 110, render: (value: number) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) },
    {
      title: '操作',
      key: 'action',
      render: (_value, record) => (
        <Button size="small" type="link" danger onClick={() => { setRejectTarget(record); rejectForm.resetFields(); }}>
          退回
        </Button>
      ),
    },
  ];

  const rejectedColumns: ColumnsType<DryingEntry> = [
    { title: '排队序', dataIndex: 'queueNo', width: 80, render: (value: number) => <Tag>{value}</Tag> },
    { title: '胎体', dataIndex: 'bodyId', width: 130, render: (value: string) => <Tag color="#8c2f1f">{bodyCode(value)}</Tag> },
    { title: '退回原因', dataIndex: 'rejectReason', render: (value: string) => <Typography.Text type="secondary">{value || '—'}</Typography.Text> },
    {
      title: '操作',
      key: 'action',
      render: (_value, record) => (
        <Button size="small" type="link" icon={<ReloadOutlined />} onClick={() => handleRetry(record)}>
          重试
        </Button>
      ),
    },
  ];

  const columns: ColumnsType<Room> = [
    { title: '日期', dataIndex: 'date', width: 120, sorter: (a, b) => a.date.localeCompare(b.date) },
    {
      title: '胎体',
      dataIndex: 'bodyId',
      width: 120,
      render: (value: string) => <Tag color="#8c2f1f">{bodyCode(value)}</Tag>,
    },
    { title: '温度', dataIndex: 'tempC', width: 90, render: (value: number) => `${value} ℃` },
    { title: '湿度', dataIndex: 'humidityPct', width: 90, render: (value: number) => `${value} %` },
    { title: '入房', dataIndex: 'inAt', width: 90 },
    { title: '出房', dataIndex: 'outAt', width: 90 },
    {
      title: '在房时长',
      key: 'stay',
      width: 110,
      render: (_value, record) => `${roomStayHours(record.inAt, record.outAt)} 小时`,
    },
    {
      title: '判定',
      dataIndex: 'verdict',
      width: 110,
      filters: ROOM_VERDICT_OPTIONS.map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value, record) => record.verdict === value,
      render: (value: RoomVerdict, record) => (
        <Space size={4} wrap>
          <Tag color={ROOM_VERDICT_COLOR[value]}>{ROOM_VERDICT_LABEL[value]}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            露点 {dewPoint(record.tempC, record.humidityPct)}℃
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '荫干建议',
      key: 'advice',
      render: (_value, record) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {dryingAdvice(record.tempC, record.humidityPct, 40)}
          （预计 {dryingHours(record.tempC, record.humidityPct, 40)} 小时）
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_value, record) => (
        <Space size={4} wrap>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="删除该荫房记录"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void removeRoom(record.id).then(() => message.success('已删除'))}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const previewVerdict = judgeVerdict(draftTemp, draftHumidity);
  const availableBodies = bodies.filter(
    (body) => !dryingEntries.some((entry) => entry.bodyId === body.id && (entry.status === 'queued' || entry.status === 'inRoom')),
  );

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>荫房值班</h2>
          <p>
            管荫房记录与架位占用（容量 {RACK_CAPACITY} 位，固定）；入荫申请按先后排队，满位写明前面还压着几件，出房后空位给队首。
            温湿度越界由髹涂组自行处理道次。{rangeHint()}。
          </p>
        </div>
        <Space wrap>
          <Button icon={<LoginOutlined />} onClick={openApply}>
            入荫申请
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增温湿度记录
          </Button>
        </Space>
      </div>

      <Card className="gb-table-card" styles={{ body: { padding: 16 } }}>
        <div className="gb-stat-row" style={{ marginBottom: 12 }}>
          <StatBadge label="架位容量" value={RACK_CAPACITY} suffix="位" tone="primary" />
          <StatBadge label="在房占用" value={occupied} suffix="位" tone="success" />
          <StatBadge label="空位" value={RACK_CAPACITY - occupied} suffix="位" tone="info" />
          <StatBadge label="排队" value={queuedList.length} suffix="件" tone="warning" />
        </div>

        <Typography.Title level={5} style={{ marginTop: 0 }}>
          在房（{inRoomList.length}）
        </Typography.Title>
        {inRoomList.length === 0 ? (
          <EmptyPanel title="荫房暂无胎体" description="有空位时，入荫申请会直接分配架位。" size="small" />
        ) : (
          <Table<DryingEntry>
            rowKey="id"
            size="small"
            pagination={false}
            columns={inRoomColumns}
            dataSource={inRoomList}
            style={{ marginBottom: 16 }}
          />
        )}

        <Typography.Title level={5}>排队（{queuedList.length}）</Typography.Title>
        {queuedList.length === 0 ? (
          <EmptyPanel title="没有排队申请" description="架位全空时申请即入房；满位后按先后排队，出房后空位给队首。" size="small" />
        ) : (
          <Table<DryingEntry>
            rowKey="id"
            size="small"
            pagination={false}
            columns={queuedColumns}
            dataSource={queuedList}
            style={{ marginBottom: 16 }}
          />
        )}

        {rejectedList.length > 0 ? (
          <>
            <Typography.Title level={5}>已退回（{rejectedList.length}）</Typography.Title>
            <Table<DryingEntry>
              rowKey="id"
              size="small"
              pagination={false}
              columns={rejectedColumns}
              dataSource={rejectedList}
            />
          </>
        ) : null}
      </Card>

      <div className="gb-stat-row" style={{ marginTop: 16 }}>
        <StatBadge label="记录总数" value={stat.total} suffix="条" tone="primary" />
        <StatBadge label="适宜占比" value={`${stat.suitablePercent}%`} percent={stat.suitablePercent} tone="success" />
        <StatBadge label="超标次数" value={stat.over} suffix="次" tone="danger" />
        <StatBadge label="偏干" value={stat.dry} suffix="次" tone="warning" />
        <StatBadge label="偏湿" value={stat.wet} suffix="次" tone="info" />
        <StatBadge label="平均湿度" value={stat.avgHumidity} suffix="%" />
      </div>

      <FilterBar
        keyword={url.keyword}
        onKeywordChange={url.setKeyword}
        selects={FILTER_SELECTS}
        values={url.values}
        onValuesChange={url.setValues}
        onReset={() => {
          url.reset();
          setDateFrom('');
          setDateTo('');
        }}
        keywordPlaceholder="搜索编号 / 日期 / 温湿度…"
        actions={
          <Space size={6} wrap>
            <Input
              type="date"
              size="small"
              style={{ width: 150 }}
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <Typography.Text type="secondary">至</Typography.Text>
            <Input
              type="date"
              size="small"
              style={{ width: 150 }}
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </Space>
        }
      />

      <Card className="gb-table-card" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
        {filtered.length === 0 ? (
          <EmptyPanel
            title={rooms.length === 0 ? '还没有荫房记录' : '当前条件下没有记录'}
            description={
              rooms.length === 0
                ? '每次入荫房时登记温度、湿度与出入房时间；判定越界由髹涂组处理道次。'
                : '试着调整判定或日期区间。'
            }
            actionText="新增温湿度记录"
            onAction={openCreate}
            secondaryText="重置筛选"
            onSecondary={() => {
              url.reset();
              setDateFrom('');
              setDateTo('');
            }}
            size="small"
          />
        ) : (
          <Table<Room> rowKey="id" size="small" pagination={{ pageSize: 8 }} columns={columns} dataSource={filtered} />
        )}
      </Card>

      <Modal
        open={applyOpen}
        title="入荫申请"
        onCancel={() => setApplyOpen(false)}
        onOk={() => void submitApply()}
        okText="提交申请"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={applyForm} layout="vertical">
          <Form.Item name="bodyId" label="申请胎体" rules={[{ required: true, message: '请选择胎体' }]}>
            <Select
              placeholder="选择要入荫房的胎体"
              options={availableBodies.map((body) => ({
                value: body.id,
                label: `${body.code} · ${BODY_SHAPE_LABEL[body.shape]}`,
              }))}
            />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            容量 {RACK_CAPACITY} 位；有空位即分配架位，满位则按先后排队，前面压着的件数会在提交后提示。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        open={!!rejectTarget}
        title="退回入荫申请"
        onCancel={() => setRejectTarget(null)}
        onOk={() => void submitReject()}
        okText="确认退回"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item name="reason" label="退回原因" rules={[{ required: true, message: '请填写退回原因' }]}>
            <Input.TextArea rows={3} placeholder="如：架位已满，待有空位后重试" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={open}
        title={editing ? `编辑 ${editing.date} 的荫房记录` : '新增荫房记录'}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false} onValuesChange={(changed) => {
          if (typeof changed.tempC === 'number') setDraftTemp(changed.tempC);
          if (typeof changed.humidityPct === 'number') setDraftHumidity(changed.humidityPct);
        }}>
          <Form.Item name="bodyId" label="关联胎体" rules={[{ required: true, message: '请选择胎体' }]}>
            <Select
              options={bodies.map((body) => ({
                value: body.id,
                label: `${body.code} · ${BODY_SHAPE_LABEL[body.shape]}`,
              }))}
            />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="date" label="记录日期" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="inAt" label="入房时间" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="time" />
            </Form.Item>
            <Form.Item name="outAt" label="出房时间" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="time" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="tempC" label="温度（℃）" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={5} max={45} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="humidityPct" label="湿度（%）" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={10} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space direction="vertical" size={2}>
            <Tag color={ROOM_VERDICT_COLOR[previewVerdict]}>实时判定：{ROOM_VERDICT_LABEL[previewVerdict]}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              露点约 {dewPoint(draftTemp, draftHumidity)}℃ · 在房 {roomStayHours(form.getFieldValue('inAt') ?? '09:00', form.getFieldValue('outAt') ?? '21:00')} 小时
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {dryingAdvice(draftTemp, draftHumidity, 40)}
            </Typography.Text>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
