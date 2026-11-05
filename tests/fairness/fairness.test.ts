import { describe, expect, it } from 'vitest';
import { buildSlots, createRound, eliminationPlan, resultsFromRanking, validateConfig } from '../../src/core/draw';
import { createPrng, createSeed } from '../../src/core/rng';
import type { OutcomeConfig, Participant } from '../../src/core/types';
import { generateLadder, ladderMapping, tracePath } from '../../src/games/ladder/logic';
import { holeCount, newBarrel } from '../../src/games/pirate/logic';
import { holderAt, planBomb } from '../../src/games/bomb/logic';
import { dealCards } from '../../src/games/cards/logic';

const people = (n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, color: '#fff' }));

/** 카이제곱 통계량 (자유도 = 칸 수 - 1) */
function chiSquare(counts: number[], expected: number) {
  return counts.reduce((s, c) => s + ((c - expected) ** 2) / expected, 0);
}
// 자유도별 유의수준 0.001 임계값 (충분히 보수적으로 두어 우연한 실패를 막는다)
const CHI_001: Record<number, number> = { 1: 10.83, 2: 13.82, 3: 16.27, 4: 18.47, 5: 20.52, 6: 22.46, 7: 24.32, 8: 26.12, 9: 27.88, 10: 29.59, 11: 31.26 };

function expectFair(hitCounts: number[], trials: number, p: number) {
  hitCounts.forEach((c) => expect(Math.abs(c / trials - p)).toBeLessThan(0.01));
  const chi = chiSquare(hitCounts, trials * p);
  expect(chi).toBeLessThan(CHI_001[hitCounts.length - 1] ?? 50);
}

describe('결과 칸 구성', () => {
  it('꽝 모드: 아래쪽 K칸이 꽝', () => {
    const s = buildSlots({ mode: 'loser', count: 2, label: '꽝', good: false }, 5);
    expect(s.map((x) => x.kind)).toEqual(['pass', 'pass', 'pass', 'hit', 'hit']);
  });
  it('당첨 모드: 위쪽 K칸이 당첨', () => {
    const s = buildSlots({ mode: 'loser', count: 1, label: '당첨', good: true }, 3);
    expect(s.map((x) => x.kind)).toEqual(['hit', 'pass', 'pass']);
  });
  it('항목 모드(벌칙): 첫 항목이 맨 아래', () => {
    const s = buildSlots({ mode: 'items', good: false, items: [{ label: '밥값', count: 1 }, { label: '커피', count: 2 }] }, 5);
    expect(s.map((x) => x.label)).toEqual(['통과', '통과', '커피', '커피', '밥값']);
  });
  it('순위 모드', () => {
    expect(buildSlots({ mode: 'rank' }, 3).map((x) => x.label)).toEqual(['1등', '2등', '3등']);
  });
  it('유효성 검사 경계값', () => {
    expect(validateConfig({ mode: 'loser', count: 1, label: '꽝', good: false }, 2)).toBeNull();
    expect(validateConfig({ mode: 'loser', count: 2, label: '꽝', good: false }, 2)).not.toBeNull();
    expect(validateConfig({ mode: 'items', good: false, items: [{ label: 'a', count: 3 }] }, 3)).toBeNull();
    expect(validateConfig({ mode: 'items', good: false, items: [{ label: 'a', count: 4 }] }, 3)).not.toBeNull();
  });
  it('탈락 순서: 통과가 없으면 마지막 한 칸은 남은 사람 몫', () => {
    const plan = eliminationPlan(buildSlots({ mode: 'rank' }, 4), 'bottom');
    expect(plan.sequence).toEqual([3, 2, 1]);
    expect(plan.rest).toEqual([0]);
  });
});

describe('추첨 엔진 공정성 (10만 회)', () => {
  const cases: [number, OutcomeConfig][] = [
    [6, { mode: 'loser', count: 2, label: '꽝', good: false }],
    [2, { mode: 'loser', count: 1, label: '꽝', good: false }],
    [12, { mode: 'loser', count: 11, label: '꽝', good: false }],
  ];
  for (const [n, config] of cases) {
    it(`${n}명, ${config.mode === 'loser' ? config.count : ''}명 꽝: 각자 확률 K/N ±1%`, () => {
      const ps = people(n);
      const trials = 100_000;
      const hits = new Array(n).fill(0);
      for (let t = 0; t < trials; t++) {
        const round = createRound({ gameId: 'roulette', participants: ps, config });
        const res = resultsFromRanking(round);
        ps.forEach((p, i) => res[p.id].kind === 'hit' && hits[i]++);
      }
      expectFair(hits, trials, (config as { count: number }).count / n);
    });
  }

  it('같은 seed는 같은 결과를 재현한다', () => {
    const seed = createSeed();
    const a = createRound({ gameId: 'ladder', participants: people(8), config: { mode: 'rank' }, seed });
    const b = createRound({ gameId: 'ladder', participants: people(8), config: { mode: 'rank' }, seed });
    expect(a.ranking).toEqual(b.ranking);
  });
});

