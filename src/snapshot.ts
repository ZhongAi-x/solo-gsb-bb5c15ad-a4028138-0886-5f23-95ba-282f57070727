import type { Match, MatchResult, Player, Round, TournamentState } from './types';

/**
 * 赛事快照（导入/导出）。
 * 快照是自描述的：带 schemaVersion；当前版本与 localStorage 内的数据结构一致，
 * 旧版本（缺少 schemaVersion / absentIds）在解析时完成迁移与规范化。
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_KIND = 'swiss-pairing-snapshot';

export interface SnapshotIssue {
  /** 问题所在的 JSON 路径（如 $.rounds[0].matches[1].playerAId）；顶层结构问题可为空串 */
  path: string;
  message: string;
}

export interface SnapshotWarnings {
  /** 旧版迁移记录（如「缺少 schemaVersion，按旧版数据迁移」） */
  migrations: string[];
  /** 不阻塞导入的可疑点（重名选手、缺席快照引用了不存在的选手等） */
  issues: SnapshotIssue[];
}

export type SnapshotParseResult =
  | {
      ok: true;
      state: TournamentState;
      summary: SnapshotSummary;
      warnings: SnapshotWarnings;
    }
  | {
      ok: false;
      errors: SnapshotIssue[];
      warnings: SnapshotWarnings;
    };

export interface SnapshotSummary {
  playerCount: number;
  teamCount: number;
  roundCount: number;
  matchCount: number;
  byeCount: number;
  pendingResultCount: number;
}

// ---- 字段长度约束（仅用于拒绝异常文件；与 uid.ts 生成的 id 与录入上限相容） ----
const MAX_ID_LEN = 64;
const MAX_NAME_LEN = 48;
const MAX_TEAM_LEN = 24;
const MAX_IMPORT_PLAYERS = 32;
/** 非阻塞问题最多展示条数，避免异常文件刷出巨量信息 */
const MAX_WARNING_ISSUES = 50;

/** 生成当前赛事的快照 JSON 文本（带 schemaVersion，含选手/队伍/轮次/缺席快照/赛果） */
export function buildSnapshotJson(state: TournamentState): string {
  const snapshot = {
    kind: SNAPSHOT_KIND,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.team ? { team: p.team } : {}),
    })),
    rounds: state.rounds.map((r) => ({
      id: r.id,
      matches: r.matches.map((m) => matchToSnapshot(m)),
      // 当前版本始终写出缺席快照（空名单也显式写 []）
      absentIds: Array.isArray(r.absentIds) ? [...r.absentIds] : [],
    })),
  };
  return JSON.stringify(snapshot, null, 2);
}

function matchToSnapshot(m: Match) {
  return {
    id: m.id,
    playerAId: m.playerAId,
    playerBId: m.playerBId,
    resultA: m.resultA,
    bye: m.bye ?? m.playerBId === null,
  };
}

/** 建议的导出文件名：swiss-tournament-YYYYMMDD-HHMMSS.json */
export function snapshotFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `swiss-tournament-${stamp}.json`;
}

interface Collected {
  errors: SnapshotIssue[];
  issues: SnapshotIssue[];
  migrations: string[];
}

