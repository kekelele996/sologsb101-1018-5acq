/**
 * 髹涂道次状态管理（Zustand）
 * 髹涂组侧职责：维护道次顺序与状态推进、待复检标记与放行。
 * 只写道次表；荫房温湿度越界时，由本侧读取荫房记录（只读）后自行把关联道次置为待复检，
 * 荫房侧不反向写入道次。放行（releaseRecheck）是髹涂组的显式动作。
 */
import { create } from 'zustand';
import { db, createId } from '@/utils/db';
import type { Coat, CoatDraft, CoatState, PaintType } from '@/types/coat';
import { nextCoatState } from '@/types/coat';
import { suggestIntervalHours, suggestPaintType } from '@/utils/humidity';
import { useBodyStore } from './bodyStore';
import { useRoomStore } from './roomStore';

export interface PaintSuggestion {
  paintType: PaintType;
  intervalHours: number;
  sourceCode: string;
  sourceColor: string;
}

interface CoatStoreState {
  coats: Coat[];
  loading: boolean;
  ready: boolean;
  error: string;
  loadCoats: () => Promise<void>;
  coatsOfBody: (bodyId: string) => Coat[];
  createCoat: (draft: CoatDraft) => Promise<Coat>;
  updateCoat: (id: string, patch: Partial<Coat>) => Promise<void>;
  removeCoat: (id: string) => Promise<void>;
  batchUpdate: (ids: string[], patch: Partial<Coat>) => Promise<void>;
  advanceState: (id: string) => Promise<void>;
  /** 同步荫房异常：读取荫房记录（只读），把偏干 / 偏湿胎体的未完成道次置为待复检（只写道次） */
  syncRecheckFromRooms: () => Promise<void>;
  /** 髹涂组放行：清除该胎体的待复检标记 */
  releaseRecheck: (bodyId: string) => Promise<void>;
  reorderCoats: (bodyId: string, orderedIds: string[]) => Promise<void>;
  nextSeq: (bodyId: string) => number;
  /** 同器型自动带出上次漆种与间隔建议 */
  suggestForBody: (bodyId: string) => PaintSuggestion;
}

/** 已同步到的荫房记录 updatedAt（按胎体），避免放行后被无关记录改动反复置回待复检 */
const syncedRoomAt: Record<string, number> = {};