describe('사다리', () => {
  it('출발점과 도착점이 1:1 대응한다 (1천 회)', () => {
    for (let t = 0; t < 1000; t++) {
      const n = 2 + (t % 11);
      const ladder = generateLadder(n, createPrng(createSeed()));
      const mapping = ladderMapping(ladder);
      expect(new Set(mapping).size).toBe(n);
      for (let c = 0; c < n - 1; c++) expect(ladder.rungs.filter((r) => r.col === c).length).toBeGreaterThanOrEqual(2);
      // 같은 높이에서 이웃 가로줄 겹침 없음
      for (const r of ladder.rungs) expect(ladder.rungs.some((o) => o.row === r.row && o.col === r.col + 1)).toBe(false);
      expect(tracePath(ladder, 0).points.length).toBeGreaterThan(1);
    }
  });
});

/** 참여형 게임의 선택 전략 3종 */
const strategies = {
  first: (avail: number[]) => avail[0],
  last: (avail: number[]) => avail[avail.length - 1],
  random: (avail: number[], r: ReturnType<typeof createPrng>) => r.pick(avail),
};

describe('카드 뒤집기: 선택 전략과 무관하게 공정 (10만 회)', () => {
  for (const [name, pick] of Object.entries(strategies)) {
    it(`전략: ${name}`, () => {
      const n = 5;
      const slots = buildSlots({ mode: 'loser', count: 1, label: '꽝', good: false }, n);
      const trials = 100_000;
      const hits = new Array(n).fill(0);
      const chooser = createPrng(createSeed());
      for (let t = 0; t < trials; t++) {
        const layout = dealCards(n, createPrng(createSeed()).fork('cards'));
        const avail = layout.map((_, i) => i);
        for (let player = 0; player < n; player++) {
          const card = pick(avail, chooser);
          avail.splice(avail.indexOf(card), 1);
          if (slots[layout[card]].kind === 'hit') hits[player]++;
        }
      }
      expectFair(hits, trials, 1 / n);
    });
  }
});

describe('해적 통: 선택 전략과 무관하게 공정 (10만 회)', () => {
  it('구멍 수는 12 이상인 인원의 배수', () => {
    expect(holeCount(2)).toBe(12);
    expect(holeCount(5)).toBe(15);
    expect(holeCount(7)).toBe(14);
    expect(holeCount(12)).toBe(24);
  });
  for (const [name, pick] of Object.entries(strategies)) {
    for (const n of [5, 7]) {
      it(`${n}명, 전략: ${name}`, () => {
        const trials = 100_000;
        const hits = new Array(n).fill(0);
        const chooser = createPrng(createSeed());
        for (let t = 0; t < trials; t++) {
          const barrel = newBarrel(n, createPrng(createSeed()).fork('barrel'));
          const avail = Array.from({ length: barrel.holes }, (_, i) => i);
          let turn = barrel.firstTurn;
          for (;;) {
            const hole = pick(avail, chooser);
            avail.splice(avail.indexOf(hole), 1);
            if (hole === barrel.bad) {
              hits[turn]++;
              break;
            }
            turn = (turn + 1) % n;
          }
        }
        expectFair(hits, trials, 1 / n);
      });
    }
  }
});

describe('폭탄 돌리기', () => {
  it('정해둔 사람 차례에 정확히 터지고, 최소 한 바퀴는 돈다 (1만 회)', () => {
    for (let t = 0; t < 10_000; t++) {
      const n = 2 + (t % 11);
      const order = people(n).map((p) => p.id);
      const r = createPrng(createSeed());
      const target = r.pick(order);
      const plan = planBomb(order, target, r);
      expect(holderAt(order, plan.start, plan.explodeAt)).toBe(target);
      expect(plan.explodeAt).toBeGreaterThanOrEqual(n);
      expect(plan.explodeAt).toBeLessThan(4 * n);
    }
  });
});
