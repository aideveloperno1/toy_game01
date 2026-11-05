export type Participant = { id: string; name: string; color: string };

export type OutcomeItem = { label: string; count: number };

/**
 * 결과 구성.
 * - loser: K명에게 label(꽝/당첨 등)을 준다. good=true면 좋은 결과(당첨), false면 벌칙(꽝).
 * - items: 항목별 개수를 정해 배정하고 남는 사람은 "통과". good=false면 벌칙성 항목(밥값 등).
 * - rank: 1등부터 N등까지 전체 순위.
 */
export type OutcomeConfig =
  | { mode: 'loser'; count: number; label: string; good: boolean }
  | { mode: 'items'; items: OutcomeItem[]; good: boolean }
  | { mode: 'rank' };

export type OutcomeMode = OutcomeConfig['mode'];

/** 한 사람이 받는 결과 한 칸. */
export type Slot = {
  label: string;
  /** hit: 꽝/당첨/항목, pass: 통과, rank: 순위 */
  kind: 'hit' | 'pass' | 'rank';
  /** 좋은 결과인지 (연출 색과 문구에 사용) */
  good: boolean;
  rank?: number;
};

export type GameId =
  | 'ladder'
  | 'roulette'
  | 'marble'
  | 'cards'
  | 'bomb'
  | 'finger'
  | 'horse'
  | 'scratch'
  | 'pirate'
  | 'stopwatch';

export type Round = {
  id: string;
  createdAt: number;
  gameId: GameId;
  groupId?: string;
  participants: Participant[];
  config: OutcomeConfig;
  /** 32바이트 hex. 결과와 연출 난수가 모두 여기서 파생된다. */
  seed: string;
  /** 좋은 순서(0)부터 나쁜 순서까지의 결과 칸. */
  slots: Slot[];
  /** 사전 확정 순위: ranking[i] 참가자가 slots[i]를 받는다. */
  ranking: string[];
  /** 같은 참가자로 5분 안에 다시 한 횟수 (1이면 첫 판). */
  attempt: number;
};

export type RoundResult = Record<string, Slot>;

export type HistoryEntry = {
  online?: boolean;
  id: string;
  createdAt: number;
  gameId: GameId;
  groupId?: string;
  participants: Participant[];
  config: OutcomeConfig;
  seed: string;
  results: RoundResult;
  attempt: number;
  /** 손가락 뽑기처럼 이름 없이 한 판 */
  instant?: { total: number; picked: number };
};
