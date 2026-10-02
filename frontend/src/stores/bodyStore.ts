/**
 * 胎体状态管理（Zustand）
 * 维护胎体列表、当前选中胎体与列表筛选条件；跨页状态不留在组件内。
 */
import { create } from 'zustand';
import { db, createId, readUiPrefs, writeUiPrefs, removeBodyCascade } from '@/utils/db';
import type { Body, BodyDraft, BodyMaterial, BodyShape } from '@/types/body';
import { nextBodyState } from '@/types/body';

export interface BodyFilters {
  keyword: string;
  materials: BodyMaterial[];
  shapes: BodyShape[];
}

export const DEFAULT_BODY_FILTERS: BodyFilters = { keyword: '', materials: [], shapes: [] };

interface BodyStoreState {
  bodies: Body[];
  loading: boolean;
  ready: boolean;
  error: string;
  currentBodyId: string | null;
  filters: BodyFilters;
  loadBodies: () => Promise<void>;
  setCurrentBodyId: (id: string | null) => void;
  setKeyword: (keyword: string) => void;
  setMaterials: (materials: BodyMaterial[]) => void;
  setShapes: (shapes: BodyShape[]) => void;
  resetFilters: () => void;
  createBody: (draft: BodyDraft) => Promise<Body>;
  updateBody: (id: string, patch: Partial<Body>) => Promise<void>;
  removeBody: (id: string) => Promise<void>;
  advanceBodyState: (id: string) => Promise<void>;
  bodyById: (id: string) => Body | undefined;
}

export const useBodyStore = create<BodyStoreState>((set, get) => ({
  bodies: [],
  loading: false,
  ready: false,
  error: '',
  currentBodyId: readUiPrefs().lastBodyId,
  filters: { ...DEFAULT_BODY_FILTERS },

  async loadBodies() {
    set({ loading: true });
    try {
      const bodies = await db.bodies.orderBy('updatedAt').reverse().toArray();
      const { currentBodyId } = get();
      const stillExists = currentBodyId !== null && bodies.some((body) => body.id === currentBodyId);
      set({ bodies, loading: false, ready: true, error: '', currentBodyId: stillExists ? currentBodyId : null });
    } catch (error) {
      set({ loading: false, ready: true, error: error instanceof Error ? error.message : '胎体读取失败' });
    }
  },

  setCurrentBodyId(id) {
    set({ currentBodyId: id });
    writeUiPrefs({ lastBodyId: id });
  },

  setKeyword(keyword) {
    set((state) => ({ filters: { ...state.filters, keyword } }));
  },

  setMaterials(materials) {
    set((state) => ({ filters: { ...state.filters, materials } }));
  },

  setShapes(shapes) {
    set((state) => ({ filters: { ...state.filters, shapes } }));
  },

  resetFilters() {
    set({ filters: { ...DEFAULT_BODY_FILTERS } });
  },

  async createBody(draft) {
    const now = Date.now();
    const row: Body = { ...draft, id: createId('body'), createdAt: now, updatedAt: now };
    await db.bodies.put(row);
    await get().loadBodies();
    get().setCurrentBodyId(row.id);
    return row;
  },

  async updateBody(id, patch) {
    await db.bodies.update(id, { ...patch, updatedAt: Date.now() } as never);
    await get().loadBodies();
  },

  async removeBody(id) {
    await removeBodyCascade(id);
    if (get().currentBodyId === id) get().setCurrentBodyId(null);
    await get().loadBodies();
  },

  async advanceBodyState(id) {
    const body = get().bodies.find((item) => item.id === id);
    if (!body) return;
    const next = nextBodyState(body.state);
    if (next === body.state) return;
    await get().updateBody(id, { state: next });
  },

  bodyById(id) {
    return get().bodies.find((body) => body.id === id);
  },
}));

/** 胎体列表派生选择器：关键字 + 材质 + 器型过滤（供页面 useMemo 调用） */
export function selectFilteredBodies(bodies: Body[], filters: BodyFilters): Body[] {
  const keyword = filters.keyword.trim();
  return bodies.filter((body) => {
    if (keyword.length > 0) {
      const haystack = `${body.code}${body.ownerName}${body.sizeMm}`;
      if (!haystack.includes(keyword)) return false;
    }
    if (filters.materials.length > 0 && !filters.materials.includes(body.material)) return false;
    if (filters.shapes.length > 0 && !filters.shapes.includes(body.shape)) return false;
    return true;
  });
}
