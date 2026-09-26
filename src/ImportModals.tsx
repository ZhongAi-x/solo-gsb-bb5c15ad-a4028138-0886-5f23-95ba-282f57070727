import type { ImportIssue, SnapshotPreview } from './snapshot';

interface ErrorsProps {
  errors: ImportIssue[];
  onClose: () => void;
}

/** 导入失败：按 JSON 路径列出全部问题；此阶段当前赛事未被修改 */
export function ImportErrorsModal({ errors, onClose }: ErrorsProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>✕ 快照校验未通过（{errors.length} 处问题）</h2>
        </div>
        <p className="hint">
          当前赛事未被修改。请按下列 JSON 路径修正文件后重新导入；存在任何一处问题都会整体拒绝，不会部分写入。
        </p>
        <ul className="issue-list">
          {errors.map((e, i) => (
            <li key={i}>
              <code>{e.path}</code>
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
        <div className="row end">
          <button className="btn primary" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

interface PreviewProps {
  preview: SnapshotPreview;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 导入预览：仅展示数量与问题提示，二次确认后才一次性替换当前赛事 */
export function ImportPreviewModal({ preview, onCancel, onConfirm }: PreviewProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>导入赛事快照</h2>
          <span className="pill">校验通过</span>
        </div>
        <div className="stats">
          <span className="stat">
            选手 <b>{preview.playerCount}</b>
          </span>
          <span className="stat">
            轮次 <b>{preview.roundCount}</b>
          </span>
          <span className="stat">
            对局 <b>{preview.matchCount}</b>
          </span>
          {preview.byeCount > 0 && (
            <span className="stat">
              轮空 <b>{preview.byeCount}</b>
            </span>
          )}
          {preview.absentRounds > 0 && (
            <span className="stat">
              含缺席名单轮次 <b>{preview.absentRounds}</b>
            </span>
          )}
          {preview.pendingResults > 0 && (
            <span className="stat">
              未录入赛果 <b className="danger-text">{preview.pendingResults}</b>
            </span>
          )}
        </div>
        {preview.warnings.length > 0 && (
          <ul className="warnings">
            {preview.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        )}
        <p className="hint warn">
          确认后将一次性替换当前赛事（选手、轮次与赛果），并清空下一轮工作区的临时锁定与缺席勾选；当前数据将被覆盖，不可恢复。
        </p>
        <div className="row end">
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn danger" onClick={onConfirm}>
            确认导入并替换当前赛事
          </button>
        </div>
      </div>
    </div>
  );
}
