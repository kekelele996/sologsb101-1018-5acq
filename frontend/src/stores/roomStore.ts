/**
 * 荫房状态管理（Zustand）
 * 荫房值班侧职责：只管荫房温湿度记录（Room）与架位占用（DryingEntry），
 * 不写髹涂道次；温湿度越界由髹涂组自行同步道次待复检（见 coatStore.syncRecheckFromRooms）。
 * 架位容量固定，入荫申请按先后排队，满位时排队；出房登记后空位给队首。
 */
import { create } from 'zustand';
import { db, createId } from '@/utils/db';
import type { Room, RoomDraft, RoomVerdict } from '@/types/room';
import { judgeVerdict } from '@/utils/humidity';
import {
  RACK_CAPACITY,
  dryingStamp,
  type DryingEntry,
  type DryingEntryStatus,
} from '@/types/drying';

/** 入荫申请结果：ok=false 表示失败已回滚，可重试；checkedIn=true 表示已分配架位 */
export interface ApplyResult {
  ok: boolean;
  entry?: DryingEntry;
  checkedIn?: boolean;
  /** 前面还压着的申请件数（排队中且 queueNo 更小） */
  aheadCount?: number;
  reason?: string;
  retryable?: boolean;
}

/** 出房登记结果：promoted 为补位的队首申请 */
export interface ExitResult {
  ok: boolean;
  reason?: string;
  retryable?: boolean;
  freedSlot?: number;
  promoted?: DryingEntry | null;
}

interface RackSlot {
  slotNo: number;
  entry: DryingEntry | null;
}

interface RoomStoreState {
  rooms: Room[];
  dryingEntries: DryingEntry[];
  loading: boolean;
  ready: boolean;
  error: string;
  loadRooms: () => Promise<void>;
  loadDryingEntries: () => Promise<void>;
  roomsOfBody: (bodyId: string) => Room[];
  createRoom: (draft: RoomDraft) => Promise<Room>;
  updateRoom: (id: string, patch: Partial<Room>) => Promise<void>;
  removeRoom: (id: string) => Promise<void>;
  /** 入荫申请：按先后排队，有空位则分配架位，满位则排队（事务回滚，已入房的不受影响） */
  applyForEntry: (bodyId: string) => Promise<ApplyResult>;
  /** 出房登记：释放架位并把空位给队首（事务回滚，已入房的不受影响） */
  registerExit: (entryId: string) => Promise<ExitResult>;
  /** 退回排队中的申请 */
  rejectEntry: (entryId: string, reason: string) => Promise<void>;
  /** 已退回的申请重新排队 */
  retryEntry: (entryId: string) => Promise<ApplyResult>;
  entriesOfBody: (bodyId: string) => DryingEntry[];
  inRoomEntries: () => DryingEntry[];
  queuedEntries: () => DryingEntry[];
  rejectedEntries: () => DryingEntry[];
  /** 某条排队申请前面还压着几件 */
  aheadCountOf: (entryId: string) => number;
  /** 架位视图：1..RACK_CAPACITY 及占用情况 */
  rackSlots: () => RackSlot[];
  occupiedSlotCount: () => number;
  overCount: () => number;
  overCountOfBody: (bodyId: string) => number;
  verdictCount: () => Record<RoomVerdict, number>;
}

