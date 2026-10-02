/**
 * 打磨推光（Polish）数据模型
 * 按道次登记的磨料目数与手法时长，未打磨完不许进入下一道罩漆。
 */

/** 手法：水砂 / 推光 / 揩清 */
export type PolishMethod = 'water' | 'burnish' | 'wipe';

export interface Polish {
  id: string;
  /** 所属胎体 id */
  bodyId: string;
  /** 关联的髹涂道次序号 */
  seq: number;
  /** 磨料目数，如 400 / 800 / 1500 / 2000 */
  grit: number;
  /** 手法 */
  method: PolishMethod;
  /** 耗时（分钟） */
  durationMin: number;
  /** 操作人 */
  operator: string;
  createdAt: number;
  updatedAt: number;
}

export type PolishDraft = Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>;

export const POLISH_METHOD_LABEL: Record<PolishMethod, string> = {
  water: '水砂',
  burnish: '推光',
  wipe: '揩清',
};

export const POLISH_METHOD_COLOR: Record<PolishMethod, string> = {
  water: '#3a6ea5',
  burnish: '#c9963c',
  wipe: '#2f6f4f',
};

export const POLISH_METHOD_OPTIONS: ReadonlyArray<{ value: PolishMethod; label: string }> = [
  { value: 'water', label: '水砂' },
  { value: 'burnish', label: '推光' },
  { value: 'wipe', label: '揩清' },
];

/** 标准目数序列：按道次生成打磨序列时使用 */
export const GRIT_SEQUENCE: readonly number[] = [320, 600, 1000, 1500, 2000];

/** 按道次序号给出建议目数 */
export function suggestGrit(seq: number): number {
  const index = Math.min(Math.max(seq, 1), GRIT_SEQUENCE.length) - 1;
  return GRIT_SEQUENCE[index] ?? 1000;
}

export function createEmptyPolishDraft(bodyId: string, seq: number): PolishDraft {
  return {
    bodyId,
    seq,
    grit: suggestGrit(seq),
    method: 'water',
    durationMin: 30,
    operator: '',
  };
}
