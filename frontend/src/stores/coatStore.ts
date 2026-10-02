/**
 * 髹涂组侧状态管理（Zustand）
 * 维护道次顺序与状态推进，支持拖拽重排落库重编号、批量改漆种与状态。
 * 本侧职责（只写 coats 表）：
 * - 放行道次入荫：调用荫房侧申请接口；满位排队时道次留在本侧，可重试
 * - 待复检：单向订阅荫房温湿度判定，偏干/偏湿涉及的道次回到待复检，由髹涂组处理
 */
import { create } from 'zustand';
import { db, createId } from '@/utils/db';
import type { Coat, CoatDraft, CoatState, PaintType } from '@/types/coat';
import { nextCoatState } from '@/types/coat';
import { suggestIntervalHours, suggestPaintType } from '@/utils/humidity';
import { useBodyStore } from './bodyStore';
import { useRoomStore, type AdmissionApplyResult } from './roomStore';

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
  /** 髹涂组手动处理复检（清除 / 标记），只写本侧 */
  markRecheck: (bodyId: string, recheck: boolean) => Promise<void>;
  /** 放行道次入荫：申请由荫房侧落库；满位则票据排队、道次退回本侧重试 */
  releaseToRoom: (bodyId: string) => Promise<AdmissionApplyResult>;
  /** 读荫房侧只读判定，把偏干/偏湿涉及的未完成道次置为待复检（只置位、不清除） */
  syncRecheckFromRooms: () => Promise<void>;
  reorderCoats: (bodyId: string, orderedIds: string[]) => Promise<void>;
  nextSeq: (bodyId: string) => number;
  /** 同器型自动带出上次漆种与间隔建议 */
  suggestForBody: (bodyId: string) => PaintSuggestion;
}

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

  async markRecheck(bodyId, recheck) {
    const affected = get().coats.filter((coat) => coat.bodyId === bodyId && coat.state !== 'done');
    if (affected.length === 0) return;
    const now = Date.now();
    await db.coats.bulkPut(affected.map((coat) => ({ ...coat, needRecheck: recheck, updatedAt: now })));
    await get().loadCoats();
  },

  async releaseToRoom(bodyId) {
    // 放行是髹涂组的动作；入荫票据与架位占用写在荫房侧，本侧不代写
    const applyDate = new Date().toISOString().slice(0, 10);
    return useRoomStore.getState().applyAdmission({ bodyId, applyDate });
  },

  async syncRecheckFromRooms() {
    // 只读荫房侧判定：偏干 / 偏湿涉及胎体的未完成道次回到待复检，等髹涂组处理。
    // 只置位不清除——复检结论与清除由髹涂组手动做，避免把已处理的标记又翻回来。
    const { rooms } = useRoomStore.getState();
    const abnormalBodyIds = new Set(
      rooms.filter((room) => room.verdict !== 'suitable').map((room) => room.bodyId),
    );
    if (abnormalBodyIds.size === 0) return;
    const now = Date.now();
    const toMark = get()
      .coats.filter((coat) => abnormalBodyIds.has(coat.bodyId) && coat.state !== 'done' && !coat.needRecheck)
      .map((coat) => ({ ...coat, needRecheck: true, updatedAt: now }));
    if (toMark.length === 0) return;
    await db.coats.bulkPut(toMark);
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
 * 单向同步：荫房值班只落温湿度判定；判定变化后由髹涂组侧（本文件）
 * 把偏干 / 偏湿涉及的道次置为待复检。依赖方向仅 coat → room，room 侧不 import coat 侧。
 */
let lastRoomsRef: unknown[] | null = null;
let roomSyncReady = false;
useRoomStore.subscribe((state) => {
  if (state.rooms === lastRoomsRef) return;
  lastRoomsRef = state.rooms;
  roomSyncReady = true;
  void useCoatStore.getState().syncRecheckFromRooms();
});

/** 首屏载入顺序不保证 room 先就绪；App 初始化完成后补同步一次 */
export async function syncRecheckOnceReady(): Promise<void> {
  if (roomSyncReady) return;
  roomSyncReady = true;
  await useCoatStore.getState().syncRecheckFromRooms();
}

/** 道次派生选择器：按状态集合过滤 */
export function selectCoatsByStates(coats: Coat[], states: CoatState[]): Coat[] {
  if (states.length === 0) return coats;
  return coats.filter((coat) => states.includes(coat.state));
}
