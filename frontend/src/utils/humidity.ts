/**
 * 荫房环境换算工具
 * - 温湿度区间判定（适宜 / 偏干 / 偏湿）
 * - 露点估算（Magnus 公式）
 * - 荫干时长建议与漆种间隔建议
 */
import type { RoomVerdict } from '@/types/room';
import type { PaintType } from '@/types/coat';
import type { BodyShape } from '@/types/body';

/** 荫房适宜区间 */
export const HUMIDITY_RANGE = { min: 65, max: 85 } as const;
export const TEMP_RANGE = { min: 20, max: 28 } as const;

/** 判定：湿度低于下限为偏干，高于上限为偏湿，温度越界同样按干湿提示 */
export function judgeVerdict(tempC: number, humidityPct: number): RoomVerdict {
  if (humidityPct < HUMIDITY_RANGE.min) return 'dry';
  if (humidityPct > HUMIDITY_RANGE.max) return 'wet';
  if (tempC < TEMP_RANGE.min) return 'dry';
  if (tempC > TEMP_RANGE.max) return 'wet';
  return 'suitable';
}

/** 区间描述文案，用于表单提示 */
export function rangeHint(): string {
  return `适宜区间：温度 ${TEMP_RANGE.min}~${TEMP_RANGE.max}℃，湿度 ${HUMIDITY_RANGE.min}~${HUMIDITY_RANGE.max}%`;
}

/** 露点估算（Magnus 公式，返回摄氏度，保留一位小数） */
export function dewPoint(tempC: number, humidityPct: number): number {
  const a = 17.27;
  const b = 237.7;
  const rh = Math.min(Math.max(humidityPct, 1), 100) / 100;
  const alpha = (a * tempC) / (b + tempC) + Math.log(rh);
  const value = (b * alpha) / (a - alpha);
  return Math.round(value * 10) / 10;
}

/** 荫干时长建议（小时）：湿度越低漆层氧化聚合越慢，湿膜越厚等待越久 */
export function dryingHours(tempC: number, humidityPct: number, thicknessUm: number): number {
  const humidityFactor = humidityPct >= HUMIDITY_RANGE.min && humidityPct <= HUMIDITY_RANGE.max ? 1 : 1.35;
  const tempFactor = tempC < TEMP_RANGE.min ? 1.25 : tempC > TEMP_RANGE.max ? 0.85 : 1;
  const thicknessFactor = Math.max(0.6, thicknessUm / 40);
  const base = 12 * humidityFactor * tempFactor * thicknessFactor;
  return Math.round(base * 10) / 10;
}

/** 入房到出房的实际时长（小时），outAt 小于 inAt 表示跨夜 */
export function roomStayHours(inAt: string, outAt: string): number {
  const toMinutes = (value: string): number => {
    const [h, m] = value.split(':').map((item) => Number.parseInt(item, 10));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return h * 60 + m;
  };
  const diff = toMinutes(outAt) - toMinutes(inAt);
  const normalized = diff < 0 ? diff + 24 * 60 : diff;
  return Math.round((normalized / 60) * 10) / 10;
}

/** 漆种建议间隔（小时） */
export function suggestIntervalHours(paintType: PaintType): number {
  if (paintType === 'raw') return 24;
  if (paintType === 'color') return 18;
  return 12;
}

/** 按器型与上一道漆种给出建议漆种：小件多罩漆，大件多生漆打底 */
export function suggestPaintType(seq: number, previous?: PaintType, shape?: BodyShape): PaintType {
  if (seq <= 1) return 'raw';
  if (shape === 'vase' || shape === 'box') {
    if (seq >= 3) return 'topcoat';
    return previous === 'raw' ? 'color' : previous ?? 'color';
  }
  if (seq >= 4) return 'topcoat';
  return previous === 'topcoat' ? 'color' : previous ?? 'color';
}

/** 漆种 + 环境 → 一句话建议 */
export function dryingAdvice(tempC: number, humidityPct: number, thicknessUm: number): string {
  const verdict = judgeVerdict(tempC, humidityPct);
  const hours = dryingHours(tempC, humidityPct, thicknessUm);
  if (verdict === 'dry') return `环境偏干，建议加湿至 ${HUMIDITY_RANGE.min}% 以上；按当前条件预计荫干 ${hours} 小时。`;
  if (verdict === 'wet') return `环境偏湿，建议除湿至 ${HUMIDITY_RANGE.max}% 以下，避免漆面起皱；预计荫干 ${hours} 小时。`;
  return `环境适宜，预计荫干 ${hours} 小时，露点约 ${dewPoint(tempC, humidityPct)}℃。`;
}
