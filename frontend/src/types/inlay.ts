/**
 * 镶嵌（Inlay）数据模型
 * 螺钿、蛋壳、描金、戗金等纹饰的登记，叠加显示于器型示意区。
 */

/** 镶嵌类型 */
export type InlayType = 'nacre' | 'eggshell' | 'goldTrace' | 'incisedGold';

export interface Inlay {
  id: string;
  /** 所属胎体 id */
  bodyId: string;
  /** 镶嵌类型 */
  type: InlayType;
  /** 图案名，如「缠枝莲」「云纹」 */
  pattern: string;
  /** 位置，如「外壁」「盖面」 */
  position: string;
  /** 材料与工艺备注 */
  materialNote: string;
  createdAt: number;
  updatedAt: number;
}

export type InlayDraft = Omit<Inlay, 'id' | 'createdAt' | 'updatedAt'>;

export const INLAY_TYPE_LABEL: Record<InlayType, string> = {
  nacre: '螺钿',
  eggshell: '蛋壳',
  goldTrace: '描金',
  incisedGold: '戗金',
};

export const INLAY_TYPE_COLOR: Record<InlayType, string> = {
  nacre: '#7d6ba8',
  eggshell: '#8c8479',
  goldTrace: '#c9963c',
  incisedGold: '#8c2f1f',
};

export const INLAY_TYPE_OPTIONS: ReadonlyArray<{ value: InlayType; label: string }> = [
  { value: 'nacre', label: '螺钿' },
  { value: 'eggshell', label: '蛋壳' },
  { value: 'goldTrace', label: '描金' },
  { value: 'incisedGold', label: '戗金' },
];

export const INLAY_POSITION_OPTIONS: readonly string[] = [
  '外壁',
  '内壁',
  '盖面',
  '底足',
  '口沿',
  '通体',
];

export const INLAY_PATTERN_OPTIONS: readonly string[] = [
  '缠枝莲',
  '云纹',
  '折枝花',
  '山水人物',
  '几何回纹',
  '诗文',
];

export function createEmptyInlayDraft(bodyId: string): InlayDraft {
  return {
    bodyId,
    type: 'nacre',
    pattern: '缠枝莲',
    position: '外壁',
    materialNote: '',
  };
}
