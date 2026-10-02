/**
 * 荫房记录（Room）数据模型
 * 每次入荫房的温湿度与出入房时间，是漆层缺陷回溯的关键依据。
 */

/** 判定结论：适宜 / 偏干 / 偏湿 */
export type RoomVerdict = 'suitable' | 'dry' | 'wet';

export interface Room {
  id: string;
  /** 所属胎体 id */
  bodyId: string;
  /** 记录日期 yyyy-MM-dd */
  date: string;
  /** 荫房温度（摄氏度） */
  tempC: number;
  /** 相对湿度（%） */
  humidityPct: number;
  /** 入房时间 HH:mm */
  inAt: string;
  /** 出房时间 HH:mm */
  outAt: string;
  /** 判定结论 */
  verdict: RoomVerdict;
  createdAt: number;
  updatedAt: number;
}

export type RoomDraft = Omit<Room, 'id' | 'createdAt' | 'updatedAt'>;

export const ROOM_VERDICT_LABEL: Record<RoomVerdict, string> = {
  suitable: '适宜',
  dry: '偏干',
  wet: '偏湿',
};

export const ROOM_VERDICT_COLOR: Record<RoomVerdict, string> = {
  suitable: '#2f6f4f',
  dry: '#c9963c',
  wet: '#3a6ea5',
};

export const ROOM_VERDICT_OPTIONS: ReadonlyArray<{ value: RoomVerdict; label: string }> = [
  { value: 'suitable', label: '适宜' },
  { value: 'dry', label: '偏干' },
  { value: 'wet', label: '偏湿' },
];

export function createEmptyRoomDraft(bodyId: string): RoomDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    bodyId,
    date: today,
    tempC: 24,
    humidityPct: 75,
    inAt: '09:00',
    outAt: '21:00',
    verdict: 'suitable',
  };
}
