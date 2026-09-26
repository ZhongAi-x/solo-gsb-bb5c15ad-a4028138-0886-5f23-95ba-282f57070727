// 赛事快照导入 / 导出：构建带 schemaVersion 的 JSON 快照，
// 导入时先在内存完成规范化与全量校验，全部通过后才允许一次性替换当前赛事。

import type { Match, MatchResult, Player, Round, TournamentState } from './types';

/** 当前快照格式版本；导出时写入，导入时拒绝更高版本的文件 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** 与应用一致的人数上限 */
export const MAX_PLAYERS = 32;

export interface SnapshotFile {
  schemaVersion: number;
  exportedAt: string;
  players: Player[];
  rounds: Round[];
}

/** 单条导入问题：path 为 JSON 路径（如 rounds[0].matches[2].playerAId） */
export interface ImportIssue {
  path: string;
  message: string;
}

/** 校验通过后的导入预览（仅展示用，此阶段不改写当前赛事） */
export interface SnapshotPreview {
  state: TournamentState;
  playerCount: number;
  roundCount: number;
  matchCount: number;
  /** 未录入赛果的非轮空对局数 */
  pendingResults: number;
  byeCount: number;
  /** 含缺席名单的轮次数 */
  absentRounds: number;
  warnings: string[];
}

export type ParseSnapshotResult =
  | { ok: true; preview: SnapshotPreview }
  | { ok: false; errors: ImportIssue[] };

/** 生成导出快照（显式挑选字段，不写 whiteId/blackId 等兼容残留字段） */
export function buildSnapshot(state: TournamentState): SnapshotFile {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    players: state.players.map((p) => {
      const team = p.team?.trim();
      return team ? { id: p.id, name: p.name, team } : { id: p.id, name: p.name };
    }),
    rounds: state.rounds.map((r) => ({
      id: r.id,
      matches: r.matches.map((m) => ({
        id: m.id,
        playerAId: m.playerAId,
        playerBId: m.playerBId,
        resultA: m.resultA,
        bye: m.bye ?? m.playerBId === null,
      })),
      absentIds: [...(r.absentIds ?? [])],
    })),
  };
}

