import type { SnapshotParseResult } from './snapshot';
import type { TournamentState } from './types';

interface Props {
  fileName: string;
  result: SnapshotParseResult;
  onCancel: () => void;
  /** 用户二次确认后一次性替换当前赛事 */
  onConfirm: (state: TournamentState) => void;
}

/** 导入前预览弹窗：校验通过只展示数量与问题预览，确认后才会改写当前赛事 */
export function ImportSnapshotDialog({ fileName, result, onCancel, onConfirm }: Props) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>导入赛事快照</h2>
          <span className="muted" title={fileName}>
            {fileName}
          </span>
        </div>

        {result.ok ? (
          <>
            <div className="snapshot-summary">
              <span className="stat">
                选手 <b>{result.summary.playerCount}</b>
              </span>
              <span className="stat">
                队伍 <b>{result.summary.teamCount}</b>
              </span>
              <span className="stat">
                轮次 <b>{result.summary.roundCount}</b>
              </span>
              <span className="stat">
                对局 <b>{result.summary.matchCount}</b>
              </span>
              <span className="stat">
                轮空 <b>{result.summary.byeCount}</b>
              </span>
              {result.summary.pendingResultCount > 0 && (
                <span className="stat">
                  赛果待录 <b className="danger-text">{result.summary.pendingResultCount}</b>
                </span>
              )}
            </div>

            {result.warnings.migrations.length > 0 && (
              <div className="snapshot-warnings">
                <h3>迁移记录</h3>
                <ul>
                  {result.warnings.migrations.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.warnings.issues.length > 0 ? (
              <div className="snapshot-warnings">
                <h3>问题预览（不阻塞导入）</h3>
                <ul>
                  {result.warnings.issues.map((iss, i) => (
                    <li key={i}>
                      <code className="json-path">{iss.path || '$'}</code>
                      {iss.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="hint">校验通过：ID 唯一、对局引用完整、同轮无重复选手、轮空结构与赛果取值均合法。</p>
            )}

            <p className="hint warn">
              确认后将<b>一次性替换</b>当前全部选手、轮次与赛果，并清空下一轮工作区的临时锁定与缺席勾选；
              此操作不可撤销。
            </p>

            <div className="modal-actions">
              <button className="btn ghost" onClick={onCancel}>
                取消
              </button>
              <button className="btn primary danger-bg" onClick={() => onConfirm(result.state)}>
                确认导入并替换当前赛事
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint warn">
              快照校验失败（共 {result.errors.length} 个问题），已禁止导入，当前赛事未做任何改动：
            </p>
            <div className="snapshot-errors">
              <ul>
                {result.errors.map((err, i) => (
                  <li key={i}>
                    <code className="json-path">{err.path || '$'}</code>
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
            {result.warnings.migrations.length > 0 && (
              <div className="snapshot-warnings">
                <h3>迁移记录</h3>
                <ul>
                  {result.warnings.migrations.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={onCancel}>
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
