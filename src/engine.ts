import type { DraftPair, Player, Round } from './types';

// ===== 积分（内部使用整数半分制：1 分 = 2，和棋 = 1，负 = 0） =====

export const WIN_POINTS2 = 2;
export const DRAW_POINTS2 = 1;
export const LOSS_POINTS2 = 0;
export const BYE_POINTS2 = WIN_POINTS2; // 轮空按胜场计分

export function points2Label(points2: number): string {
  return points2 % 2 === 0 ? `${points2 / 2}` : `${(points2 / 2).toFixed(1)}`;
}

export interface Standing {
  player: Player;
  points2: number;
  opponents: (string | null)[]; // 同轮序对齐；轮空对手为 null
  hadBye: boolean;
  buchholz2: number; // 对手总积分（轮空轮次按自己当轮赛前积分近似不参与：见下）
}

/**
 * 计算积分排名。
 * Buchholz（对手分）：每个已对局对手的当前总积分之和；轮空轮不计入对手分。
 * 同分名次依次按：Buchholz、姓名、id。
 */
export function computeStandings(players: Player[], rounds: Round[]): Standing[] {
  const points2 = new Map<string, number>();
  const opponents = new Map<string, (string | null)[]>();
  const byeSet = new Set<string>();

  for (const p of players) {
    points2.set(p.id, 0);
    opponents.set(p.id, []);
  }

  for (const round of rounds) {
    for (const m of round.matches) {
      const listA = opponents.get(m.playerAId);
      const listB = m.playerBId !== null ? opponents.get(m.playerBId) : undefined;
      // 选手可能已被删除：只要一方仍存在就继续处理，缺失方视为无名对手（计 0 分）
      if (!listA && !listB) continue;

      if (m.bye || m.playerBId === null) {
        if (listA) {
          byeSet.add(m.playerAId);
          listA.push(null);
          points2.set(m.playerAId, (points2.get(m.playerAId) ?? 0) + BYE_POINTS2);
        }
        continue;
      }

      if (listA) listA.push(m.playerBId);
      if (listB) listB.push(m.playerAId);

      const ra = m.resultA;
      const addA = ra === 'win' ? WIN_POINTS2 : ra === 'draw' ? DRAW_POINTS2 : ra === 'loss' ? LOSS_POINTS2 : 0;
      const addB = ra === 'win' ? LOSS_POINTS2 : ra === 'draw' ? DRAW_POINTS2 : ra === 'loss' ? WIN_POINTS2 : 0;
      if (listA) points2.set(m.playerAId, (points2.get(m.playerAId) ?? 0) + addA);
      if (listB) points2.set(m.playerBId, (points2.get(m.playerBId) ?? 0) + addB);
      // 尚未录入赛果时双方均不加分
    }
  }

  const standings: Standing[] = players.map((player) => ({
    player,
    points2: points2.get(player.id) ?? 0,
    opponents: opponents.get(player.id) ?? [],
    hadBye: byeSet.has(player.id),
    buchholz2: 0,
  }));

  const byId = new Map(standings.map((s) => [s.player.id, s]));
  for (const s of standings) {
    let buch = 0;
    for (const oppId of s.opponents) {
      if (oppId !== null) buch += byId.get(oppId)?.points2 ?? 0;
    }
    s.buchholz2 = buch;
  }

  standings.sort((a, b) => {
    if (b.points2 !== a.points2) return b.points2 - a.points2;
    if (b.buchholz2 !== a.buchholz2) return b.buchholz2 - a.buchholz2;
    const nameCmp = a.player.name.localeCompare(b.player.name, 'zh-Hans-CN');
    if (nameCmp !== 0) return nameCmp;
    return a.player.id < b.player.id ? -1 : 1;
  });
  return standings;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 规范化队伍名：去首尾空白；空串视为无队伍（不参与同队回避） */
export function teamOf(player: Player): string {
  return player.team?.trim() ?? '';
}

/** 两名选手是否属于同一支（非空）队伍 */
export function sameTeam(a: Player, b: Player): boolean {
  const ta = teamOf(a);
  const tb = teamOf(b);
  return ta !== '' && ta === tb;
}

/** 历史上已经交手过的无序对局集合（轮空不算交手） */
export function buildPlayedMap(rounds: Round[]): Set<string> {
  const played = new Set<string>();
  for (const round of rounds) {
    for (const m of round.matches) {
      if (!m.bye && m.playerBId !== null) {
        played.add(pairKey(m.playerAId, m.playerBId));
      }
    }
  }
  return played;
}

// ===== 下一轮配对规划 =====

export interface PlanConflict {
  /** 关联的锁定行 id（若冲突来自人工指定） */
  pairId?: string;
  playerId?: string;
  message: string;
}

export interface PlanPair {
  aId: string;
  bId: string; // 非轮空对局
  locked: boolean;
  sameTeam: boolean;
  crossGroup: boolean;
  diff2: number;
}

export interface PairingPlan {
  ok: boolean;
  pairs: PlanPair[];
  byeId: string | null;
  teamConflictCount: number;
  crossCount: number;
  totalDiff2: number;
  conflicts: PlanConflict[];
  warnings: string[];
  optimal: boolean;
  note?: string;
}

export interface GenerateOptions {
  players: Player[];
  rounds: Round[];
  /** 人工指定（锁定）的对局，含未填写完整的行（bId 可能为 null） */
  manual: DraftPair[];
  /** 本轮缺席的选手 id：不参与配对、轮空候选与锁定校验；不删除选手，积分与历史保持不变 */
  absentIds?: string[];
}

const NODE_BUDGET = 300_000;

export function generatePairing(opts: GenerateOptions): PairingPlan {
  const { players, rounds, manual } = opts;
  const absent = new Set(opts.absentIds ?? []);
  const empty: PairingPlan = {
    ok: false,
    pairs: [],
    byeId: null,
    teamConflictCount: 0,
    crossCount: 0,
    totalDiff2: 0,
    conflicts: [],
    warnings: [],
    optimal: false,
  };
  const attendees = players.filter((p) => !absent.has(p.id));
  if (attendees.length < 2) {
    const message =
      absent.size > 0
        ? `本轮出席选手不足 2 人（出席 ${attendees.length} 人 / 缺席 ${absent.size} 人），无法生成对阵，请调整缺席名单。`
        : '至少需要 2 名选手才能开始配对。';
    return { ...empty, conflicts: [{ message }] };
  }

  // 积分始终按全体选手与全部历史轮次计算：缺席者不参赛但积分与排名数据不变
  const standings = computeStandings(players, rounds);
  const standingById = new Map(standings.map((s) => [s.player.id, s]));
  // 本轮实际参赛（出席）的选手：配对、轮空候选与锁定均只从其中产生
  const present = standings.filter((s) => !absent.has(s.player.id));
  const played = buildPlayedMap(rounds);
  const warnings: string[] = [];

  // ---- 1. 校验人工锁定行 ----
  const conflicts: PlanConflict[] = [];
  const seenLocked = new Set<string>();
  const lockedPairs: { pairId: string; aId: string; bId: string }[] = [];

  for (const row of manual) {
    if (!row.locked) continue;
    if (!row.aId || !row.bId) {
      conflicts.push({ pairId: row.id, message: '锁定行未填写完整：每一条锁定对局都必须选择两名选手。' });
      continue;
    }
    if (row.aId === row.bId) {
      conflicts.push({ pairId: row.id, playerId: row.aId, message: '锁定对局的双方不能是同一名选手。' });
      continue;
    }
    if (!standingById.has(row.aId) || !standingById.has(row.bId)) {
      conflicts.push({ pairId: row.id, message: '锁定对局引用了已不存在的选手，请重新选择。' });
      continue;
    }
    const absentSides = [row.aId, row.bId].filter((id) => absent.has(id));
    if (absentSides.length > 0) {
      const names = absentSides
        .map((id) => standingById.get(id)?.player.name ?? id)
        .join('、');
      conflicts.push({
        pairId: row.id,
        playerId: absentSides[0],
        message: `锁定对局包含本轮缺席选手（${names}）：请取消其缺席标记，或移除该锁定对局。`,
      });
      continue;
    }
    for (const pid of [row.aId, row.bId]) {
      if (seenLocked.has(pid)) {
        conflicts.push({
          pairId: row.id,
          playerId: pid,
          message: `选手「${standingById.get(pid)?.player.name ?? pid}」出现在多条锁定对局中，每人只能参加一场。`,
        });
      }
    }
    if (played.has(pairKey(row.aId, row.bId))) {
      const sa = standingById.get(row.aId)!;
      const sb = standingById.get(row.bId)!;
      conflicts.push({
        pairId: row.id,
        message: `锁定对局 ${sa.player.name} vs ${sb.player.name} 违反「禁止重复交手」：两人此前已经对阵过。`,
      });
    }
    seenLocked.add(row.aId);
    seenLocked.add(row.bId);
    lockedPairs.push({ pairId: row.id, aId: row.aId, bId: row.bId });
  }

  // 同队锁定对局合法但计入指标，给出明确提示
  for (const lp of lockedPairs) {
    const sa = standingById.get(lp.aId)!;
    const sb = standingById.get(lp.bId)!;
    if (sameTeam(sa.player, sb.player)) {
      warnings.push(
        `锁定对局 ${sa.player.name} vs ${sb.player.name} 为同队（${teamOf(sa.player)}队），按规则保留并计入同队对局指标。`,
      );
    }
  }

  if (conflicts.length > 0) return { ...empty, conflicts, warnings };

  // ---- 2. 轮空分配 ----
  const lockedIds = new Set<string>();
  for (const lp of lockedPairs) {
    lockedIds.add(lp.aId);
    lockedIds.add(lp.bId);
  }

  let byeId: string | null = null;
  const oddTotal = attendees.length % 2 === 1;
  if (oddTotal) {
    const candidates = present.filter((s) => !lockedIds.has(s.player.id));
    const noBye = candidates.filter((s) => !s.hadBye);
    let chosen: Standing | undefined;
    if (noBye.length > 0) {
      chosen = [...noBye].sort(compareByePriority)[0];
    } else {
      chosen = [...candidates].sort(compareByePriority)[0];
      warnings.push(
        `所有出席选手都已轮空过一次，本轮只能让积分最低的「${chosen?.player.name ?? ''}」再次轮空。`,
      );
    }
    if (!chosen) {
      conflicts.push({ message: '出席人数为奇数，但所有出席选手都被锁定对局占用，无人可以安排轮空。' });
      return { ...empty, conflicts, warnings };
    }
    // 若没有锁定，本应轮空的选手（全局：未轮空且积分最低）因被锁定而无法轮空
    const globalPool = noBye.length > 0 ? present.filter((s) => !s.hadBye) : present;
    const globalChoice = [...globalPool].sort(compareByePriority)[0];
    if (globalChoice && globalChoice.player.id !== chosen.player.id && lockedIds.has(globalChoice.player.id)) {
      warnings.push(
        `按积分与轮空规则，本应由「${globalChoice.player.name}」轮空，但其被锁定对局占用；` +
          `已改由未被锁定的选手中积分最低的「${chosen.player.name}」轮空。`,
      );
    }
    byeId = chosen.player.id;
  }

  // ---- 3. 自由选手与合法性矩阵 ----
  const free = present.filter((s) => s.player.id !== byeId && !lockedIds.has(s.player.id));
  if (free.length % 2 !== 0) {
    conflicts.push({ message: '内部错误：扣除轮空与锁定选手后剩余人数为奇数，无法两两配对。' });
    return { ...empty, conflicts, warnings };
  }

  const n = free.length;

  const legal: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ok = !played.has(pairKey(free[i].player.id, free[j].player.id));
      legal[i][j] = ok;
      legal[j][i] = ok;
    }
  }

  const legalDegree = (i: number, used: boolean[]) => {
    let d = 0;
    for (let j = 0; j < n; j++) if (!used[j] && legal[i][j]) d++;
    return d;
  };

  // ---- 4. 连通分量预检（奇分量 => 无解，并给出可读原因） ----
  const componentConflicts = checkComponents(free, legal, lockedPairs, played);
  if (componentConflicts) return { ...empty, conflicts: componentConflicts, warnings, byeId };

  // ---- 5. 分支限界搜索，字典序最小化 (同队对局数, 跨组数, 总积分差) ----
  // 积分组：相同 points2 为一组；队伍：同名的非空 team 为一组
  const distinctScores = [...new Set(free.map((s) => s.points2))].sort((a, b) => b - a);
  const groupAt = (i: number) => distinctScores.indexOf(free[i].points2);

  const edgeTeam = (i: number, j: number) => {
    const ti = teamOf(free[i].player);
    return ti !== '' && ti === teamOf(free[j].player) ? 1 : 0;
  };
  const edgeCross = (i: number, j: number) => (groupAt(i) === groupAt(j) ? 0 : 1);
  const edgeDiff = (i: number, j: number) => Math.abs(free[i].points2 - free[j].points2);

  // 锁定对局的指标固定计入方案（允许锁定同队对局，只统计不禁止）
  let lockedTeam = 0;
  let lockedCross = 0;
  let lockedDiff = 0;
  for (const lp of lockedPairs) {
    const sa = standingById.get(lp.aId)!;
    const sb = standingById.get(lp.bId)!;
    if (sameTeam(sa.player, sb.player)) lockedTeam++;
    if (sa.points2 !== sb.points2) lockedCross++;
    lockedDiff += Math.abs(sa.points2 - sb.points2);
  }

  /**
   * 给定剩余顶点集合的同队边数下界（割下界）：
   * 对任意一支队伍 T，每条非 T 队的边最多「接走」一名 T 队成员，
   * 故至少 max(0, |T| - (N - |T|)) 名 T 队成员只能内部配对，即至少 ceil(差/2) 条同队边；
   * 取所有队伍（含无队伍集合，其内部边不计同队，只需在普通队伍上计算）的最大值。
   * 奇人数场景再叠加奇偶下界。
   */
  function teamLowerBoundFor(remUsed: boolean[]): number {
    const counts = new Map<string, number>();
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (remUsed[i]) continue;
      total++;
      const t = teamOf(free[i].player);
      if (t !== '') counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    let lb = 0;
    for (const c of counts.values()) {
      const outside = total - c;
      if (c > outside) lb = Math.max(lb, Math.ceil((c - outside) / 2));
    }
    let odd = 0;
    for (const c of counts.values()) if (c % 2 === 1) odd++;
    return Math.max(lb, Math.floor(odd / 2));
  }

  // 当所有自由选手都属于（若干支）奇人数队伍时，任何完整配对的同队场数都恰好为奇偶下界，
  // 同队目标退化为常量：预置该值后搜索等价于两级目标，避免「全部同队」等场景的无谓枚举。
  let fixedTeam = 0;
  {
    const allInTeam = free.every((s) => teamOf(s.player) !== '');
    if (allInTeam) {
      const counts = new Map<string, number>();
      for (const s of free) {
        const t = teamOf(s.player);
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      let allOdd = true;
      for (const c of counts.values()) if (c % 2 === 0) allOdd = false;
      if (allOdd) fixedTeam = teamLowerBoundFor(new Array<boolean>(n).fill(false));
    }
  }

  const used = new Array<boolean>(n).fill(false);
  const chosenEdges: [number, number][] = [];
  let bestEdges: [number, number][] | null = null;
  // fixedTeam > 0 时同队目标已是常量（见上），预置其值后搜索等价于两级目标
  let bestTeam: number = lockedTeam + fixedTeam;
  let bestCross = Infinity;
  let bestDiff = Infinity;
  let nodes = 0;
  let aborted = false;

  /** 当前未用顶点跨组边数的奇偶下界（跨组边改变分组奇偶，奇数组 => 至少需跨组） */
  function crossParityLowerBound(): number {
    const counts = new Array<number>(distinctScores.length).fill(0);
    for (let i = 0; i < n; i++) if (!used[i]) counts[groupAt(i)]++;
    let need = 0;
    for (const c of counts) if (c % 2 === 1) need++;
    return Math.floor(need / 2);
  }

  function search(curTeam: number, curCross: number, curDiff: number) {
    if (++nodes > NODE_BUDGET) {
      aborted = true;
      return;
    }
    if (chosenEdges.length === n / 2) {
      const totTeam = lockedTeam + curTeam;
      const totCross = lockedCross + curCross;
      const totDiff = lockedDiff + curDiff;
      if (
        bestEdges === null ||
        totTeam < bestTeam ||
        (totTeam === bestTeam && totCross < bestCross) ||
        (totTeam === bestTeam && totCross === bestCross && totDiff < bestDiff)
      ) {
        bestTeam = totTeam;
        bestCross = totCross;
        bestDiff = totDiff;
        bestEdges = chosenEdges.slice();
      }
      return;
    }

    // 剪枝：同队/跨组割与奇偶下界 + 已有最优（按字典序比较）
    const lbT = curTeam + teamLowerBoundFor(used);
    if (bestEdges !== null) {
      if (lbT > bestTeam - lockedTeam) return;
      if (lbT === bestTeam - lockedTeam) {
        const lbC = curCross + crossParityLowerBound();
        if (lbC > bestCross - lockedCross) return;
        if (lbC === bestCross - lockedCross && lockedDiff + curDiff >= bestDiff) return;
      }
    } else if (fixedTeam > 0 && lbT > fixedTeam) {
      // 同队数已被证明为常量 fixedTeam：首个可行方案只需不超过该值；
      // 跨组/积分差的字典序剪枝等第一个可行方案出现后再生效
      return;
    }

    // MRV：可选合法搭档最少的未配对选手优先；同分优先（优先尝试组内，尽快得到优解）
    let pivot = -1;
    let pivotDegree = Infinity;
    let pivotScore = -Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const d = legalDegree(i, used);
      if (d === 0) return; // 死路
      const score = free[i].points2;
      if (d < pivotDegree || (d === pivotDegree && score > pivotScore)) {
        pivot = i;
        pivotDegree = d;
        pivotScore = score;
      }
    }

    const partners: number[] = [];
    for (let j = 0; j < n; j++) {
      if (!used[j] && j !== pivot && legal[pivot][j]) partners.push(j);
    }
    // 优先跨队（非同队）、组内、积分差小，利于先得到优解从而加强剪枝
    partners.sort((x, y) => {
      const tx = edgeTeam(pivot, x);
      const ty = edgeTeam(pivot, y);
      if (tx !== ty) return tx - ty;
      const cx = edgeCross(pivot, x);
      const cy = edgeCross(pivot, y);
      if (cx !== cy) return cx - cy;
      const dx = edgeDiff(pivot, x);
      const dy = edgeDiff(pivot, y);
      if (dx !== dy) return dx - dy;
      const scx = free[x].points2;
      const scy = free[y].points2;
      if (scx !== scy) return scy - scx;
      return x - y;
    });

    for (const j of partners) {
      used[pivot] = true;
      used[j] = true;
      chosenEdges.push([pivot, j]);
      search(curTeam + edgeTeam(pivot, j), curCross + edgeCross(pivot, j), curDiff + edgeDiff(pivot, j));
      chosenEdges.pop();
      used[j] = false;
      used[pivot] = false;
      if (aborted) return;
    }
  }

  search(0, 0, 0);

  if (!bestEdges) {
    return {
      ...empty,
      byeId,
      warnings,
      conflicts: buildInfeasibilityConflicts(free, legal, lockedPairs, played),
    };
  }
  const finalEdges: [number, number][] = bestEdges;

  // ---- 6. 组装结果（锁定对 + 自由对） ----
  const planPairs: PlanPair[] = [];
  let teamConflictCount = 0;
  let crossCount = 0;
  let totalDiff2 = 0;

  for (const lp of lockedPairs) {
    const sa = standingById.get(lp.aId)!;
    const sb = standingById.get(lp.bId)!;
    const isTeam = sameTeam(sa.player, sb.player);
    const cross = sa.points2 !== sb.points2;
    const diff = Math.abs(sa.points2 - sb.points2);
    if (isTeam) teamConflictCount++;
    if (cross) crossCount++;
    totalDiff2 += diff;
    planPairs.push({
      aId: lp.aId,
      bId: lp.bId,
      locked: true,
      sameTeam: isTeam,
      crossGroup: cross,
      diff2: diff,
    });
  }

  for (const [i, j] of finalEdges) {
    const isTeam = edgeTeam(i, j) === 1;
    const cross = edgeCross(i, j) === 1;
    const diff = edgeDiff(i, j);
    if (isTeam) teamConflictCount++;
    crossCount += cross ? 1 : 0;
    totalDiff2 += diff;
    planPairs.push({
      aId: free[i].player.id,
      bId: free[j].player.id,
      locked: false,
      sameTeam: isTeam,
      crossGroup: cross,
      diff2: diff,
    });
  }

  // 排序展示：高分组在前
  planPairs.sort((p, q) => {
    const sp = Math.max(standingById.get(p.aId)!.points2, standingById.get(p.bId)!.points2);
    const sq = Math.max(standingById.get(q.aId)!.points2, standingById.get(q.bId)!.points2);
    return sq - sp;
  });

  const result: PairingPlan = {
    ok: true,
    pairs: planPairs,
    byeId,
    teamConflictCount,
    crossCount,
    totalDiff2,
    conflicts: [],
    warnings,
    optimal: !aborted,
  };
  if (teamConflictCount > 0) {
    const involved: string[] = [];
    for (const p of planPairs) {
      if (!p.sameTeam) continue;
      involved.push(
        `${standingById.get(p.aId)!.player.name} vs ${standingById.get(p.bId)!.player.name}` +
          `（${teamOf(standingById.get(p.aId)!.player)}队${p.locked ? '·锁定' : ''}）`,
      );
    }
    result.note = `受历史交手与锁定约束限制，本轮无法完全回避同队对局；最少为 ${teamConflictCount} 场：${involved.join('；')}。`;
  }
  if (aborted) {
    result.warnings = [
      ...warnings,
      '搜索节点数达到上限，当前方案可行且较优，但不保证为严格最优；可减少锁定后重试。',
    ];
  }
  return result;
}

