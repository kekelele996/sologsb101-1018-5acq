/**
 * /export 成品质检与 JSON 结构版本导入导出
 * 判定返工时定位到具体道次与荫房记录并生成返工清单；支持整库 JSON 导入导出与清空重播种。
 * 消费 Inspect 及全部模型；复用 <StatBadge>、<EmptyPanel>。
 */
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Alert,
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
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import StatBadge from '@/components/common/StatBadge';
import { useIdbTable } from '@/hooks/useIdbTable';
import { useBodyStore } from '@/stores/bodyStore';
import { useCoatStore } from '@/stores/coatStore';
import { useRoomStore } from '@/stores/roomStore';
import { COAT_STATE_LABEL, PAINT_TYPE_LABEL } from '@/types/coat';
import { BODY_SHAPE_LABEL } from '@/types/body';
import { ROOM_VERDICT_LABEL } from '@/types/room';
import {
  INSPECT_VERDICT_COLOR,
  INSPECT_VERDICT_LABEL,
  INSPECT_VERDICT_OPTIONS,
  createEmptyInspectDraft,
  type Inspect,
  type InspectDraft,
  type InspectVerdict,
} from '@/types/inspect';
import {
  DB_NAME,
  DB_SCHEMA_VERSION,
  exportSnapshot,
  importSnapshot,
  readLastBackupAt,
  resetDatabase,
  validateSnapshot,
  writeLastBackupAt,
  type LacquerSnapshot,
} from '@/utils/db';
import { buildReworkList, copyText, exportLedgerCsv, exportReworkList, exportSnapshotJson } from '@/utils/export';

