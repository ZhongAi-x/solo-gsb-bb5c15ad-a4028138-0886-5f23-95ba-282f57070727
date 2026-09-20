import type { Match, Round } from './types';
import type { Standing } from './engine';

interface Props {
  rounds: Round[];
  standingById: Map<string, Standing>;
  onSetResult: (roundId: string, matchId: string, resultA: Match['resultA']) => void;
  onDeleteRound: (roundId: string) => void;
}

export function RoundsPanel({ rounds, standingById, onSetResult, onDeleteRound }: Props) {
  if (rounds.length === 0) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h2>已完成轮次</h2>
      </div>
      <div className="rounds">
        {rounds.map((round, ri) => {
          const missing = round.matches.some(
            (m) => !m.bye && m.playerBId !== null && m.resultA === null,
          );
          const absentIds = round.absentIds ?? [];
          return (
            <div key={round.id} className={`round ${missing ? 'missing' : ''}`}>
              <div className="round-head">
                <h3>
                  第 {ri + 1} 轮
                  {missing && <span className="tag warn">有赛果未录入</span>}
                </h3>
                <button
                  className="btn tiny danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        `删除第 ${ri + 1} 轮后，第 ${ri + 2} 轮及之后（如有）不会自动重排，确定删除？`,
                      )
                    ) {
                      onDeleteRound(round.id);
                    }
                  }}
                >
                  删除本轮
                </button>
              </div>
              {absentIds.length > 0 && (
                <p className="absent-note">
                  本轮缺席：
                  {absentIds
                    .map((id) => standingById.get(id)?.player.name ?? '（已删除选手）')
                    .join('、')}
                </p>
              )}
              <ul className="match-list">
                {round.matches.map((m) => (
                  <MatchRow
                    key={m.id}
                    match={m}
                    nameA={standingById.get(m.playerAId)?.player.name ?? '（已删除选手）'}
                    nameB={m.playerBId ? standingById.get(m.playerBId)?.player.name ?? '（已删除选手）' : null}
                    onSetResult={(r) => onSetResult(round.id, m.id, r)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MatchRow({
  match: m,
  nameA,
  nameB,
  onSetResult,
}: {
  match: Match;
  nameA: string;
  nameB: string | null;
  onSetResult: (r: Match['resultA']) => void;
}) {
  if (m.bye || m.playerBId === null) {
    return (
      <li className="match bye-row">
        <span className="player-name">{nameA}</span>
        <span className="tag">轮空（计 1 分）</span>
      </li>
    );
  }

  const result = m.resultA;
  return (
    <li className="match">
      <button
        className={`side ${result === 'win' ? 'win' : ''} ${result === 'loss' ? 'lose' : ''}`}
        title="A 获胜"
        onClick={() => onSetResult(result === 'win' ? null : 'win')}
      >
        {nameA}
      </button>
      <div className="result-controls">
        <button
          className={`mini ${result === 'win' ? 'active win-bg' : ''}`}
          onClick={() => onSetResult('win')}
        >
          {nameA} 胜
        </button>
        <button
          className={`mini ${result === 'draw' ? 'active draw-bg' : ''}`}
          onClick={() => onSetResult(result === 'draw' ? null : 'draw')}
        >
          和棋
        </button>
        <button
          className={`mini ${result === 'loss' ? 'active win-bg' : ''}`}
          onClick={() => onSetResult('loss')}
        >
          {nameB} 胜
        </button>
        {result === null && <span className="tag warn">未录入</span>}
      </div>
      <button
        className={`side right ${result === 'loss' ? 'win' : ''} ${result === 'win' ? 'lose' : ''}`}
        title="B 获胜"
        onClick={() => onSetResult(result === 'loss' ? null : 'loss')}
      >
        {nameB}
      </button>
    </li>
  );
}
