/**
 * useCoatProgress()：按胎体统计道次完成度、当前道次、荫干等待时长与复检标记
 * 被道次页（/coats）、荫房页（/rooms）、打磨页（/polish）与胎体页（/bodies）消费。
 */
import { useCallback, useMemo } from 'react';
import { useBodyStore } from '@/stores/bodyStore';
import { useCoatStore } from '@/stores/coatStore';
import { useRoomStore } from '@/stores/roomStore';
import { dryingHours, roomStayHours } from '@/utils/humidity';
import { ROOM_VERDICT_LABEL } from '@/types/room';
import { COAT_STATE_LABEL } from '@/types/coat';
import type { BodyStat } from '@/types/body';

const EMPTY_STAT: BodyStat = {
  bodyId: '',
  coatTotal: 0,
  coatDone: 0,
  coatPercent: 0,
  currentSeq: 0,
  roomCount: 0,
  roomOverCount: 0,
  lastRoomVerdict: '暂无记录',
  polishCount: 0,
  inlayCount: 0,
  dryingHours: 0,
};

export interface CoatProgressResult {
  /** 胎体 id → 统计 */
  map: Record<string, BodyStat>;
  /** 与胎体列表同序的统计数组 */
  list: BodyStat[];
  /** 汇总：道次总数 / 已完成 / 待复检 */
  totals: { coatTotal: number; coatDone: number; percent: number; recheck: number; roomOver: number };
  /** 取单个胎体的统计（不存在时返回空统计） */
  progressOf: (bodyId: string) => BodyStat;
  /** 取单个胎体的当前道次文案 */
  currentCoatText: (bodyId: string) => string;
}

export function useCoatProgress(): CoatProgressResult {
  const bodies = useBodyStore((state) => state.bodies);
  const coats = useCoatStore((state) => state.coats);
  const rooms = useRoomStore((state) => state.rooms);

  const map = useMemo<Record<string, BodyStat>>(() => {
    const result: Record<string, BodyStat> = {};
    bodies.forEach((body) => {
      const bodyCoats = coats
        .filter((coat) => coat.bodyId === body.id)
        .sort((a, b) => a.seq - b.seq);
      const bodyRooms = rooms
        .filter((room) => room.bodyId === body.id)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const done = bodyCoats.filter((coat) => coat.state === 'done').length;
      const current = bodyCoats.find((coat) => coat.state !== 'done');
      const lastRoom = bodyRooms[bodyRooms.length - 1];
      const overCount = bodyRooms.filter((room) => room.verdict !== 'suitable').length;
      const waitHours = lastRoom
        ? roomStayHours(lastRoom.inAt, lastRoom.outAt)
        : lastRoom === undefined && bodyCoats[0]
          ? dryingHours(24, 75, bodyCoats[0].thicknessUm)
          : 0;
      result[body.id] = {
        bodyId: body.id,
        coatTotal: bodyCoats.length,
        coatDone: done,
        coatPercent: bodyCoats.length === 0 ? 0 : Math.round((done / bodyCoats.length) * 100),
        currentSeq: current ? current.seq : 0,
        roomCount: bodyRooms.length,
        roomOverCount: overCount,
        lastRoomVerdict: lastRoom
          ? `${lastRoom.date}　${lastRoom.tempC}℃ / ${lastRoom.humidityPct}%（${ROOM_VERDICT_LABEL[lastRoom.verdict]}）`
          : '暂无记录',
        polishCount: 0,
        inlayCount: 0,
        dryingHours: waitHours,
      };
    });
    return result;
  }, [bodies, coats, rooms]);

  const list = useMemo(() => bodies.map((body) => map[body.id] ?? { ...EMPTY_STAT, bodyId: body.id }), [bodies, map]);

  const totals = useMemo(() => {
    const coatTotal = list.reduce((sum, item) => sum + item.coatTotal, 0);
    const coatDone = list.reduce((sum, item) => sum + item.coatDone, 0);
    return {
      coatTotal,
      coatDone,
      percent: coatTotal === 0 ? 0 : Math.round((coatDone / coatTotal) * 100),
      recheck: coats.filter((coat) => coat.needRecheck).length,
      roomOver: list.reduce((sum, item) => sum + item.roomOverCount, 0),
    };
  }, [coats, list]);

  const progressOf = useCallback(
    (bodyId: string): BodyStat => map[bodyId] ?? { ...EMPTY_STAT, bodyId },
    [map],
  );

  const currentCoatText = useCallback(
    (bodyId: string): string => {
      const stat = map[bodyId];
      if (!stat || stat.coatTotal === 0) return '尚未编排道次';
      const current = coats.find((coat) => coat.bodyId === bodyId && coat.seq === stat.currentSeq);
      if (!current) return `全部 ${stat.coatTotal} 道已完成`;
      return `第 ${current.seq} 道 · ${COAT_STATE_LABEL[current.state]}`;
    },
    [coats, map],
  );

  return { map, list, totals, progressOf, currentCoatText };
}

export default useCoatProgress;