/** 轮空优先级：积分最低 → Buchholz 低 → 姓名 → id（computeStandings 为降序，这里独立排序） */
function compareByePriority(a: Standing, b: Standing): number {
  if (a.points2 !== b.points2) return a.points2 - b.points2;
  if (a.buchholz2 !== b.buchholz2) return a.buchholz2 - b.buchholz2;
  const nameCmp = a.player.name.localeCompare(b.player.name, 'zh-Hans-CN');
  if (nameCmp !== 0) return nameCmp;
  return a.player.id < b.player.id ? -1 : 1;
}

interface ComponentInfo {
  vertices: number[];
}

function computeComponents(n: number, legal: boolean[][]): ComponentInfo[] {
  const seen = new Array<boolean>(n).fill(false);
  const comps: ComponentInfo[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const verts: number[] = [];
    const stack = [s];
    seen[s] = true;
    while (stack.length) {
      const v = stack.pop()!;
      verts.push(v);
      for (let j = 0; j < n; j++) {
        if (!seen[j] && legal[v][j]) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
    comps.push({ vertices: verts });
  }
  return comps;
}

function checkComponents(
  free: Standing[],
  legal: boolean[][],
  lockedPairs: { pairId: string; aId: string; bId: string }[],
  _played: Set<string>,
): PlanConflict[] | null {
  const n = free.length;
  const comps = computeComponents(n, legal);
  const odd = comps.filter((c) => c.vertices.length % 2 === 1);
  if (odd.length === 0) return null;

  const conflicts: PlanConflict[] = [];
  for (const comp of odd) {
    if (comp.vertices.length === 1) {
      const s = free[comp.vertices[0]];
      conflicts.push({
        playerId: s.player.id,
        message: `选手「${s.player.name}」(${points2Label(s.points2)} 分) 在待配对选手中没有任何合法搭档：与其余所有人都已交手，或其余人全部被锁定占用。`,
      });
      // 列出其对手证据
      const others = free.filter((o) => o.player.id !== s.player.id);
      const blocked = others.filter((o) => _played.has(pairKey(s.player.id, o.player.id)));
      if (blocked.length > 0) {
        conflicts.push({
          playerId: s.player.id,
          message: `「${s.player.name}」已与以下选手交手过：${blocked.map((b) => b.player.name).join('、')}。`,
        });
      }
    } else {
      const names = comp.vertices.map((i) => free[i].player.name);
      conflicts.push({
        message: `存在 ${comp.vertices.length} 名选手只能在彼此之间配对（人数为奇数，无法两两配完）：${names.join('、')}。原因是他们与组外选手都已交手过。`,
      });
    }
  }
  if (lockedPairs.length > 0) {
    conflicts.push({ message: '可尝试解锁部分人工对局，或将锁定改为跨积分组安排后重新计算。' });
  }
  return conflicts;
}

function buildInfeasibilityConflicts(
  free: Standing[],
  legal: boolean[][],
  lockedPairs: { pairId: string; aId: string; bId: string }[],
  played: Set<string>,
): PlanConflict[] {
  // 通常奇分量预检已覆盖；这里处理「偶数顶点但无完美匹配」（如星形 K1,3）
  const n = free.length;
  const conflicts: PlanConflict[] = [];

  /** 排除顶点集合 removed 后，按 legal 边计算奇大小连通分量 */
  function oddComponentsAfter(removed: boolean[]): number[][] {
    const seen = new Array<boolean>(n).fill(false);
    const oddComps: number[][] = [];
    for (let s = 0; s < n; s++) {
      if (seen[s] || removed[s]) continue;
      const verts: number[] = [];
      const stack = [s];
      seen[s] = true;
      while (stack.length) {
        const v = stack.pop()!;
        verts.push(v);
        for (let j = 0; j < n; j++) {
          if (removed[j] || seen[j] || !legal[v][j]) continue;
          seen[j] = true;
          stack.push(j);
        }
      }
      if (verts.length % 2 === 1) oddComps.push(verts);
    }
    return oddComps;
  }

  // Tutte 定理：无完美匹配 ⇔ 存在顶点集 S 使 G-S 的奇分量数 > |S|。
  // 先尝试单点 S（K1,3 等常见瓶颈即为此类）。
  for (let v = 0; v < n; v++) {
    const removed = new Array<boolean>(n).fill(false);
    removed[v] = true;
    const oddComps = oddComponentsAfter(removed);
    if (oddComps.length > 1) {
      const center = free[v];
      conflicts.push({
        playerId: center.player.id,
        message:
          `选手「${center.player.name}」(${points2Label(center.points2)} 分) 是配对瓶颈：` +
          `其余选手中存在 ${oddComps.length} 个彼此无法连通的奇数人分组，他们都只能（或优先）与「${center.player.name}」配对，` +
          `但 TA 一轮只能参加一场，故至少有一个分组无法配完。`,
      });
      for (const comp of oddComps.slice(0, 6)) {
        const names = comp.map((i) => free[i].player.name).join('、');
        conflicts.push({ message: `奇数分组（${comp.length} 人）：${names}` });
      }
      break;
    }
  }

  if (conflicts.length === 0) {
    // 兜底：列出自由度最低的选手及其受限原因
    const degrees = free.map((_, i) => {
      let d = 0;
      for (let j = 0; j < n; j++) if (j !== i && legal[i][j]) d++;
      return d;
    });
    const minDeg = Math.min(...degrees);
    const stuck = free.filter((_, i) => degrees[i] === minDeg).slice(0, 4);
    for (const s of stuck) {
      const i = free.indexOf(s);
      const blocked = free.filter((o, j) => j !== i && played.has(pairKey(s.player.id, o.player.id)));
      conflicts.push({
        playerId: s.player.id,
        message:
          `「${s.player.name}」(${points2Label(s.points2)} 分) 仅剩 ${minDeg} 个未交手对象；` +
          (blocked.length > 0
            ? `已与 ${blocked.map((b) => b.player.name).join('、')} 交手过。`
            : '其余选手可能均被锁定对局占用。'),
      });
    }
  }

  if (lockedPairs.length > 0) {
    conflicts.push({ message: '可尝试解锁部分人工对局，或将锁定改为跨积分组安排后重新计算。' });
  }
  if (conflicts.length === 0) {
    conflicts.push({ message: '在「禁止重复交手」约束下找不到完整配对方案，请检查锁定对局或历史赛果。' });
  }
  return conflicts;
}
