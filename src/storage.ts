import type { TournamentState } from './types';

const STORAGE_KEY = 'swiss-pairing-tournament-v1';

/**
 * 规范化（迁移）持久化数据：旧版本 Round 没有 absentIds 字段，
 * 升级时一律视为空缺席名单，其余数据原样保留。
 */
export function normalizeState(parsed: TournamentState): TournamentState {
  return {
    players: parsed.players,
    rounds: parsed.rounds.map((r) => ({
      ...r,
      absentIds: Array.isArray(r.absentIds) ? r.absentIds : [],
    })),
  };
}

export function loadState(): TournamentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TournamentState;
    if (!Array.isArray(parsed.players) || !Array.isArray(parsed.rounds)) return null;
    return normalizeState(parsed);
  } catch {
    return null;
  }
}

export function saveState(state: TournamentState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默降级（内存中仍可用）
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