/** 浏览器端触发快照 JSON 文件下载 */
export function downloadSnapshot(state: TournamentState): void {
  const snap = buildSnapshot(state);
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `swiss-snapshot-${snap.exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * 解析并全量校验赛事快照：
 * 1) 规范化（迁移）：旧版缺少 absentIds 的轮次补为空名单；空队伍名视为无队伍；
 *    轮空场缺省补齐 bye/resultA；未标注 schemaVersion 按当前版本兼容处理；
 * 2) 全量校验：选手/轮次/对局 ID 唯一、对局引用存在的选手、同轮选手不重复、
 *    轮空结构合法（playerBId 为 null ⇔ 轮空，且赛果必须为 win）、赛果取值有效。
 * 所有问题一次性按 JSON 路径收集；存在任何错误即整体拒绝（禁止部分导入）。
 */
export function parseSnapshot(text: string): ParseSnapshotResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      errors: [
        { path: '$', message: `不是合法的 JSON 文件：${e instanceof Error ? e.message : String(e)}` },
      ],
    };
  }

  const errors: ImportIssue[] = [];
  const warnings: string[] = [];

  if (!isObj(raw)) {
    return { ok: false, errors: [{ path: '$', message: '快照根节点必须是 JSON 对象。' }] };
  }

  // ---- schemaVersion ----
  if (raw.schemaVersion === undefined) {
    warnings.push(`文件未标注 schemaVersion，已按版本 ${SNAPSHOT_SCHEMA_VERSION} 兼容处理。`);
  } else if (
    typeof raw.schemaVersion !== 'number' ||
    !Number.isInteger(raw.schemaVersion) ||
    raw.schemaVersion < 1
  ) {
    errors.push({ path: 'schemaVersion', message: 'schemaVersion 必须是正整数。' });
  } else if (raw.schemaVersion > SNAPSHOT_SCHEMA_VERSION) {
    errors.push({
      path: 'schemaVersion',
      message: `快照版本 ${raw.schemaVersion} 高于当前支持的版本 ${SNAPSHOT_SCHEMA_VERSION}，请使用本应用导出的文件。`,
    });
  }

  // ---- 顶层结构（不满足则无法继续深度校验） ----
  const playersOk = Array.isArray(raw.players);
  const roundsOk = Array.isArray(raw.rounds);
  if (!playersOk) errors.push({ path: 'players', message: 'players 必须是选手数组。' });
  if (!roundsOk) errors.push({ path: 'rounds', message: 'rounds 必须是轮次数组。' });
  if (!playersOk || !roundsOk) return { ok: false, errors };

  const rawPlayers = raw.players as unknown[];
  const rawRounds = raw.rounds as unknown[];

  // ---- 选手 ----
  const players: Player[] = [];
  const playerIds = new Set<string>();
  const nameById = new Map<string, string>();
  rawPlayers.forEach((p, i) => {
    const path = `players[${i}]`;
    if (!isObj(p)) {
      errors.push({ path, message: '选手必须是对象（含 id、name，可选 team）。' });
      return;
    }
    if (!isNonEmptyString(p.id)) {
      errors.push({ path: `${path}.id`, message: '选手 id 必须是非空字符串。' });
    } else if (playerIds.has(p.id)) {
      errors.push({ path: `${path}.id`, message: `选手 id「${p.id}」重复，id 必须全局唯一。` });
    } else {
      playerIds.add(p.id);
    }
    if (!isNonEmptyString(p.name)) {
      errors.push({ path: `${path}.name`, message: '选手姓名必须是非空字符串。' });
    }
    let team: string | undefined;
    if (p.team !== undefined && p.team !== null) {
      if (typeof p.team !== 'string') {
        errors.push({ path: `${path}.team`, message: '队伍名必须是字符串。' });
      } else {
        const t = p.team.trim();
        team = t === '' ? undefined : t; // 空队伍名规范化为「无队伍」
      }
    }
    if (isNonEmptyString(p.id) && isNonEmptyString(p.name)) {
      players.push(team ? { id: p.id, name: p.name, team } : { id: p.id, name: p.name });
      nameById.set(p.id, p.name);
    }
  });
  if (rawPlayers.length > MAX_PLAYERS) {
    errors.push({
      path: 'players',
      message: `选手共 ${rawPlayers.length} 人，超过上限 ${MAX_PLAYERS} 人。`,
    });
  }

  /** 错误消息中的选手展示：尽量带姓名 */
  const label = (id: string) => {
    const n = nameById.get(id);
    return n ? `「${n}」(${id})` : `「${id}」`;
  };

  // ---- 轮次与对局 ----
  const rounds: Round[] = [];
  const roundIds = new Set<string>();
  const matchIds = new Set<string>();
  let migratedAbsent = 0;

  rawRounds.forEach((r, ri) => {
    const rpath = `rounds[${ri}]`;
    if (!isObj(r)) {
      errors.push({ path: rpath, message: '轮次必须是对象（含 id、matches，可选 absentIds）。' });
      return;
    }

    let rid = '';
    if (!isNonEmptyString(r.id)) {
      errors.push({ path: `${rpath}.id`, message: '轮次 id 必须是非空字符串。' });
    } else if (roundIds.has(r.id)) {
      errors.push({ path: `${rpath}.id`, message: `轮次 id「${r.id}」重复，id 必须全局唯一。` });
    } else {
      rid = r.id;
      roundIds.add(r.id);
    }

    // 缺席名单：旧版缺省迁移为空数组；重复 id 规范化去重（不视为错误）
    let absentIds: string[] = [];
    if (r.absentIds === undefined || r.absentIds === null) {
      migratedAbsent += 1;
    } else if (!Array.isArray(r.absentIds)) {
      errors.push({ path: `${rpath}.absentIds`, message: '缺席名单 absentIds 必须是字符串数组。' });
    } else {
      const seen = new Set<string>();
      (r.absentIds as unknown[]).forEach((x, xi) => {
        if (!isNonEmptyString(x)) {
          errors.push({ path: `${rpath}.absentIds[${xi}]`, message: '缺席选手 id 必须是非空字符串。' });
        } else if (!playerIds.has(x)) {
          errors.push({
            path: `${rpath}.absentIds[${xi}]`,
            message: `缺席名单引用了不存在的选手「${x}」。`,
          });
        } else if (!seen.has(x)) {
          seen.add(x);
          absentIds.push(x);
        }
      });
    }

    if (!Array.isArray(r.matches)) {
      errors.push({ path: `${rpath}.matches`, message: 'matches 必须是对局数组。' });
      rounds.push({ id: rid, matches: [], absentIds });
      return;
    }

    const matches: Match[] = [];
    const inRound = new Set<string>(); // 同轮选手查重（含轮空者）
    (r.matches as unknown[]).forEach((m, mi) => {
      const mpath = `${rpath}.matches[${mi}]`;
      if (!isObj(m)) {
        errors.push({ path: mpath, message: '对局必须是对象（含 id、playerAId、playerBId、resultA）。' });
        return;
      }

      let mid = '';
      if (!isNonEmptyString(m.id)) {
        errors.push({ path: `${mpath}.id`, message: '对局 id 必须是非空字符串。' });
      } else if (matchIds.has(m.id)) {
        errors.push({ path: `${mpath}.id`, message: `对局 id「${m.id}」重复（跨轮次也必须唯一）。` });
      } else {
        mid = m.id;
        matchIds.add(m.id);
      }

      const aId = isNonEmptyString(m.playerAId) ? m.playerAId : '';
      if (!aId) {
        errors.push({ path: `${mpath}.playerAId`, message: 'playerAId 必须是非空字符串。' });
      } else if (!playerIds.has(aId)) {
        errors.push({ path: `${mpath}.playerAId`, message: `对局引用了不存在的选手「${aId}」。` });
      }

      // playerBId：null / 缺省 = 轮空
      let bId: string | null = null;
      const bRaw = m.playerBId;
      if (bRaw === undefined || bRaw === null) {
        bId = null;
      } else if (!isNonEmptyString(bRaw)) {
        errors.push({ path: `${mpath}.playerBId`, message: 'playerBId 必须是选手 id 或 null（轮空）。' });
      } else {
        bId = bRaw;
        if (!playerIds.has(bRaw)) {
          errors.push({ path: `${mpath}.playerBId`, message: `对局引用了不存在的选手「${bRaw}」。` });
        }
      }

      // 轮空结构：bye 标志（缺省时按 playerBId 推导）与 playerBId 不得矛盾
      if (m.bye !== undefined && typeof m.bye !== 'boolean') {
        errors.push({ path: `${mpath}.bye`, message: 'bye 必须是布尔值。' });
      }
      const isBye = bId === null;
      if (m.bye === true && bId !== null) {
        errors.push({ path: `${mpath}.playerBId`, message: 'bye 为 true 的轮空场不得填写 playerBId。' });
      }
      if (m.bye === false && bId === null) {
        errors.push({ path: `${mpath}.bye`, message: 'playerBId 为 null（轮空）时 bye 不能为 false。' });
      }

      // 赛果取值：缺省视为未录入（轮空场补 win）；非法值报错
      let resultA: MatchResult = null;
      let resultValid = true;
      const resRaw = m.resultA;
      if (resRaw === undefined || resRaw === null) {
        resultA = isBye ? 'win' : null;
      } else if (resRaw === 'win' || resRaw === 'draw' || resRaw === 'loss') {
        resultA = resRaw;
      } else {
        resultValid = false;
        errors.push({
          path: `${mpath}.resultA`,
          message: `赛果取值无效（${JSON.stringify(resRaw)}），只允许 "win" / "draw" / "loss" / null。`,
        });
      }
      if (resultValid && isBye && resultA !== 'win') {
        errors.push({ path: `${mpath}.resultA`, message: '轮空场次的赛果必须为 "win"（轮空计 1 分）。' });
      }

      if (aId && bId !== null && aId === bId) {
        errors.push({ path: `${mpath}.playerBId`, message: '对局双方不能是同一名选手。' });
      }
      for (const pid of [aId, bId]) {
        if (!pid) continue;
        if (inRound.has(pid)) {
          errors.push({
            path: mpath,
            message: `选手 ${label(pid)} 在同一轮中出现多次，每轮每人只能参加一场（含轮空）。`,
          });
        } else {
          inRound.add(pid);
        }
      }

      matches.push({ id: mid, playerAId: aId, playerBId: bId, resultA, bye: isBye });
    });

    // 缺席名单不得与本轮对局冲突
    for (const pid of absentIds) {
      if (inRound.has(pid)) {
        errors.push({
          path: `${rpath}.absentIds`,
          message: `选手 ${label(pid)} 既在本轮缺席名单中，又出现在本轮对局里。`,
        });
      }
    }

    rounds.push({ id: rid, matches, absentIds });
  });

  if (migratedAbsent > 0) {
    warnings.push(`${migratedAbsent} 个轮次缺少缺席名单字段（旧版数据），已按空名单迁移。`);
  }

  // 存在任何错误：整体拒绝，禁止部分导入
  if (errors.length > 0) return { ok: false, errors };

  const allMatches = rounds.flatMap((r) => r.matches);
  const pendingResults = allMatches.filter((m) => !m.bye && m.resultA === null).length;
  if (pendingResults > 0) {
    warnings.push(`有 ${pendingResults} 场对局尚未录入赛果，导入后可在「已完成轮次」补录。`);
  }

  return {
    ok: true,
    preview: {
      state: { players, rounds },
      playerCount: players.length,
      roundCount: rounds.length,
      matchCount: allMatches.length,
      pendingResults,
      byeCount: allMatches.filter((m) => m.bye).length,
      absentRounds: rounds.filter((r) => (r.absentIds ?? []).length > 0).length,
      warnings,
    },
  };
}
