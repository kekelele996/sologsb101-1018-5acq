/**
 * /rooms 荫房值班台
 * 本侧只管两件事：温湿度记录（rooms）与架位占用 / 入荫排队（roomAdmissions）。
 * - 架位容量固定，入荫按申请先后排队，满位时写明前面还压着几件
 * - 出房登记温湿度后释放架位，空位自动给队首
 * - 温湿度判成偏干 / 偏湿只记录判定；涉及道次由髹涂组侧订阅后回到待复检处理
 * 消费 Room、Admission（只读 Body 取编号 / 器型）；复用 <FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
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
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
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
import {
  ROOM_SHELF_CAPACITY,
  createEmptyAdmissionDraft,
  type Admission,
  type AdmissionDraft,
} from '@/types/admission';
import { BODY_SHAPE_LABEL } from '@/types/body';
import { dewPoint, dryingAdvice, dryingHours, judgeVerdict, rangeHint, roomStayHours } from '@/utils/humidity';

const FILTER_KEYS = ['verdict'] as const;

const FILTER_SELECTS: ReadonlyArray<FilterSelectConfig> = [
  { key: 'verdict', label: '判定', options: ROOM_VERDICT_OPTIONS },
];

export default function RoomLog() {
  const { message } = AntdApp.useApp();
  const [roomForm] = Form.useForm<RoomDraft>();
  const [applyForm] = Form.useForm<AdmissionDraft>();
  const [exitForm] = Form.useForm<RoomDraft & { admissionId: string }>();

  const bodies = useBodyStore((state) => state.bodies);
  const rooms = useRoomStore((state) => state.rooms);
  const admissions = useRoomStore((state) => state.admissions);
  const createRoom = useRoomStore((state) => state.createRoom);
  const updateRoom = useRoomStore((state) => state.updateRoom);
  const removeRoom = useRoomStore((state) => state.removeRoom);
  const applyAdmission = useRoomStore((state) => state.applyAdmission);
  const registerExit = useRoomStore((state) => state.registerExit);
  const loadAdmissions = useRoomStore((state) => state.loadAdmissions);

  const url = useFilterQuery(FILTER_KEYS);
  const [roomOpen, setRoomOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [draftTemp, setDraftTemp] = useState(24);
  const [draftHumidity, setDraftHumidity] = useState(75);
  const [applyOpen, setApplyOpen] = useState(false);
  const [exiting, setExiting] = useState<Admission | null>(null);

  const bodyCode = (bodyId: string): string => bodies.find((body) => body.id === bodyId)?.code ?? bodyId;
  const bodyLabel = (bodyId: string): string => {
    const body = bodies.find((item) => item.id === bodyId);
    return body ? `${body.code} · ${BODY_SHAPE_LABEL[body.shape]}` : bodyId;
  };

  const admitted = useMemo(
    () =>
      admissions
        .filter((item) => item.status === 'admitted')
        .sort((a, b) => a.admittedAt - b.admittedAt),
    [admissions],
  );
  const waiting = useMemo(
    () =>
      admissions
        .filter((item) => item.status === 'waiting')
        .sort((a, b) => (a.queuedAt === b.queuedAt ? a.createdAt - b.createdAt : a.queuedAt - b.queuedAt)),
    [admissions],
  );
  const occupied = admitted.length;
  const freeCount = Math.max(0, ROOM_SHELF_CAPACITY - occupied);
  const occupiedPercent = Math.min(100, Math.round((occupied / ROOM_SHELF_CAPACITY) * 100));

  /** 可申请入荫的胎体：排队中 / 在房的不重复占架 */
  const applyBodyOptions = useMemo(() => {
    const busy = new Set(
      admissions.filter((item) => item.status !== 'exited').map((item) => item.bodyId),
    );
    return bodies
      .filter((body) => !busy.has(body.id))
      .map((body) => ({ value: body.id, label: `${body.code} · ${BODY_SHAPE_LABEL[body.shape]}` }));
  }, [bodies, admissions]);

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

  const openCreateRoom = (): void => {
    const bodyId = bodies[0]?.id ?? '';
    if (!bodyId) {
      message.warning('请先在胎体台账中登记胎体');
      return;
    }
    setEditing(null);
    const draft = createEmptyRoomDraft(bodyId);
    setDraftTemp(draft.tempC);
    setDraftHumidity(draft.humidityPct);
    roomForm.setFieldsValue(draft);
    setRoomOpen(true);
  };

  const openEditRoom = (room: Room): void => {
    setEditing(room);
    setDraftTemp(room.tempC);
    setDraftHumidity(room.humidityPct);
    roomForm.setFieldsValue(room);
    setRoomOpen(true);
  };

  const submitRoom = async (): Promise<void> => {
    const values = await roomForm.validateFields();
    const verdict = judgeVerdict(values.tempC, values.humidityPct);
    if (editing) {
      await updateRoom(editing.id, values);
      message.success(`已更新 ${values.date} 的荫房记录（判定：${ROOM_VERDICT_LABEL[verdict]}）`);
    } else {
      await createRoom(values);
      if (verdict === 'suitable') {
        message.success('已记录荫房温湿度，环境适宜');
      } else {
        message.warning(`判定为${ROOM_VERDICT_LABEL[verdict]}，涉及道次将回到待复检，由髹涂组处理`);
      }
    }
    setRoomOpen(false);
  };

  const openApply = (): void => {
    const bodyId = applyBodyOptions[0]?.value ?? '';
    if (!bodyId) {
      message.warning('在房与排队中的胎体不重复占架，暂无可申请的胎体');
      return;
    }
    applyForm.setFieldsValue(createEmptyAdmissionDraft(bodyId));
    setApplyOpen(true);
  };

  const submitApply = async (): Promise<void> => {
    const values = await applyForm.validateFields();
    const result = await applyAdmission(values);
    if (result.outcome === 'admitted') {
      message.success(`${bodyLabel(result.admission.bodyId)} 已入房占架`);
    } else {
      message.warning(
        `架位已满（${ROOM_SHELF_CAPACITY}/${ROOM_SHELF_CAPACITY}），已按先后排队；${bodyLabel(
          result.admission.bodyId,
        )} 前面还压着 ${result.aheadCount} 件，出房登记后空位自动给队首。`,
      );
    }
    setApplyOpen(false);
  };

  const openExit = (admission: Admission): void => {
    const today = new Date().toISOString().slice(0, 10);
    setExiting(admission);
    exitForm.setFieldsValue({
      admissionId: admission.id,
      bodyId: admission.bodyId,
      date: admission.applyDate || today,
      inAt: admission.inAt || '09:00',
      outAt: '21:00',
      tempC: 24,
      humidityPct: 75,
    });
    setDraftTemp(24);
    setDraftHumidity(75);
  };

  const submitExit = async (): Promise<void> => {
    if (!exiting) return;
    const values = await exitForm.validateFields();
    const result = await registerExit(values);
    const verdictText = ROOM_VERDICT_LABEL[result.room.verdict];
    if (result.promoted) {
      message.success(
        `已登记出房（${verdictText}）并释放架位；空位已给队首 ${bodyLabel(result.promoted.bodyId)} 入房`,
      );
    } else {
      message.success(`已登记出房（${verdictText}）并释放架位，当前排队已清空`);
    }
    if (result.room.verdict !== 'suitable') {
      message.warning(`本次判定${verdictText}，涉及道次将回到待复检，由髹涂组处理`);
    }
    setExiting(null);
  };

  const admittedColumns: ColumnsType<Admission> = [
    {
      title: '胎体',
      dataIndex: 'bodyId',
      render: (value: string) => <Tag color="#8c2f1f">{bodyLabel(value)}</Tag>,
    },
    { title: '申请日期', dataIndex: 'applyDate', width: 120 },
    { title: '入房时间', dataIndex: 'inAt', width: 100 },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_value, record) => (
        <Button size="small" type="link" icon={<LogoutOutlined />} onClick={() => openExit(record)}>
          出房登记
        </Button>
      ),
    },
  ];

  const waitingColumns: ColumnsType<Admission> = [
    {
      title: '顺序',
      key: 'order',
      width: 70,
      render: (_value, _record, index) => <Tag color="gold">第 {index + 1} 位</Tag>,
    },
    {
      title: '胎体',
      dataIndex: 'bodyId',
      render: (value: string) => <Tag>{bodyLabel(value)}</Tag>,
    },
    { title: '申请日期', dataIndex: 'applyDate', width: 120 },
    {
      title: '前面压着',
      key: 'ahead',
      width: 110,
      render: (_value, _record, index) =>
        index === 0 ? <Typography.Text type="success">队首，空位即入</Typography.Text> : `${index} 件`,
    },
  ];

  const roomColumns: ColumnsType<Room> = [
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
          {dryingAdvice(record.tempC, record.humidityPct, 40)}（预计 {dryingHours(record.tempC, record.humidityPct, 40)}{' '}
          小时）
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_value, record) => (
        <Space size={4} wrap>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEditRoom(record)}>
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

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>荫房值班台</h2>
          <p>
            {rangeHint()}；值班管温湿度记录与架位占用，入荫按先后排队，出房登记后空位自动给队首。
            偏干 / 偏湿涉及道次回到待复检，交髹涂组处理。
          </p>
        </div>
        <Space wrap>
          <Button type="primary" icon={<SendOutlined />} onClick={openApply}>
            入荫申请
          </Button>
          <Button icon={<PlusOutlined />} onClick={openCreateRoom}>
            补记温湿度
          </Button>
        </Space>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="架位占用" value={`${occupied}/${ROOM_SHELF_CAPACITY}`} suffix="位" tone="primary" />
        <StatBadge label="空位" value={freeCount} suffix="位" tone="success" />
        <StatBadge label="排队中" value={waiting.length} suffix="件" tone="warning" />
        <StatBadge label="超标次数" value={stat.over} suffix="次" tone="danger" />
        <StatBadge label="偏干" value={stat.dry} suffix="次" tone="warning" />
        <StatBadge label="偏湿" value={stat.wet} suffix="次" tone="info" />
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            className="gb-table-card"
            title={
              <Space>
                <span>架位占用（在房 {occupied} 件）</span>
                <Tag color={freeCount > 0 ? 'green' : 'red'}>{freeCount > 0 ? `余 ${freeCount} 空位` : '架位已满'}</Tag>
              </Space>
            }
            extra={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadAdmissions()}>
                刷新
              </Button>
            }
            styles={{ body: { padding: 0 } }}
          >
            {admitted.length === 0 ? (
              <EmptyPanel
                title="架位全空"
                description="收到髹涂组放行或值班登记入荫后，在房胎体会显示在这里。"
                actionText="入荫申请"
                onAction={openApply}
                size="small"
              />
            ) : (
              <>
                <div style={{ padding: '12px 16px 0' }}>
                  <Progress
                    percent={occupiedPercent}
                    size="small"
                    status={freeCount > 0 ? 'active' : 'exception'}
                    format={() => `${occupied}/${ROOM_SHELF_CAPACITY}`}
                  />
                </div>
                <Table<Admission>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={admittedColumns}
                  dataSource={admitted}
                />
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            className="gb-table-card"
            title={
              <Space>
                <span>入荫排队</span>
                <Tag color="gold">{waiting.length} 件</Tag>
              </Space>
            }
            styles={{ body: { padding: 0 } }}
          >
            {waiting.length === 0 ? (
              <EmptyPanel
                title="没有排队"
                description="架位满时新申请按先后排队；一出房，队首自动入位。"
                size="small"
              />
            ) : (
              <Table<Admission>
                rowKey="id"
                size="small"
                pagination={false}
                columns={waitingColumns}
                dataSource={waiting}
              />
            )}
          </Card>
        </Col>
      </Row>

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
            title={rooms.length === 0 ? '还没有温湿度记录' : '当前条件下没有记录'}
            description={
              rooms.length === 0
                ? '出房登记会自动记录温度、湿度与出入房时间；也可用「补记温湿度」单独登记。'
                : '试着调整判定或日期区间。'
            }
            actionText="补记温湿度"
            onAction={openCreateRoom}
            secondaryText="重置筛选"
            onSecondary={() => {
              url.reset();
              setDateFrom('');
              setDateTo('');
            }}
            size="small"
          />
        ) : (
          <Table<Room> rowKey="id" size="small" pagination={{ pageSize: 8 }} columns={roomColumns} dataSource={filtered} />
        )}
      </Card>

      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 10 }}>
        入荫申请状态：排队 {waiting.length} 件 / 在房 {occupied} 件 / 已出房{' '}
        {admissions.filter((item) => item.status === 'exited').length} 件 · 判定仅记录在荫房侧，道次复检由髹涂组处理
      </Typography.Text>

      {/* 入荫申请 */}
      <Modal
        open={applyOpen}
        title="入荫申请"
        onCancel={() => setApplyOpen(false)}
        onOk={() => void submitApply()}
        okText="提交申请"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={applyForm} layout="vertical" preserve={false}>
          <Form.Item name="bodyId" label="申请胎体" rules={[{ required: true, message: '请选择胎体' }]}>
            <Select options={applyBodyOptions} placeholder="在房 / 排队中的胎体不重复占架" />
          </Form.Item>
          <Form.Item name="applyDate" label="申请日期" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            架位容量固定 {ROOM_SHELF_CAPACITY} 位，当前占用 {occupied} 位；
            {freeCount > 0
              ? '提交后直接入房占架。'
              : '架位已满，提交后按先后排队，前面压着的件数会写明，出房后空位给队首。'}
          </Typography.Text>
        </Form>
      </Modal>

      {/* 出房登记 */}
      <Modal
        open={exiting !== null}
        title={exiting ? `出房登记 · ${bodyLabel(exiting.bodyId)}` : '出房登记'}
        onCancel={() => setExiting(null)}
        onOk={() => void submitExit()}
        okText="登记出房并让位"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={exitForm}
          layout="vertical"
          preserve={false}
          onValuesChange={(changed) => {
            if (typeof changed.tempC === 'number') setDraftTemp(changed.tempC);
            if (typeof changed.humidityPct === 'number') setDraftHumidity(changed.humidityPct);
          }}
        >
          <Form.Item name="admissionId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="bodyId" hidden>
            <Input />
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
              露点约 {dewPoint(draftTemp, draftHumidity)}℃
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              登记后释放架位，空位自动给排队队首
              {waiting.length > 0 ? `（下一位：${bodyLabel(waiting[0]!.bodyId)}）` : '（当前无排队）'}；偏干 /
              偏湿涉及道次回到待复检。
            </Typography.Text>
          </Space>
        </Form>
      </Modal>

      {/* 温湿度补记 / 编辑 */}
      <Modal
        open={roomOpen}
        title={editing ? `编辑 ${editing.date} 的荫房记录` : '补记温湿度记录'}
        onCancel={() => setRoomOpen(false)}
        onOk={() => void submitRoom()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={roomForm}
          layout="vertical"
          preserve={false}
          onValuesChange={(changed) => {
            if (typeof changed.tempC === 'number') setDraftTemp(changed.tempC);
            if (typeof changed.humidityPct === 'number') setDraftHumidity(changed.humidityPct);
          }}
        >
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
              露点约 {dewPoint(draftTemp, draftHumidity)}℃ · 在房{' '}
              {roomStayHours(
                roomForm.getFieldValue('inAt') ?? '09:00',
                roomForm.getFieldValue('outAt') ?? '21:00',
              )}{' '}
              小时
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