export const useRoomStore = create<RoomStoreState>((set, get) => ({
  rooms: [],
  dryingEntries: [],
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

  async loadDryingEntries() {
    try {
      const dryingEntries = await db.dryingEntries.toArray();
      dryingEntries.sort((a, b) => a.queueNo - b.queueNo);
      set({ dryingEntries });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '架位占用读取失败' });
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
    // 荫房侧只记录温湿度；偏干偏湿由髹涂组自行同步道次待复检，此处不写道次
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

  async applyForEntry(bodyId) {
    const state = get();
    const duplicate = state.dryingEntries.find(
      (entry) => entry.bodyId === bodyId && (entry.status === 'queued' || entry.status === 'inRoom'),
    );
    if (duplicate) {
      return {
        ok: false,
        entry: duplicate,
        reason: duplicate.status === 'inRoom' ? '该胎体已在荫房内' : '该胎体已在排队中',
      };
    }

    const now = Date.now();
    const queueNo = state.dryingEntries.reduce((max, entry) => Math.max(max, entry.queueNo), 0) + 1;
    const occupied = state.dryingEntries.filter((entry) => entry.status === 'inRoom');
    const usedSlots = new Set(occupied.map((entry) => entry.slotNo).filter((n): n is number => n !== null));
    let slotNo: number | null = null;
    for (let n = 1; n <= RACK_CAPACITY; n += 1) {
      if (!usedSlots.has(n)) {
        slotNo = n;
        break;
      }
    }
    const checkedIn = slotNo !== null;
    const entry: DryingEntry = {
      id: createId('entry'),
      bodyId,
      queueNo,
      status: checkedIn ? 'inRoom' : 'queued',
      slotNo,
      inAt: checkedIn ? dryingStamp() : null,
      outAt: null,
      roomId: null,
      rejectReason: '',
      createdAt: now,
      updatedAt: now,
    };

    try {
      // 单侧事务：只写荫房侧的入荫申请；失败整体回滚，已入房的条目不受影响
      await db.transaction('rw', db.dryingEntries, async () => {
        await db.dryingEntries.put(entry);
      });
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : '入荫失败，已回滚本次申请',
        retryable: true,
      };
    }

    await get().loadDryingEntries();
    if (checkedIn) return { ok: true, entry, checkedIn: true, aheadCount: 0 };
    const ahead = get().queuedEntries().filter((item) => item.queueNo < entry.queueNo).length;
    return { ok: true, entry, checkedIn: false, aheadCount: ahead };
  },

  async registerExit(entryId) {
    const state = get();
    const entry = state.dryingEntries.find((item) => item.id === entryId);
    if (!entry || entry.status !== 'inRoom' || entry.slotNo === null) {
      return { ok: false, reason: '该条申请不在房内，无法出房登记' };
    }

    const now = Date.now();
    const stamp = dryingStamp();
    const freedSlot = entry.slotNo;
    // 空位给队首：排队中 queueNo 最小的申请补位
    const promoted = state.queuedEntries().sort((a, b) => a.queueNo - b.queueNo)[0] ?? null;

    try {
      // 单侧事务：出房与补位同生共死；失败回滚，已入房的照旧
      await db.transaction('rw', db.dryingEntries, async () => {
        await db.dryingEntries.put({ ...entry, status: 'exited', slotNo: null, outAt: stamp, updatedAt: now });
        if (promoted) {
          await db.dryingEntries.put({
            ...promoted,
            status: 'inRoom',
            slotNo: freedSlot,
            inAt: stamp,
            outAt: null,
            updatedAt: now,
          });
        }
      });
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : '出房登记失败，已回滚',
        retryable: true,
      };
    }

    await get().loadDryingEntries();
    return { ok: true, freedSlot, promoted };
  },

  async rejectEntry(entryId, reason) {
    const entry = get().dryingEntries.find((item) => item.id === entryId);
    if (!entry || entry.status !== 'queued') return;
    await db.dryingEntries.put({
      ...entry,
      status: 'rejected' as DryingEntryStatus,
      rejectReason: reason.trim() || '排队已满，退回待重试',
      updatedAt: Date.now(),
    });
    await get().loadDryingEntries();
  },

  async retryEntry(entryId) {
    const entry = get().dryingEntries.find((item) => item.id === entryId);
    if (!entry || entry.status !== 'rejected') {
      return { ok: false, reason: '仅已退回的申请可重试' };
    }

    const now = Date.now();
    const queueNo = get().dryingEntries.reduce((max, item) => Math.max(max, item.queueNo), 0) + 1;
    const usedSlots = new Set(
      get()
        .inRoomEntries()
        .map((item) => item.slotNo)
        .filter((n): n is number => n !== null),
    );
    let slotNo: number | null = null;
    for (let n = 1; n <= RACK_CAPACITY; n += 1) {
      if (!usedSlots.has(n)) {
        slotNo = n;
        break;
      }
    }
    const checkedIn = slotNo !== null;
    const updated: DryingEntry = {
      ...entry,
      queueNo,
      status: checkedIn ? 'inRoom' : 'queued',
      slotNo,
      inAt: checkedIn ? dryingStamp() : null,
      outAt: null,
      rejectReason: '',
      updatedAt: now,
    };

    try {
      await db.transaction('rw', db.dryingEntries, async () => {
        await db.dryingEntries.put(updated);
      });
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : '重试失败，已回滚',
        retryable: true,
      };
    }

    await get().loadDryingEntries();
    if (checkedIn) return { ok: true, entry: updated, checkedIn: true, aheadCount: 0 };
    const ahead = get().queuedEntries().filter((item) => item.queueNo < updated.queueNo).length;
    return { ok: true, entry: updated, checkedIn: false, aheadCount: ahead };
  },

  entriesOfBody(bodyId) {
    return get()
      .dryingEntries.filter((entry) => entry.bodyId === bodyId)
      .sort((a, b) => a.queueNo - b.queueNo);
  },

  inRoomEntries() {
    return get()
      .dryingEntries.filter((entry) => entry.status === 'inRoom')
      .sort((a, b) => (a.slotNo ?? 0) - (b.slotNo ?? 0));
  },

  queuedEntries() {
    return get()
      .dryingEntries.filter((entry) => entry.status === 'queued')
      .sort((a, b) => a.queueNo - b.queueNo);
  },

  rejectedEntries() {
    return get()
      .dryingEntries.filter((entry) => entry.status === 'rejected')
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  aheadCountOf(entryId) {
    const entry = get().dryingEntries.find((item) => item.id === entryId);
    if (!entry || entry.status !== 'queued') return 0;
    return get().dryingEntries.filter((item) => item.status === 'queued' && item.queueNo < entry.queueNo).length;
  },

  rackSlots() {
    const inRoom = get().inRoomEntries();
    const bySlot = new Map<number, DryingEntry>();
    inRoom.forEach((entry) => {
      if (entry.slotNo !== null) bySlot.set(entry.slotNo, entry);
    });
    const slots: RackSlot[] = [];
    for (let n = 1; n <= RACK_CAPACITY; n += 1) {
      slots.push({ slotNo: n, entry: bySlot.get(n) ?? null });
    }
    return slots;
  },

  occupiedSlotCount() {
    return get().inRoomEntries().length;
  },

  overCount() {
    return get().rooms.filter((room) => room.verdict !== 'suitable').length;
  },

  overCountOfBody(bodyId) {
    return get().rooms.filter((room) => room.bodyId === bodyId && room.verdict !== 'suitable').length;
  },

  verdictCount() {
    const result: Record<RoomVerdict, number> = { suitable: 0, dry: 0, wet: 0 };
    get().rooms.forEach((room) => {
      result[room.verdict] += 1;
    });
    return result;
  },
}));
