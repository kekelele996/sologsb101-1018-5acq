/**
 * 入荫申请与架位占用（Admission）数据模型
 * 归荫房值班管理：入荫按申请先后排队，架位容量固定；
 * 出房登记后空位自动给队首。髹涂组只读此表判断是否放行成功。
 */

/** 入荫状态：排队中 / 在房 / 已出房 */
export type AdmissionStatus = 'waiting' | 'admitted' | 'exited';

export interface Admission {
  id: string;
  /** 申请入荫的胎体 id（一件胎体在同一时刻只占一个架位） */
  bodyId: string;
  /** 申请日期 yyyy-MM-dd */
  applyDate: string;
  /** 当前状态 */
  status: AdmissionStatus;
  /** 入房时间 HH:mm，排队中为空 */
  inAt: string;
  /** 出房时间 HH:mm，未出房为空（出房登记时由温湿度记录侧回写） */
  outAt: string;
  /** 出房后生成的荫房温湿度记录 id；排队 / 在房时为空 */
  roomId: string;
  /** 排队序号依据：申请时间戳，先申请先入位 */
  queuedAt: number;
  admittedAt: number;
  exitedAt: number;
  createdAt: number;
  updatedAt: number;
}

export type AdmissionDraft = Pick<Admission, 'bodyId' | 'applyDate'>;

/** 荫房固定架位容量（一间荫房，架位数不变） */
export const ROOM_SHELF_CAPACITY = 2;

export const ADMISSION_STATUS_LABEL: Record<AdmissionStatus, string> = {
  waiting: '排队中',
  admitted: '在房',
  exited: '已出房',
};

export const ADMISSION_STATUS_COLOR: Record<AdmissionStatus, string> = {
  waiting: '#c9963c',
  admitted: '#8c2f1f',
  exited: '#2f6f4f',
};

export function createEmptyAdmissionDraft(bodyId: string): AdmissionDraft {
  return {
    bodyId,
    applyDate: new Date().toISOString().slice(0, 10),
  };
}