/** 解析并全量校验快照文本：所有错误一次性收集（按 JSON 路径），任何错误都不产出 state */
export function parseSnapshot(text: string): SnapshotParseResult {
  const collected: Collected = { errors: [], issues: [], migrations: [] };
  const warnings = (): SnapshotWarnings => ({
    migrations: collected.migrations,
    issues: collected.issues.slice(0, MAX_WARNING_ISSUES),
  });
  const fail = (): SnapshotParseResult => ({ ok: false, errors: collected.errors, warnings: warnings() });

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    collected.errors.push({
      path: '$',
      message: `文件不是合法 JSON：${e instanceof Error ? e.message : String(e)}`,
    });
    return fail();
  }

  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    collected.errors.push({ path: '$', message: '快照顶层必须是 JSON 对象。' });
    return fail();
  }
  const obj = root as Record<string, unknown>;

  // ---- schemaVersion 迁移 ----
  const version = obj.schemaVersion;
  if (version === undefined) {
    collected.migrations.push('缺少 schemaVersion，按旧版（v0）快照迁移。');
  } else if (typeof version !== 'number' || !Number.isInteger(version)) {
    collected.errors.push({ path: '$.schemaVersion', message: 'schemaVersion 必须是整数。' });
    return fail();
  } else if (version > SNAPSHOT_SCHEMA_VERSION) {
    collected.errors.push({
      path: '$.schemaVersion',
      message: `快照版本 v${version} 高于当前支持的 v${SNAPSHOT_SCHEMA_VERSION}，请升级应用后再导入。`,
    });
    return fail();
  } else if (version < SNAPSHOT_SCHEMA_VERSION) {
    collected.migrations.push(`快照为 v${version}，已迁移为 v${SNAPSHOT_SCHEMA_VERSION}。`);
  }

  // kind 仅作来源标识：值不符时警告，不阻塞
  if (obj.kind !== undefined && obj.kind !== SNAPSHOT_KIND) {
    collected.issues.push({
      path: '$.kind',
      message: `kind 不是「${SNAPSHOT_KIND}」（实际为 ${JSON.stringify(obj.kind)}），仍按快照格式解析。`,
    });
  }

  const players = parsePlayers(obj.players, collected);
  const playerIds = new Set(players.map((p) => p.id));
  const playerNames = new Map<string, string[]>();
  for (const p of players) {
    const list = playerNames.get(p.name) ?? [];
    list.push(p.id);
    playerNames.set(p.name, list);
  }
  for (const [name, ids] of playerNames) {
    if (ids.length > 1) {
      collected.issues.push({
        path: '$.players',
        message: `有 ${ids.length} 名选手同名「${name}」（积分榜将以 id 区分），请确认是否符合预期。`,
      });
    }
  }
  if (players.length > MAX_IMPORT_PLAYERS) {
    collected.errors.push({
      path: '$.players',
      message: `选手数 ${players.length} 超过上限 ${MAX_IMPORT_PLAYERS} 人，拒绝导入。`,
    });
  }

  // 选手结构错误会导致 id 集合不完整；仍然继续校验轮次结构，但引用类错误照常上报
  // rounds 缺省时视为零轮（仅有选手名单也是合法状态）
  const rounds = parseRounds(
    obj.rounds === undefined ? [] : obj.rounds,
    playerIds,
    players,
    collected,
  );

  if (collected.errors.length > 0) return fail();

  const state: TournamentState = { players, rounds };
  return {
    ok: true,
    state,
    summary: summarize(players, rounds),
    warnings: warnings(),
  };
}

function parsePlayers(raw: unknown, c: Collected): Player[] {
  if (!Array.isArray(raw)) {
    c.errors.push({ path: '$.players', message: 'players 必须是数组。' });
    return [];
  }
  const players: Player[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const base = `$.players[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      c.errors.push({ path: base, message: '选手必须是 JSON 对象。' });
      return;
    }
    const o = entry as Record<string, unknown>;

    const id = checkId(o.id, `${base}.id`, c);
    const name =
      typeof o.name === 'string' && o.name.trim() !== ''
        ? o.name.trim()
        : null;
    if (name === null) {
      c.errors.push({
        path: `${base}.name`,
        message: '选手姓名必须是非空字符串。',
      });
    } else if (name.length > MAX_NAME_LEN) {
      c.errors.push({
        path: `${base}.name`,
        message: `选手姓名长度 ${name.length} 超过上限 ${MAX_NAME_LEN}。`,
      });
    }

    let team: string | undefined;
    if (o.team !== undefined && o.team !== null) {
      if (typeof o.team !== 'string') {
        c.errors.push({ path: `${base}.team`, message: '队伍名必须是字符串。' });
      } else {
        const t = o.team.trim();
        if (t.length > MAX_TEAM_LEN) {
          c.errors.push({
            path: `${base}.team`,
            message: `队伍名长度 ${t.length} 超过上限 ${MAX_TEAM_LEN}。`,
          });
        } else if (t !== '') {
          team = t;
        }
      }
    }

    if (id === null || name === null) return;
    if (seen.has(id)) {
      c.errors.push({ path: `${base}.id`, message: `选手 id「${id}」重复，所有 id 必须唯一。` });
      return;
    }
    seen.add(id);
    players.push(team ? { id, name, team } : { id, name });
  });
  return players;
}

function checkId(raw: unknown, path: string, c: Collected): string | null {
  if (typeof raw !== 'string' || raw === '') {
    c.errors.push({ path, message: 'id 必须是非空字符串。' });
    return null;
  }
  if (raw.length > MAX_ID_LEN) {
    c.errors.push({ path, message: `id 长度 ${raw.length} 超过上限 ${MAX_ID_LEN}。` });
    return null;
  }
  return raw;
}

function parseRounds(
  raw: unknown,
  playerIds: Set<string>,
  players: Player[],
  c: Collected,
): Round[] {
  if (!Array.isArray(raw)) {
    c.errors.push({ path: '$.rounds', message: 'rounds 必须是数组。' });
    return [];
  }
  const rounds: Round[] = [];
  const seenRoundIds = new Set<string>();
  const seenMatchIds = new Set<string>();
  // 跨轮重复交手仅作警告（历史数据里可能本来就允许，快照不替业务规则裁决）
  const playedPairs = new Set<string>();

  raw.forEach((entry, ri) => {
    const base = `$.rounds[${ri}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      c.errors.push({ path: base, message: '轮次必须是 JSON 对象。' });
      return;
    }
    const o = entry as Record<string, unknown>;

    const roundId = checkId(o.id, `${base}.id`, c);
    if (roundId !== null) {
      if (seenRoundIds.has(roundId)) {
        c.errors.push({ path: `${base}.id`, message: `轮次 id「${roundId}」重复，所有 id 必须唯一。` });
      }
      seenRoundIds.add(roundId);
    }

    // ---- 缺席快照：旧版缺少时迁移为空数组 ----
    let absentIds: string[] = [];
    if (o.absentIds === undefined) {
      c.migrations.push(`第 ${ri + 1} 轮缺少 absentIds，迁移为空数组。`);
    } else if (!Array.isArray(o.absentIds)) {
      c.errors.push({ path: `${base}.absentIds`, message: 'absentIds 必须是字符串数组。' });
    } else {
      const absentSeen = new Set<string>();
      o.absentIds.forEach((aid, ai) => {
        const path = `${base}.absentIds[${ai}]`;
        if (typeof aid !== 'string' || aid === '') {
          c.errors.push({ path, message: '缺席选手 id 必须是非空字符串。' });
          return;
        }
        if (absentSeen.has(aid)) {
          c.issues.push({ path, message: `缺席名单中选手「${aid}」重复出现，已去重。` });
          return;
        }
        absentSeen.add(aid);
        if (!playerIds.has(aid)) {
          // 引用已删除选手：不阻塞（与应用中允许删除选手的行为相容），规范化时剔除
          c.issues.push({
            path,
            message: `缺席快照引用的选手 id「${aid}」不在选手名单中，导入时将忽略该条。`,
          });
          return;
        }
        absentIds.push(aid);
      });
    }

    const matches = parseMatches(
      o.matches,
      base,
      ri,
      playerIds,
      players,
      c,
      seenMatchIds,
      playedPairs,
      new Set(absentIds),
    );

    // 结构有效时才组装（match id 全部非法时仍保留空轮次）
    rounds.push({ id: roundId ?? `__invalid_round_${ri}`, matches, absentIds });
  });

  // 出现轮次 id 错误时，占位 id 不能进入规范化结果：直接标记错误后由上层拒绝；
  // 这里保持返回值形状即可（上层见到 errors 必拒绝）。
  return rounds;
}

