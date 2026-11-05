import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { GameId, OutcomeMode, Round, RoundResult } from '../core/types';

export type GameProps = {
  round: Round;
  /** 결과가 확정되면 호출. 사전 확정 게임은 인자 없이 호출한다. */
  onFinish(results?: RoundResult): void;
};

export type GameKind = 'watch' | 'play' | 'skill';

export type GameDef = {
  id: GameId;
  name: string;
  blurb: string;
  kind: GameKind;
  min: number;
  max: number;
  modes: OutcomeMode[];
  /** 1판 대략 소요 */
  time: string;
  /** 기록에서 같은 seed로 다시 볼 수 있는지 (연출이 seed로만 정해지는 게임) */
  replayable: boolean;
  Component: LazyExoticComponent<ComponentType<GameProps>>;
};

const ALL: OutcomeMode[] = ['loser', 'items', 'rank'];

export const GAMES: GameDef[] = [
  { id: 'ladder', name: '사다리타기', blurb: '한 줄씩 따라 내려가 결과 공개', kind: 'watch', min: 2, max: 12, modes: ALL, time: '30초', replayable: true, Component: lazy(() => import('./ladder/LadderGame')) },
  { id: 'roulette', name: '룰렛', blurb: '돌려서 멈춘 칸이 주인공', kind: 'watch', min: 2, max: 20, modes: ALL, time: '10초/회', replayable: true, Component: lazy(() => import('./roulette/RouletteGame')) },
  { id: 'marble', name: '구슬 레이스', blurb: '장애물을 뚫고 굴러 내려가는 이름 구슬', kind: 'watch', min: 2, max: 30, modes: ALL, time: '40초', replayable: true, Component: lazy(() => import('./marble/MarbleGame')) },
  { id: 'cards', name: '카드 뒤집기', blurb: '한 명씩 카드를 골라 뒤집기', kind: 'play', min: 2, max: 20, modes: ALL, time: '인원×5초', replayable: false, Component: lazy(() => import('./cards/CardsGame')) },
  { id: 'bomb', name: '폭탄 돌리기', blurb: '폰을 넘기다 터지는 사람이 주인공', kind: 'play', min: 2, max: 12, modes: ALL, time: '1~2분', replayable: false, Component: lazy(() => import('./bomb/BombGame')) },
  { id: 'horse', name: '동물 경주', blurb: '막판 역전이 있는 달리기 경주', kind: 'watch', min: 2, max: 12, modes: ALL, time: '25초', replayable: true, Component: lazy(() => import('./horse/HorseGame')) },
  { id: 'scratch', name: '스크래치 복권', blurb: '각자 은박을 긁어서 확인', kind: 'play', min: 2, max: 20, modes: ALL, time: '인원×10초', replayable: false, Component: lazy(() => import('./scratch/ScratchGame')) },
  { id: 'pirate', name: '해적 통', blurb: '칼을 꽂다 해적이 튀어나오면 끝', kind: 'play', min: 2, max: 12, modes: ALL, time: '1~2분', replayable: false, Component: lazy(() => import('./pirate/PirateGame')) },
  { id: 'stopwatch', name: '10초 맞추기', blurb: '숫자가 사라진 뒤 10초에 멈추기', kind: 'skill', min: 2, max: 20, modes: ALL, time: '인원×15초', replayable: false, Component: lazy(() => import('./stopwatch/StopwatchGame')) },
];

export const gameById = (id: GameId) => GAMES.find((g) => g.id === id)!;

/** 손가락 터치 뽑기는 이름 없이 바로 하는 즉석 모드라 목록과 따로 둔다 */
export const FINGER = { id: 'finger' as const, name: '손가락 터치 뽑기' };

export const GAME_NAMES: Record<GameId, string> = {
  ...(Object.fromEntries(GAMES.map((g) => [g.id, g.name])) as Record<GameId, string>),
  finger: FINGER.name,
};

/** 인원이 맞지 않으면 이유를 돌려준다 */
export function unavailableReason(g: GameDef, n: number): string | null {
  if (n < g.min) return `${g.min}명부터`;
  if (n > g.max) return `최대 ${g.max}명`;
  return null;
}
