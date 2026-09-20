import type { Standing } from './engine';
import { points2Label } from './engine';

interface Props {
  standings: Standing[];
}

export function StandingsTable({ standings }: Props) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>积分榜</h2>
        <span className="pill">胜 1 分 · 和 0.5 分 · 轮空 1 分</span>
      </div>
      {standings.length === 0 ? (
        <p className="hint">暂无选手。</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="c-rank">#</th>
                <th>选手</th>
                <th>队伍</th>
                <th>积分</th>
                <th>对手分(Buchholz)</th>
                <th>对局数</th>
                <th>轮空</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, i) => {
                const games = s.opponents.filter((o) => o !== null).length;
                return (
                  <tr key={s.player.id}>
                    <td className="c-rank">{i + 1}</td>
                    <td className="name">{s.player.name}</td>
                    <td className="muted">{s.player.team?.trim() || '—'}</td>
                    <td className="strong">{points2Label(s.points2)}</td>
                    <td>{points2Label(s.buchholz2)}</td>
                    <td>{games}</td>
                    <td>{s.hadBye ? '是' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
