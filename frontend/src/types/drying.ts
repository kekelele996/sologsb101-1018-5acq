/**
 * 入荫申请 / 架位占用（DryingEntry）数据模型
 * 荫房值班侧职责：记录每件胎体的入荫排队、架位占用与出房登记。
 * 与 Room（温湿度记录）分离：Room 只管温湿度判定，Entry 只管架位与排队。
 */

/** 申请状态：排队中 / 在房 / 已出房 / 已退回 */
export type DryingEntryStatus = 'queued' | 'inRoom' | 'exited' | 'rejected';

export interface DryingEntry {
  id: string;
  /** 所属胎体 id */
  bodyId: string;
  /** 排队序号（按申请先后，从 1 开始连续） */
  queueNo: number;
  /** 当前状态 */
  status: DryingEntryStatus;
  /** 占用架位号（在房时为 1..RACK_CAPACITY，其余为 null） */
  slotNo: number | null;
  /** 入房时间 yyyy-MM-dd HH:mm */
  inAt: string | null;
  /** 出房时间 yyyy-MM-dd HH:mm */
  outAt: string | null;
  /** 关联的荫房温湿度记录 id（可空） */
  roomId: string | null;
  /** 退回原因（入荫失败被退回时填写） */
  rejectReason: string;
  createdAt: number;
  updatedAt: number;
}

export type DryingEntryDraft = Omit<DryingEntry, 'id' | 'createdAt' | 'updatedAt'>;

export const DRYING_ENTRY_STATUS_LABEL: Record<DryingEntryStatus, string> = {
  queued: '排队中',
  inRoom: '在房',
  exited: '已出房',
  rejected: '已退回',
};

export const DRYING_ENTRY_STATUS_COLOR: Record<DryingEntryStatus, string> = {
  queued: '#c9963c',
  inRoom: '#2f6f4f',
  exited: '#8c8c8c',
  rejected: '#b03a2e',
};

/** 荫房架位容量（固定） */
export const RACK_CAPACITY = 8;

/** 本地时间戳 yyyy-MM-dd HH:mm，供入房 / 出房登记使用 */
export function dryingStamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
