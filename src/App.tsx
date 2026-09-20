import { useEffect, useMemo, useState } from 'react';
import type { DraftPair, Match, TournamentState } from './types';
import { computeStandings, type PairingPlan } from './engine';
import { clearState, loadState, saveState } from './storage';
import { uid } from './uid';
import { PlayersPanel } from './PlayersPanel';
import { StandingsTable } from './StandingsTable';
import { RoundsPanel } from './RoundsPanel';
import { NextRoundPanel } from './NextRoundPanel';

const DEMO_NAMES = ['阿尔法', '贝塔', '伽马', '德尔塔', '艾普西龙', '迪纳摩'];

export default function App() {
  const [state, setState] = useState<TournamentState>(() =>
    loadState() ?? { players: [], rounds: [] },
  );
  const [manual, setManual] = useState<DraftPair[]>([]);
  // 下一轮工作区中勾选的本轮缺席选手（确认轮次时快照写入 Round.absentIds）
  const [absentIds, setAbsentIds] = useState<string[]>([]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const standings = useMemo(
    () => computeStandings(state.players, state.rounds),
    [state.players, state.rounds],
  );
  const standingById = useMemo(
    () => new Map(standings.map((s) => [s.player.id, s])),
    [standings],
  );

  const addPlayers = (entries: { name: string; team?: string }[]) => {
    setState((s) => ({
      ...s,
      players: [
        ...s.players,
        ...entries.map((e) => ({ id: uid('p'), name: e.name, team: e.team || undefined })),
      ].slice(0, 32),
    }));
  };

  const removePlayer = (id: string) => {
    setState((s) => ({ ...s, players: s.players.filter((p) => p.id !== id) }));
    setAbsentIds((ids) => ids.filter((x) => x !== id));
  };

  /** 修改队伍（或清空）；队伍只属于选手资料，历史轮次按 id 记录，不受改队影响 */
  const updatePlayerTeam = (id: string, team: string) => {
    const trimmed = team.trim();
    setState((s) => ({
      ...s,
      players: s.players.map((p) =>
        p.id === id ? { ...p, team: trimmed ? trimmed : undefined } : p,
      ),
    }));
  };

  const setResult = (roundId: string, matchId: string, resultA: Match['resultA']) => {
    setState((s) => ({
      ...s,
      rounds: s.rounds.map((r) =>
        r.id !== roundId
          ? r
          : {
              ...r,
              matches: r.matches.map((m) => (m.id !== matchId ? m : { ...m, resultA })),
            },
      ),
    }));
  };

  const deleteRound = (roundId: string) => {
    setState((s) => {
      const idx = s.rounds.findIndex((r) => r.id === roundId);
      return { ...s, rounds: s.rounds.slice(0, idx) };
    });
    setManual([]);
    setAbsentIds([]);
  };

  const commitPlan = (plan: PairingPlan) => {
    const matches: Match[] = plan.pairs.map((p) => ({
      id: uid('m'),
      playerAId: p.aId,
      playerBId: p.bId,
      resultA: null,
      bye: false,
    }));
    if (plan.byeId) {
      matches.push({
        id: uid('m'),
        playerAId: plan.byeId,
        playerBId: null,
        resultA: 'win',
        bye: true,
      });
    }
    setState((s) => ({
      ...s,
      // 缺席名单随轮次快照保存，历史区据此展示；缺席不删除选手也不影响历史积分
      rounds: [...s.rounds, { id: uid('r'), matches, absentIds: [...absentIds] }],
    }));
    setManual([]);
    setAbsentIds([]);
  };

  const resetAll = () => {
    if (!window.confirm('将清空全部选手、轮次与赛果，且不可恢复，确定继续？')) return;
    clearState();
    setState({ players: [], rounds: [] });
    setManual([]);
    setAbsentIds([]);
  };

  const loadDemo = () => {
    if (state.players.length > 0 && !window.confirm('载入示例将覆盖当前数据，确定？')) return;
    const players = DEMO_NAMES.map((name) => ({
      id: uid('p'),
      name,
      // 前 3 人「红队」、后 3 人「蓝队」，演示同队回避
      team: DEMO_NAMES.indexOf(name) < 3 ? '红队' : '蓝队',
    }));
    const [a, b, c, d, e, f] = players;
    const win = (x: string, y: string): Match => ({
      id: uid('m'),
      playerAId: x,
      playerBId: y,
      resultA: 'win',
      bye: false,
    });
    setState({
      players,
      rounds: [
        { id: uid('r'), matches: [win(a.id, d.id), win(b.id, e.id), win(c.id, f.id)], absentIds: [] },
      ],
    });
    setManual([]);
    setAbsentIds([]);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>桌游联赛 · 瑞士制配对</h1>
          <p className="subtitle">
            最多 32 人 · 禁止重复交手 · 依次最小化同队对局数、跨积分组对局数与总积分差 · 奇数人自动轮空 · 支持本轮缺席
          </p>
        </div>
        <div className="top-actions">
          {(state.players.length === 0) && (
            <button className="btn ghost" onClick={loadDemo}>
              载入 6 人示例
            </button>
          )}
          {(state.players.length > 0 || state.rounds.length > 0) && (
            <button className="btn danger ghost" onClick={resetAll}>
              清空重置
            </button>
          )}
        </div>
      </header>

      <main className="layout">
        <div className="col">
          <PlayersPanel
            players={state.players}
            hasRounds={state.rounds.length > 0}
            onAdd={addPlayers}
            onRemove={removePlayer}
            onUpdateTeam={updatePlayerTeam}
          />
          <StandingsTable standings={standings} />
        </div>
        <div className="col wide">
          <NextRoundPanel
            players={state.players}
            rounds={state.rounds}
            manual={manual}
            absentIds={absentIds}
            onAbsentChange={setAbsentIds}
            onManualChange={setManual}
            onCommit={commitPlan}
          />
          <RoundsPanel
            rounds={state.rounds}
            standingById={standingById}
            onSetResult={setResult}
            onDeleteRound={deleteRound}
          />
        </div>
      </main>

      <footer className="footer">
        数据自动保存在本浏览器 localStorage 中，刷新不丢失；配对在浏览器本地完成。
      </footer>
    </div>
  );
}
