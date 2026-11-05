import type { Prng } from '../../core/rng';

/** 카드 배치: layout[카드 위치] = 결과 칸 인덱스. 시작 시 seed로 확정된다. */
export function dealCards(slotCount: number, prng: Prng): number[] {
  return prng.shuffle(Array.from({ length: slotCount }, (_, i) => i));
}
