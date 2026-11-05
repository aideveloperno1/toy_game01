import { describe, expect, it } from 'vitest';
import { simulate, SIM_HZ, REC_EVERY } from '../src/games/marble/sim';
import { MAPS } from '../src/games/marble/maps';
import { createSeed } from '../src/core/rng';

describe('구슬 레이스 시뮬레이션', () => {
  for (const map of MAPS) {
    for (const n of [2, 12, 30]) {
      it(`${map.id} ${n}개: 모두 순서가 매겨지고 결정론적`, () => {
        const seed = createSeed();
        const t0 = performance.now();
        const a = simulate(seed, n, map.id);
        const ms = performance.now() - t0;
        const b = simulate(seed, n, map.id);
        expect(a.order).toEqual(b.order);
        expect(new Set(a.order).size).toBe(n);
        const secs = (a.frameCount * REC_EVERY) / SIM_HZ;
        const finishedInTime = Array.from(a.finishFrame).filter((f) => f < a.frameCount - 1).length;
        console.log(`${map.id} n=${n} sim=${ms.toFixed(0)}ms race=${secs.toFixed(1)}s finished=${finishedInTime}/${n}`);
        expect(secs).toBeLessThanOrEqual(91);
      });
    }
  }
});
