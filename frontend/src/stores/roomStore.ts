/**
 * 荫房值班侧状态管理（Zustand）
 * 只落本侧两张表：
 * - rooms：温湿度记录（越界只给判定，不跨侧改道次）
 * - roomAdmissions：入荫申请、架位占用与排队
 * 架位容量固定（ROOM_SHELF_CAPACITY），入荫按申请先后排队；
 * 出房登记在同一事务内落温湿度记录、释放架位并把空位给队首。
 */
import { create } from 'zustand';
import { db, createId } from '@/utils/db';
import type { Room, RoomDraft } from '@/types/room';
import {
  ROOM_SHELF_CAPACITY,
  type Admission,
  type AdmissionDraft,
} from '@/types/admission';
import { judgeVerdict } from '@/utils/humidity';

/** 入荫申请结果：直接入位或排队（满位时带回前方积压件数） */
export interface AdmissionApplyResult {
  admission: Admission;
  /** admitted = 已占架位入房；waiting = 架位满，进入排队 */
  outcome: 'admitted' | 'waiting';
  /** 排队时前面还压着几件（不含自己） */
  aheadCount: number;
}

/** 出房登记结果：温湿度记录 + 是否自动放行了队首 */
export interface AdmissionExitResult {
  room: Room;
  /** 出房后被自动放行入位的队首申请（没有排队时为 null） */
  promoted: Admission | null;
}

/** 出房登记表单（温湿度由荫房值班填写） */
export interface AdmissionExitDraft extends RoomDraft {
  admissionId: string;
}

interface RoomStoreState {
  rooms: Room[];
  admissions: Admission[];
  loading: boolean;
  ready: boolean;
  error: string;
  loadRooms: () => Promise<void>;
  loadAdmissions: () => Promise<void>;
  roomsOfBody: (bodyId: string) => Room[];
  createRoom: (draft: RoomDraft) => Promise<Room>;
  updateRoom: (id: string, patch: Partial<Room>) => Promise<void>;
  removeRoom: (id: string) => Promise<void>;
  /** 入荫申请：有空位直接入位，满位按先后排队；同胎体已在排队/在房时幂等返回 */
  applyAdmission: (draft: AdmissionDraft) => Promise<AdmissionApplyResult>;
  /** 出房登记：落温湿度记录、释放架位、空位自动给队首 */
  registerExit: (draft: AdmissionExitDraft) => Promise<AdmissionExitResult>;
  /** 在房架位占用（0 ~ ROOM_SHELF_CAPACITY） */
  occupiedCount: () => number;
  /** 在房申请列表 */
  admittedList: () => Admission[];
  /** 排队列表（按申请先后） */
  waitingList: () => Admission[];
  /** 胎体当前有效的入荫申请（排队中 / 在房），无则 undefined */
  activeAdmissionOfBody: (bodyId: string) => Admission | undefined;
  /** 排队申请前还压着几件 */
  aheadCountOf: (admissionId: string) => number;
  /** 超标（偏干 / 偏湿）记录条数 */
  overCount: () => number;
  overCountOfBody: (bodyId: string) => number;
  verdictCount: () => Record<'suitable' | 'dry' | 'wet', number>;
}

const sortWaiting = (list: Admission[]): Admission[] =>
  [...list].sort((a, b) => (a.queuedAt === b.queuedAt ? a.createdAt - b.createdAt : a.queuedAt - b.queuedAt));

