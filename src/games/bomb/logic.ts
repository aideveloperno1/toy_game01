import type { Prng } from '../../core/rng';

/**
 * 폭탄 한 판의 계획.
 * 꽝이 될 사람(target)을 먼저 정해두고, 1~3바퀴 뒤 그 사람 차례에 터지도록 탭 횟수를 정한다.
 * order: 자리 순서대로의 참가자 id (남은 사람만)
 */
export function planBomb(order: string[], target: string, prng: Prng) {
  const m = order.length;
  const targetPos = order.indexOf(target);
  if (targetPos < 0) throw new Error('target not in order');
  const start = prng.int(m);
  const laps = 1 + prng.int(3);
  const offset = (targetPos - start + m) % m;
  /** 0부터 센 탭 번호: 이 번호의 탭에서 터진다 */
  const explodeAt = laps * m + offset;
  return { start, explodeAt };
}

/** t번째 탭을 하는 사람 */
export function holderAt(order: string[], start: number, t: number): string {
  return order[(start + t) % order.length];
}
