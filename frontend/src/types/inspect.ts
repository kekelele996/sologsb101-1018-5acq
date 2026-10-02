/**
 * 成品质检（Inspect）数据模型
 * 判定返工时需定位到具体道次与荫房记录，并生成返工清单。
 */

/** 质检结论：合格 / 返工 */
export type InspectVerdict = 'pass' | 'rework';

export interface Inspect {
  id: string;
  /** 所属胎体 id */
  bodyId: string;
  /** 质检结论 */
  verdict: InspectVerdict;
  /** 缺陷说明 */
  defectNote: string;
  /** 质检人 */
  inspector: string;
  /** 质检日期 yyyy-MM-dd */
  date: string;
  /** 返工时定位到的道次序号，无则 null */
  defectCoatSeq: number | null;
  /** 返工时定位到的荫房记录 id，无则 null */
  defectRoomId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type InspectDraft = Omit<Inspect, 'id' | 'createdAt' | 'updatedAt'>;

export const INSPECT_VERDICT_LABEL: Record<InspectVerdict, string> = {
  pass: '合格',
  rework: '返工',
};

export const INSPECT_VERDICT_COLOR: Record<InspectVerdict, string> = {
  pass: '#2f6f4f',
  rework: '#b03a2e',
};

export const INSPECT_VERDICT_OPTIONS: ReadonlyArray<{ value: InspectVerdict; label: string }> = [
  { value: 'pass', label: '合格' },
  { value: 'rework', label: '返工' },
];

export const DEFECT_NOTE_OPTIONS: readonly string[] = [
  '漆面流挂',
  '起皱（荫干过快）',
  '针孔气泡',
  '边缘露底',
  '推光不匀',
  '镶嵌脱落',
];

export function createEmptyInspectDraft(bodyId: string): InspectDraft {
  return {
    bodyId,
    verdict: 'pass',
    defectNote: '',
    inspector: '',
    date: new Date().toISOString().slice(0, 10),
    defectCoatSeq: null,
    defectRoomId: null,
  };
}
