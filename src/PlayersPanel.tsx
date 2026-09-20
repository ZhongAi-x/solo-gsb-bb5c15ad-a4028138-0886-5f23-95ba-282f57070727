import { useState } from 'react';
import type { Player } from './types';
import { teamOf } from './engine';

interface Props {
  players: Player[];
  hasRounds: boolean;
  onAdd: (entries: { name: string; team?: string }[]) => void;
  onRemove: (id: string) => void;
  onUpdateTeam: (id: string, team: string) => void;
}

const MAX_PLAYERS = 32;

/** 解析一行录入：形如「张三」或「张三|红队」（分隔符 | / 制表符 / : / ：） */
export function parsePlayerEntry(line: string): { name: string; team?: string } | null {
  const m = line.match(/^(.+?)[\t|:：](.+)$/);
  if (!m) {
    const name = line.trim();
    return name ? { name } : null;
  }
  const name = m[1].trim();
  const team = m[2].trim();
  if (!name) return null;
  return team ? { name, team } : { name };
}

export function PlayersPanel({ players, hasRounds, onAdd, onRemove, onUpdateTeam }: Props) {
  const [name, setName] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState('');

  const remaining = MAX_PLAYERS - players.length;

  const submitSingle = () => {
    const entry = parsePlayerEntry(name);
    if (!entry || remaining <= 0) return;
    onAdd([entry]);
    setName('');
  };

  const submitBulk = () => {
    const entries = bulk
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parsePlayerEntry)
      .filter((e): e is { name: string; team?: string } => e !== null)
      .slice(0, remaining);
    if (entries.length === 0) return;
    onAdd(entries);
    setBulk('');
    setBulkOpen(false);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>选手名单</h2>
        <span className="pill">
          {players.length} / {MAX_PLAYERS}
        </span>
      </div>

      <div className="row">
        <input
          value={name}
          placeholder="姓名；可带队伍，如 张三|红队"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSingle();
          }}
          disabled={remaining <= 0}
          maxLength={48}
        />
        <button className="btn primary" onClick={submitSingle} disabled={remaining <= 0 || !name.trim()}>
          添加
        </button>
        <button className="btn ghost" onClick={() => setBulkOpen((v) => !v)}>
          批量录入
        </button>
      </div>

      {bulkOpen && (
        <div className="bulk">
          <textarea
            value={bulk}
            rows={5}
            placeholder={
              '每行一名选手，格式「姓名|队伍」（也可用制表符或冒号分隔；队伍可省略）。例如：\n张三|红队\n李四|红队\n王五|蓝队\n赵六'
            }
            onChange={(e) => setBulk(e.target.value)}
          />
          <div className="row end">
            <button className="btn primary" onClick={submitBulk} disabled={!bulk.trim() || remaining <= 0}>
              导入（最多 {remaining} 人）
            </button>
          </div>
        </div>
      )}

      {remaining <= 0 && <p className="hint warn">已达到 {MAX_PLAYERS} 人上限。</p>}

      {players.length > 0 ? (
        <ul className="player-list">
          {players.map((p, i) => (
            <li key={p.id}>
              <span className="idx">{i + 1}</span>
              <span className="name" title={p.name}>
                {p.name}
              </span>
              <input
                className="team-input"
                value={teamOf(p)}
                placeholder="队伍（可选）"
                maxLength={16}
                title="修改队伍不影响历史赛果"
                onChange={(e) => onUpdateTeam(p.id, e.target.value)}
              />
              <button
                className="btn tiny danger"
                title="删除该选手"
                onClick={() => {
                  const msg = hasRounds
                    ? `删除「${p.name}」将保留历史轮次记录但其积分不再统计，确定删除？`
                    : `确定删除「${p.name}」？`;
                  if (window.confirm(msg)) onRemove(p.id);
                }}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">尚未录入选手，先添加至少 2 名选手。</p>
      )}
      {players.length > 0 && (
        <p className="hint">队伍名为可选字段；修改队伍即时生效，历史轮次按选手记录，赛果与积分不受影响。</p>
      )}
    </section>
  );
}