export default function ExportView() {
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<InspectDraft>();
  const inspectTable = useIdbTable<Inspect>((database) => database.inspects, { sortByUpdatedAt: false });
  const fileRef = useRef<HTMLInputElement>(null);

  const bodies = useBodyStore((state) => state.bodies);
  const loadBodies = useBodyStore((state) => state.loadBodies);
  const coats = useCoatStore((state) => state.coats);
  const loadCoats = useCoatStore((state) => state.loadCoats);
  const rooms = useRoomStore((state) => state.rooms);
  const loadRooms = useRoomStore((state) => state.loadRooms);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Inspect | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(readLastBackupAt());
  const watchedBodyId = Form.useWatch('bodyId', form) as string | undefined;
  const watchedVerdict = Form.useWatch('verdict', form) as InspectVerdict | undefined;

  const bodyCode = (bodyId: string): string => bodies.find((body) => body.id === bodyId)?.code ?? bodyId;

  const stat = useMemo(() => {
    const total = inspectTable.rows.length;
    const pass = inspectTable.rows.filter((row) => row.verdict === 'pass').length;
    const rework = total - pass;
    return { total, pass, rework, passPercent: total === 0 ? 0 : Math.round((pass / total) * 100) };
  }, [inspectTable.rows]);

  const draftBodyId = watchedBodyId ?? bodies[0]?.id ?? '';
  const draftCoats = coats.filter((coat) => coat.bodyId === draftBodyId).sort((a, b) => a.seq - b.seq);
  const draftRooms = rooms.filter((room) => room.bodyId === draftBodyId);

  const reworkText = useMemo(
    () => buildReworkList(bodies, coats, rooms, inspectTable.rows),
    [bodies, coats, rooms, inspectTable.rows],
  );

  const openCreate = (): void => {
    const bodyId = bodies[0]?.id ?? '';
    if (!bodyId) {
      message.warning('请先在胎体台账中登记胎体');
      return;
    }
    setEditing(null);
    form.setFieldsValue(createEmptyInspectDraft(bodyId));
    setOpen(true);
  };

  const openEdit = (row: Inspect): void => {
    setEditing(row);
    form.setFieldsValue({
      bodyId: row.bodyId,
      verdict: row.verdict,
      defectNote: row.defectNote,
      inspector: row.inspector,
      date: row.date,
      defectCoatSeq: row.defectCoatSeq,
      defectRoomId: row.defectRoomId,
    });
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    const payload: InspectDraft = {
      ...values,
      defectCoatSeq: values.verdict === 'rework' ? (values.defectCoatSeq ?? null) : null,
      defectRoomId: values.verdict === 'rework' ? (values.defectRoomId ?? null) : null,
    };
    if (editing) {
      await inspectTable.update(editing.id, payload);
      message.success('已更新质检记录');
    } else {
      await inspectTable.create(payload, 'inspect');
      message.success(
        payload.verdict === 'rework' ? '已登记返工，可在下方返工清单中查看定位结果' : '已登记质检合格',
      );
    }
    setOpen(false);
  };

  const handleExport = async (): Promise<void> => {
    const snapshot = await exportSnapshot();
    const filename = exportSnapshotJson(snapshot);
    const stamp = new Date().toISOString();
    writeLastBackupAt(stamp);
    setLastBackupAt(stamp);
    message.success(`已导出 ${filename}（结构版本 v${snapshot.schemaVersion}）`);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      message.error('JSON 解析失败，请确认文件格式');
      return;
    }
    const invalid = validateSnapshot(parsed);
    if (invalid) {
      message.error(invalid);
      return;
    }
    modal.confirm({
      title: '覆盖导入本地数据',
      content: '导入会清空当前浏览器中的全部档案，再写入备份内容，操作不可撤销。',
      okText: '确认导入',
      cancelText: '取消',
      onOk: async () => {
        await importSnapshot(parsed as LacquerSnapshot);
        await Promise.all([loadBodies(), loadCoats(), loadRooms()]);
        message.success('导入完成，数据已覆盖');
      },
    });
  };

  const handleReset = async (): Promise<void> => {
    await resetDatabase();
    await Promise.all([loadBodies(), loadCoats(), loadRooms()]);
    message.success('已清空并重新载入演示数据');
  };

  const columns: ColumnsType<Inspect> = [
    { title: '质检日期', dataIndex: 'date', width: 120, sorter: (a, b) => a.date.localeCompare(b.date) },
    {
      title: '胎体',
      dataIndex: 'bodyId',
      width: 120,
      render: (value: string) => <Tag color="#8c2f1f">{bodyCode(value)}</Tag>,
    },
    {
      title: '结论',
      dataIndex: 'verdict',
      width: 100,
      filters: INSPECT_VERDICT_OPTIONS.map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value, record) => record.verdict === value,
      render: (value: InspectVerdict) => <Tag color={INSPECT_VERDICT_COLOR[value]}>{INSPECT_VERDICT_LABEL[value]}</Tag>,
    },
    {
      title: '缺陷说明',
      dataIndex: 'defectNote',
      render: (value: string, record) =>
        record.verdict === 'rework' ? (
          <Space direction="vertical" size={0}>
            <Typography.Text>{value || '未填写'}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              定位道次：
              {record.defectCoatSeq === null
                ? '未指定'
                : (() => {
                    const coat = coats.find(
                      (item) => item.bodyId === record.bodyId && item.seq === record.defectCoatSeq,
                    );
                    return coat
                      ? `第 ${coat.seq} 道 · ${PAINT_TYPE_LABEL[coat.paintType]} · ${coat.colorName}（${COAT_STATE_LABEL[coat.state]}）`
                      : `第 ${record.defectCoatSeq} 道`;
                  })()}
              ；荫房：
              {record.defectRoomId === null
                ? '未指定'
                : (() => {
                    const room = rooms.find((item) => item.id === record.defectRoomId);
                    return room
                      ? `${room.date} ${room.tempC}℃ / ${room.humidityPct}%（${ROOM_VERDICT_LABEL[room.verdict]}）`
                      : '记录已删除';
                  })()}
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    { title: '质检人', dataIndex: 'inspector', width: 110, render: (value: string) => value || '未填写' },
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
            title="删除该质检记录"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void inspectTable.remove(record.id).then(() => message.success('已删除'))}
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
          <h2>成品质检与数据导出</h2>
          <p>
            本地库 {DB_NAME} · 结构版本 v{DB_SCHEMA_VERSION}
            {lastBackupAt ? ` · 最近导出 ${new Date(lastBackupAt).toLocaleString('zh-CN')}` : ' · 尚未导出过备份'}
          </p>
        </div>
        <Space wrap>
          <Button icon={<CloudDownloadOutlined />} onClick={() => void handleExport()}>
            导出 JSON
          </Button>
          <Button icon={<CloudUploadOutlined />} onClick={() => fileRef.current?.click()}>
            导入 JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(event) => void handleImportFile(event)}
          />
          <Popconfirm
            title="清空并重播种"
            description="会删除当前浏览器中的全部档案并恢复演示数据，不可撤销。"
            okText="确认重置"
            cancelText="取消"
            onConfirm={() => void handleReset()}
          >
            <Button danger icon={<ReloadOutlined />}>
              清空重播种
            </Button>
          </Popconfirm>
        </Space>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="质检记录" value={stat.total} suffix="条" tone="primary" />
        <StatBadge label="合格率" value={`${stat.passPercent}%`} percent={stat.passPercent} tone="success" />
        <StatBadge label="合格" value={stat.pass} suffix="条" tone="info" />
        <StatBadge label="返工" value={stat.rework} suffix="条" tone="danger" />
        <StatBadge label="荫房记录" value={rooms.length} suffix="条" tone="warning" />
      </div>

      <Row gutter={16}>
        <Col xs={24} xl={15}>
          <Card
            className="gb-table-card"
            title="质检登记"
            extra={
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>
                新增质检
              </Button>
            }
            styles={{ body: { padding: 0 } }}
          >
            {inspectTable.rows.length === 0 ? (
              <EmptyPanel
                title="还没有质检记录"
                description="登记成品质检结论；判定返工时需定位到具体道次与荫房记录。"
                actionText="新增质检"
                onAction={openCreate}
                size="small"
              />
            ) : (
              <Table<Inspect>
                rowKey="id"
                size="small"
                pagination={{ pageSize: 6 }}
                columns={columns}
                dataSource={[...inspectTable.rows].sort((a, b) => b.date.localeCompare(a.date))}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card
            title="返工清单"
            extra={
              <Space size={4}>
                <Button size="small" icon={<FileTextOutlined />} onClick={() => {
                  const filename = exportReworkList(bodies, coats, rooms, inspectTable.rows);
                  message.success(`已导出 ${filename}`);
                }}>
                  导出清单
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    void copyText(reworkText).then((ok) =>
                      ok ? message.success('返工清单已复制到剪贴板') : message.warning('浏览器未授权剪贴板'),
                    )
                  }
                >
                  复制
                </Button>
              </Space>
            }
          >
            <pre style={{ maxHeight: 320, overflow: 'auto', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
              {reworkText}
            </pre>
          </Card>

          <Card title="整库导出" style={{ marginTop: 16 }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Typography.Text type="secondary">
                导出文件包含 6 张业务表全量数据与结构版本号，可在其他设备通过「导入 JSON」还原。
              </Typography.Text>
              <Space wrap>
                <Button icon={<CloudDownloadOutlined />} onClick={() => void handleExport()}>
                  JSON 备份
                </Button>
                <Button
                  onClick={() => {
                    const filename = exportLedgerCsv(bodies, coats, rooms);
                    message.success(`已导出 ${filename}`);
                  }}
                >
                  工序台账 CSV
                </Button>
              </Space>
              <Alert
                type="info"
                showIcon
                message="无状态容器"
                description="服务端不保存任何数据；清理浏览器站点数据会丢失档案，请定期导出备份。"
              />
            </Space>
          </Card>
        </Col>
      </Row>

      <Modal
        open={open}
        title={editing ? '编辑质检记录' : '新增质检记录'}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="bodyId" label="质检胎体" rules={[{ required: true }]}>
            <Select
              options={bodies.map((body) => ({
                value: body.id,
                label: `${body.code} · ${BODY_SHAPE_LABEL[body.shape]}`,
              }))}
            />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="verdict" label="质检结论" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[...INSPECT_VERDICT_OPTIONS]} />
            </Form.Item>
            <Form.Item name="date" label="质检日期" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="inspector" label="质检人" style={{ flex: 1 }}>
              <Input placeholder="如：周衡" />
            </Form.Item>
          </Space>
          <Form.Item name="defectNote" label="缺陷说明" rules={watchedVerdict === 'rework' ? [{ required: true, message: '返工必须填写缺陷说明' }] : []}>
            <Select
              allowClear
              showSearch
              placeholder="如：起皱（荫干过快）"
              options={[
                '漆面流挂',
                '起皱（荫干过快）',
                '针孔气泡',
                '边缘露底',
                '推光不匀',
                '镶嵌脱落',
              ].map((item) => ({ value: item, label: item }))}
            />
          </Form.Item>
          {watchedVerdict === 'rework' ? (
            <Space size={12} style={{ display: 'flex' }}>
              <Form.Item name="defectCoatSeq" label="定位道次" style={{ flex: 1 }}>
                <Select
                  allowClear
                  placeholder="选择道次"
                  options={draftCoats.map((coat) => ({
                    value: coat.seq,
                    label: `第 ${coat.seq} 道 · ${PAINT_TYPE_LABEL[coat.paintType]} · ${coat.colorName}`,
                  }))}
                />
              </Form.Item>
              <Form.Item name="defectRoomId" label="关联荫房记录" style={{ flex: 1 }}>
                <Select
                  allowClear
                  placeholder="选择荫房记录"
                  options={draftRooms.map((room) => ({
                    value: room.id,
                    label: `${room.date} ${room.tempC}℃/${room.humidityPct}% · ${ROOM_VERDICT_LABEL[room.verdict]}`,
                  }))}
                />
              </Form.Item>
            </Space>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
