import type { Prng } from '../../core/rng';

/**
 * 순위를 먼저 정하고, 그 순서로 들어오도록 각 주자의 진행 곡선을 만든다.
 * 반환: 주자별 [시간(초), 진행률 0~1] 점 목록. 결승 시간은 순위 순서로 증가한다.
 */
export function raceCurves(n: number, prng: Prng, duration = 20) {
  // 결승 시간: 1등 기준으로 0.1~0.7초씩 차이. 가끔 아주 근소한 차이(사진 판정).
  const finish: number[] = [];
  let t = duration * 0.85;
  for (let i = 0; i < n; i++) {
    finish.push(t);
    t += prng.next() < 0.25 ? prng.range(0.05, 0.2) : prng.range(0.25, 0.8);
  }
  const SEG = 10;
  return finish.map((T, rank) => {
    // 구간별 속도: 무작위. 상위권 일부는 초반을 느리게 해서 역전 연출
    const speeds = Array.from({ length: SEG }, () => prng.range(0.55, 1.45));
    if (rank < 2 && prng.next() < 0.6) {
      for (let s = 0; s < 4; s++) speeds[s] *= 0.7;
      for (let s = 7; s < SEG; s++) speeds[s] *= 1.4;
    }
    if (rank === n - 1 && prng.next() < 0.5) {
      for (let s = 0; s < 3; s++) speeds[s] *= 1.4;
    }
    const total = speeds.reduce((a, b) => a + b, 0);
    const pts: [number, number][] = [[0, 0]];
    let acc = 0;
    speeds.forEach((v, s) => {
      acc += v;
      pts.push([((s + 1) / SEG) * T, acc / total]);
    });
    return { finish: T, pts };
  });
}

/** 곡선에서 시간 t의 진행률 */
export function progressAt(pts: [number, number][], t: number): number {
  if (t <= 0) return 0;
  for (let i = 1; i < pts.length; i++) {
    const [t1, p1] = pts[i];
    if (t <= t1) {
      const [t0, p0] = pts[i - 1];
      return p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
    }
  }
  return 1;
}