export const useCoatStore = create<CoatStoreState>((set, get) => ({
  coats: [],
  loading: false,
  ready: false,
  error: '',

  async loadCoats() {
    set({ loading: true });
    try {
      const coats = await db.coats.toArray();
      coats.sort((a, b) => (a.bodyId === b.bodyId ? a.seq - b.seq : a.bodyId.localeCompare(b.bodyId)));
      set({ coats, loading: false, ready: true, error: '' });
    } catch (error) {
      set({ loading: false, ready: true, error: error instanceof Error ? error.message : '道次读取失败' });
    }
  },

  coatsOfBody(bodyId) {
    return get()
      .coats.filter((coat) => coat.bodyId === bodyId)
      .sort((a, b) => a.seq - b.seq);
  },

  async createCoat(draft) {
    const now = Date.now();
    const row: Coat = { ...draft, id: createId('coat'), createdAt: now, updatedAt: now };
    await db.coats.put(row);
    await get().loadCoats();
    return row;
  },

  async updateCoat(id, patch) {
    await db.coats.update(id, { ...patch, updatedAt: Date.now() } as never);
    await get().loadCoats();
  },

  async removeCoat(id) {
    const target = get().coats.find((coat) => coat.id === id);
    await db.coats.delete(id);
    if (target) {
      // 删除后按序重编号，保持 seq 连续
      const rest = get()
        .coats.filter((coat) => coat.bodyId === target.bodyId && coat.id !== id)
        .sort((a, b) => a.seq - b.seq)
        .map((coat, index) => ({ ...coat, seq: index + 1, updatedAt: Date.now() }));
      if (rest.length > 0) await db.coats.bulkPut(rest);
    }
    await get().loadCoats();
  },

  async batchUpdate(ids, patch) {
    if (ids.length === 0) return;
    const now = Date.now();
    const rows = get()
      .coats.filter((coat) => ids.includes(coat.id))
      .map((coat) => ({ ...coat, ...patch, updatedAt: now }));
    await db.coats.bulkPut(rows);
    await get().loadCoats();
  },

  async advanceState(id) {
    const coat = get().coats.find((item) => item.id === id);
    if (!coat) return;
    const next = nextCoatState(coat.state);
    if (next === coat.state) return;
    await get().updateCoat(id, { state: next });
  },

  async syncRecheckFromRooms() {
    // 只读荫房记录，只写自己侧（道次）
    const rooms = useRoomStore.getState().rooms;
    const coats = get().coats;
    // 道次尚未载入时不记高水位，避免「荫房先于道次载入」导致漏同步
    if (coats.length === 0) return;
    const now = Date.now();
    const latestByBody = new Map<string, (typeof rooms)[number]>();
    rooms.forEach((room) => {
      const prev = latestByBody.get(room.bodyId);
      if (!prev || room.updatedAt > prev.updatedAt) latestByBody.set(room.bodyId, room);
    });

    const toSet: Coat[] = [];
    latestByBody.forEach((room, bodyId) => {
      const synced = syncedRoomAt[bodyId] ?? 0;
      if (room.updatedAt <= synced) return;
      syncedRoomAt[bodyId] = room.updatedAt;
      if (room.verdict === 'suitable') return;
      coats
        .filter((coat) => coat.bodyId === bodyId && coat.state !== 'done' && !coat.needRecheck)
        .forEach((coat) => toSet.push({ ...coat, needRecheck: true, updatedAt: now }));
    });

    if (toSet.length === 0) return;
    await db.coats.bulkPut(toSet);
    await get().loadCoats();
  },

  async releaseRecheck(bodyId) {
    const affected = get().coats.filter((coat) => coat.bodyId === bodyId && coat.needRecheck);
    if (affected.length === 0) return;
    const now = Date.now();
    await db.coats.bulkPut(affected.map((coat) => ({ ...coat, needRecheck: false, updatedAt: now })));
    await get().loadCoats();
  },

  async reorderCoats(bodyId, orderedIds) {
    const indexOf = new Map(orderedIds.map((id, index) => [id, index]));
    const rows = get()
      .coats.filter((coat) => coat.bodyId === bodyId)
      .sort((a, b) => {
        const ai = indexOf.has(a.id) ? (indexOf.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
        const bi = indexOf.has(b.id) ? (indexOf.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
        return ai - bi;
      })
      .map((coat, index) => ({ ...coat, seq: index + 1, updatedAt: Date.now() }));
    await db.coats.bulkPut(rows);
    await get().loadCoats();
  },

  nextSeq(bodyId) {
    const list = get().coats.filter((coat) => coat.bodyId === bodyId);
    return list.length === 0 ? 1 : Math.max(...list.map((coat) => coat.seq)) + 1;
  },

  suggestForBody(bodyId) {
    const bodies = useBodyStore.getState().bodies;
    const current = bodies.find((body) => body.id === bodyId);
    const previousBody = bodies.find((body) => body.id !== bodyId && current !== undefined && body.shape === current.shape);
    const previousCoat = previousBody
      ? get()
          .coats.filter((coat) => coat.bodyId === previousBody.id)
          .sort((a, b) => a.seq - b.seq)
          .pop()
      : undefined;
    const paintType = suggestPaintType(get().nextSeq(bodyId), previousCoat?.paintType, current?.shape);
    return {
      paintType,
      intervalHours: suggestIntervalHours(paintType),
      sourceCode: previousBody?.code ?? '',
      sourceColor: previousCoat?.colorName ?? '',
    };
  },
}));

/**
 * 荫房侧记录变化时，髹涂组侧自行同步待复检（只读荫房记录，只写道次）。
 * 不反向：荫房值班不写髹涂道次。
 */
useRoomStore.subscribe(() => {
  void useCoatStore.getState().syncRecheckFromRooms();
});

/** 道次派生选择器：按状态集合过滤 */
export function selectCoatsByStates(coats: Coat[], states: CoatState[]): Coat[] {
  if (states.length === 0) return coats;
  return coats.filter((coat) => states.includes(coat.state));
}
