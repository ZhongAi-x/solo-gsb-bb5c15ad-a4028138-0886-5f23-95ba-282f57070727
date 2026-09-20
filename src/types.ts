// 核心数据模型

export type MatchResult = 'win' | 'draw' | 'loss' | null;

export interface Player {
  id: string;
  name: string;
  /** 可选队伍名称；填写后配对器优先回避同队对局。历史赛果不记录队伍，改队不影响已完成轮次 */
  team?: string;
}

/** 已确认的一场对局；bye 轮空也以 Match 表示（playerId 为轮空者） */
export interface Match {
  id: string;
  whiteId?: string; // 仅为兼容性保留，未使用
  blackId?: string;
  playerAId: string;
  playerBId: string | null; // null 表示轮空
  resultA: MatchResult; // A 的赛果；轮空时固定为 'win'
  bye?: boolean;
}

export interface Round {
  id: string;
  matches: Match[];
  /** 确认本轮时「本轮缺席」选手 id 的快照；旧数据缺省，读取时视为空名单 */
  absentIds?: string[];
}

/** 工作区中尚未确认的一条对阵（锁定行来自人工指定） */
export interface DraftPair {
  id: string;
  aId: string;
  bId: string | null; // null = 轮空
  locked: boolean;
}

export interface TournamentState {
  players: Player[];
  rounds: Round[];
}