function parseMatches(
  raw: unknown,
  roundPath: string,
  roundIndex: number,
  playerIds: Set<string>,
  players: Player[],
  c: Collected,
  seenMatchIds: Set<string>,
  playedPairs: Set<string>,
  roundAbsent: Set<string>,
): Match[] {
  if (!Array.isArray(raw)) {
    c.errors.push({ path: `${roundPath}.matches`, message: 'matches 必须是数组。' });
    return [];
  }

  const matches: Match[] = [];
  // 同轮选手不重复（playerA/playerB 任一位置都算；轮空选手也计入）
  const usedPlayers = new Set<string>();
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  raw.forEach((entry, mi) => {
    const base = `${roundPath}.matches[${mi}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      c.errors.push({ path: base, message: '对局必须是 JSON 对象。' });
      return;
    }
    const o = entry as Record<string, unknown>;

    const matchId = checkId(o.id, `${base}.id`, c);
    if (matchId !== null) {
      if (seenMatchIds.has(matchId)) {
        c.errors.push({ path: `${base}.id`, message: `对局 id「${matchId}」重复，所有 id 必须唯一。` });
      }
      seenMatchIds.add(matchId);
    }

    // ---- 选手引用 ----
    let aId: string | null = null;
    if (typeof o.playerAId !== 'string' || o.playerAId === '') {
      c.errors.push({ path: `${base}.playerAId`, message: 'playerAId 必须是非空字符串。' });
    } else if (!playerIds.has(o.playerAId)) {
      c.errors.push({
        path: `${base}.playerAId`,
        message: `对局引用的选手 id「${o.playerAId}」不存在于选手名单中。`,
      });
    } else {
      aId = o.playerAId;
    }

    let bId: string | null = null;
    if (o.playerBId !== null) {
      if (typeof o.playerBId !== 'string' || o.playerBId === '') {
        c.errors.push({
          path: `${base}.playerBId`,
          message: 'playerBId 必须是选手 id 字符串，或为 null（轮空）。',
        });
      } else if (!playerIds.has(o.playerBId)) {
        c.errors.push({
          path: `${base}.playerBId`,
          message: `对局引用的选手 id「${o.playerBId}」不存在于选手名单中。`,
        });
      } else {
        bId = o.playerBId;
      }
    }

    if (aId !== null && bId !== null && aId === bId) {
      c.errors.push({
        path: `${base}.playerBId`,
        message: `对局双方不能是同一名选手（${nameOf(aId)}）。`,
      });
    }

    // ---- 轮空结构 ----
    // 兼容旧数据未写 bye 的情况：按 playerBId === null 推断；显式值与结构矛盾则报错
    const isByeByStructure = bId === null;
    let bye = isByeByStructure;
    if (o.bye !== undefined && typeof o.bye !== 'boolean') {
      c.errors.push({ path: `${base}.bye`, message: 'bye 必须是布尔值。' });
    } else if (typeof o.bye === 'boolean') {
      if (o.bye !== isByeByStructure) {
        c.errors.push({
          path: `${base}.bye`,
          message: o.bye
            ? 'bye 为 true 的对局必须满足 playerBId 为 null（轮空结构不合法）。'
            : 'playerBId 为 null 的轮空对局必须满足 bye 为 true（轮空结构不合法）。',
        });
      }
      bye = o.bye && isByeByStructure;
    }

    // ---- 赛果取值 ----
    const result = checkResult(o.resultA, `${base}.resultA`, c, bye);

    // ---- 同轮选手不重复（含轮空者） ----
    if (aId !== null) {
      if (usedPlayers.has(aId)) {
        c.errors.push({
          path: `${base}.playerAId`,
          message: `选手「${nameOf(aId)}」在第 ${roundIndex + 1} 轮中重复出现在多场对局，同轮每名选手只能出现一次。`,
        });
      }
      usedPlayers.add(aId);
      if (roundAbsent.has(aId)) {
        c.errors.push({
          path: `${base}.playerAId`,
          message: `选手「${nameOf(aId)}」同时出现在第 ${roundIndex + 1} 轮的缺席名单与对局中。`,
        });
      }
    }
    if (bId !== null) {
      if (usedPlayers.has(bId)) {
        c.errors.push({
          path: `${base}.playerBId`,
          message: `选手「${nameOf(bId)}」在第 ${roundIndex + 1} 轮中重复出现在多场对局，同轮每名选手只能出现一次。`,
        });
      }
      usedPlayers.add(bId);
      if (roundAbsent.has(bId)) {
        c.errors.push({
          path: `${base}.playerBId`,
          message: `选手「${nameOf(bId)}」同时出现在第 ${roundIndex + 1} 轮的缺席名单与对局中。`,
        });
      }
    }

    // ---- 跨轮重复交手：非阻塞警告 ----
    if (aId !== null && bId !== null) {
      const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      if (playedPairs.has(key)) {
        c.issues.push({
          path: base,
          message: `选手「${nameOf(aId)}」与「${nameOf(bId)}」在历史轮次中已交手过，第 ${roundIndex + 1} 轮再次对阵，请确认。`,
        });
      }
      playedPairs.add(key);
    }

    // 引用非法的对局不进入规范化结果（反正整体会被拒绝），但保留占位以免索引错位
    if (aId === null || (o.playerBId !== null && bId === null) || matchId === null) {
      matches.push({
        id: matchId ?? `__invalid_match_${roundIndex}_${mi}`,
        playerAId: aId ?? '__invalid_player__',
        playerBId: o.playerBId === null ? null : bId,
        resultA: result ?? null,
        bye,
      });
      return;
    }

    const normalized: Match = {
      id: matchId,
      playerAId: aId,
      playerBId: bId,
      resultA: result ?? null,
      bye,
    };
    matches.push(normalized);
  });

  return matches;
}

function checkResult(
  raw: unknown,
  path: string,
  c: Collected,
  isBye: boolean,
): MatchResult | null {
  const valid: unknown[] = ['win', 'draw', 'loss', null];
  if (!valid.includes(raw)) {
    c.errors.push({
      path,
      message: `赛果取值无效：${JSON.stringify(raw)}；只允许 "win" / "draw" / "loss" / null。`,
    });
    return null;
  }
  const result = (raw ?? null) as MatchResult;
  if (isBye && result !== 'win') {
    c.errors.push({
      path,
      message: '轮空对局的 resultA 必须为 "win"（轮空按胜场计分）。',
    });
  }
  return result;
}

export function summarize(players: Player[], rounds: Round[]): SnapshotSummary {
  let matchCount = 0;
  let byeCount = 0;
  let pendingResultCount = 0;
  const teams = new Set<string>();
  for (const p of players) {
    const t = p.team?.trim() ?? '';
    if (t) teams.add(t);
  }
  for (const r of rounds) {
    for (const m of r.matches) {
      matchCount++;
      if (m.bye || m.playerBId === null) {
        byeCount++;
      } else if (m.resultA === null) {
        pendingResultCount++;
      }
    }
  }
  return {
    playerCount: players.length,
    teamCount: teams.size,
    roundCount: rounds.length,
    matchCount,
    byeCount,
    pendingResultCount,
  };
}
