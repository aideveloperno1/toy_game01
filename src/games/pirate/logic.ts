import type { Prng } from '../../core/rng';

/**
 * 구멍 수: 12 이상이면서 모두가 최소 2번은 꽂을 수 있는 인원의 가장 작은 배수.
 * 모든 사람이 같은 횟수만큼 꽂으므로 누가 먼저 하든 꽝 확률이 같다.
 */
export function holeCount(players: number): number {
  if (players < 1) throw new Error('players must be >= 1');
  return Math.max(2, Math.ceil(12 / players)) * players;
}

export type Barrel = { holes: number; bad: number; firstTurn: number };

/** 새 통: 꽝 구멍과 첫 차례를 seed로 정한다 */
export function newBarrel(players: number, prng: Prng): Barrel {
  const holes = holeCount(players);
  return { holes, bad: prng.int(holes), firstTurn: prng.int(players) };
}