function currentHHmm(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export const useRoomStore = create<RoomStoreState>((set, get) => ({
  rooms: [],
  admissions: [],
  loading: false,
  ready: false,
  error: '',

  async loadRooms() {
    set({ loading: true });
    try {
      const rooms = await db.rooms.toArray();
      rooms.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      set({ rooms, loading: false, ready: true, error: '' });
    } catch (error) {
      set({ loading: false, ready: true, error: error instanceof Error ? error.message : '荫房记录读取失败' });
    }
  },

  async loadAdmissions() {
    try {
      const admissions = await db.roomAdmissions.toArray();
      admissions.sort((a, b) => b.queuedAt - a.queuedAt);
      set({ admissions, error: '' });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '入荫排队读取失败' });
    }
  },

  roomsOfBody(bodyId) {
    return get()
      .rooms.filter((room) => room.bodyId === bodyId)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  },

  async createRoom(draft) {
    const now = Date.now();
    const verdict = judgeVerdict(draft.tempC, draft.humidityPct);
    const row: Room = { ...draft, verdict, id: createId('room'), createdAt: now, updatedAt: now };
    await db.rooms.put(row);
    await get().loadRooms();
    return row;
  },

  async updateRoom(id, patch) {
    const existing = get().rooms.find((room) => room.id === id);
    if (!existing) return;
    const tempC = patch.tempC ?? existing.tempC;
    const humidityPct = patch.humidityPct ?? existing.humidityPct;
    const verdict = judgeVerdict(tempC, humidityPct);
    await db.rooms.update(id, { ...patch, tempC, humidityPct, verdict, updatedAt: Date.now() } as never);
    await get().loadRooms();
  },

  async removeRoom(id) {
    await db.rooms.delete(id);
    await get().loadRooms();
  },

  async applyAdmission(draft) {
    // 幂等：同胎体已有排队 / 在房申请时直接返回原票据，放行重试不产生新单
    const active = get()
      .admissions.filter((item) => item.bodyId === draft.bodyId && item.status !== 'exited')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (active) {
      const waiting = sortWaiting(get().admissions.filter((item) => item.status === 'waiting'));
      const aheadCount = active.status === 'waiting' ? waiting.findIndex((item) => item.id === active.id) : 0;
      return {
        admission: active,
        outcome: active.status === 'waiting' ? 'waiting' : 'admitted',
        aheadCount,
      };
    }

    const now = Date.now();
    const row: Admission = {
      id: createId('admission'),
      bodyId: draft.bodyId,
      applyDate: draft.applyDate,
      status: 'waiting',
      inAt: '',
      outAt: '',
      roomId: '',
      queuedAt: now,
      admittedAt: 0,
      exitedAt: 0,
      createdAt: now,
      updatedAt: now,
    };

    // 占位列计数必须在事务内完成，避免满位时并发互相踩架位
    await db.transaction('rw', db.roomAdmissions, async () => {
      const occupied = await db.roomAdmissions.where('status').equals('admitted').count();
      if (occupied < ROOM_SHELF_CAPACITY) {
        row.status = 'admitted';
        row.inAt = currentHHmm();
        row.admittedAt = now;
      }
      await db.roomAdmissions.put(row);
    });

    await get().loadAdmissions();
    const outcome: AdmissionApplyResult['outcome'] = row.status === 'waiting' ? 'waiting' : 'admitted';
    const aheadCount = outcome === 'waiting' ? get().aheadCountOf(row.id) : 0;
    return { admission: row, outcome, aheadCount };
  },

  async registerExit(draft) {
    const now = Date.now();
    const verdict = judgeVerdict(draft.tempC, draft.humidityPct);
    const room: Room = {
      id: createId('room'),
      bodyId: draft.bodyId,
      date: draft.date,
      tempC: draft.tempC,
      humidityPct: draft.humidityPct,
      inAt: draft.inAt,
      outAt: draft.outAt,
      verdict,
      createdAt: now,
      updatedAt: now,
    };

    let promoted: Admission | null = null;
    // 出房登记 + 释放架位 + 队首入位必须同一事务：先登记后让位，不让空位悬空
    await db.transaction('rw', db.rooms, db.roomAdmissions, async () => {
      const admission = await db.roomAdmissions.get(draft.admissionId);
      if (!admission || admission.status !== 'admitted') {
        throw new Error('该件不在房，无法登记出房');
      }
      await db.rooms.put(room);
      await db.roomAdmissions.update(admission.id, {
        status: 'exited',
        outAt: draft.outAt,
        roomId: room.id,
        exitedAt: now,
        updatedAt: now,
      });

      // 空位给队首：排队最久者先入位
      const head = await db.roomAdmissions.where('status').equals('waiting').sortBy('queuedAt');
      const next = head[0];
      if (next) {
        promoted = { ...next, status: 'admitted', inAt: currentHHmm(), admittedAt: now, updatedAt: now };
        await db.roomAdmissions.update(next.id, {
          status: 'admitted',
          inAt: currentHHmm(),
          admittedAt: now,
          updatedAt: now,
        });
      }
    });

    await Promise.all([get().loadRooms(), get().loadAdmissions()]);
    return { room, promoted };
  },

  occupiedCount() {
    return get().admissions.filter((item) => item.status === 'admitted').length;
  },

  admittedList() {
    return [...get().admissions.filter((item) => item.status === 'admitted')].sort((a, b) => a.admittedAt - b.admittedAt);
  },

  waitingList() {
    return sortWaiting(get().admissions.filter((item) => item.status === 'waiting'));
  },

  activeAdmissionOfBody(bodyId) {
    return get()
      .admissions.filter((item) => item.bodyId === bodyId && item.status !== 'exited')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  },

  aheadCountOf(admissionId) {
    return sortWaiting(get().admissions.filter((item) => item.status === 'waiting')).findIndex(
      (item) => item.id === admissionId,
    );
  },

  overCount() {
    return get().rooms.filter((room) => room.verdict !== 'suitable').length;
  },

  overCountOfBody(bodyId) {
    return get().rooms.filter((room) => room.bodyId === bodyId && room.verdict !== 'suitable').length;
  },

  verdictCount() {
    const result: Record<'suitable' | 'dry' | 'wet', number> = { suitable: 0, dry: 0, wet: 0 };
    get().rooms.forEach((room) => {
      result[room.verdict] += 1;
    });
    return result;
  },
}));

export { ROOM_SHELF_CAPACITY };
