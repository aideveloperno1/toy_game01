import type { Prng } from '../../core/rng';

/** 가로줄: row 높이에서 col 세로줄과 col+1 세로줄을 잇는다 */
export type Rung = { row: number; col: number };

export type Ladder = { cols: number; rows: number; rungs: Rung[] };

/** 무작위 사다리를 만든다. 같은 높이에서 이웃한 가로줄은 겹치지 않는다. */
export function generateLadder(cols: number, prng: Prng): Ladder {
  const rows = 12;
  // 모든 칸 사이에 가로줄이 2개 이상 생길 때까지 다시 만든다(대부분 첫 시도에 성공).
  for (let attempt = 0; ; attempt++) {
    const rungs: Rung[] = [];
    const has = (row: number, col: number) => rungs.some((r) => r.row === row && r.col === col);
    const p = attempt < 20 ? 0.42 : 0.5;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols - 1; col++) {
        if (has(row, col - 1)) continue;
        if (prng.next() < p) rungs.push({ row, col });
      }
    }
    let ok = true;
    for (let col = 0; col < cols - 1; col++) if (rungs.filter((r) => r.col === col).length < 2) ok = false;
    if (ok || attempt > 200) {
      rungs.sort((a, b) => a.row - b.row || a.col - b.col);
      return { cols, rows, rungs };
    }
  }
}

/** start 세로줄에서 출발해 지나는 경로. 각 점은 [col, rowPosition] (rowPosition은 0~rows) */
export function tracePath(ladder: Ladder, start: number): { end: number; points: [number, number][] } {
  let col = start;
  const points: [number, number][] = [[col, -0.6]];
  for (let row = 0; row < ladder.rows; row++) {
    const y = row + 0.5;
    if (ladder.rungs.some((r) => r.row === row && r.col === col)) {
      points.push([col, y]);
      col += 1;
      points.push([col, y]);
    } else if (ladder.rungs.some((r) => r.row === row && r.col === col - 1)) {
      points.push([col, y]);
      col -= 1;
      points.push([col, y]);
    }
  }
  points.push([col, ladder.rows + 0.6]);
  return { end: col, points };
}

/** 출발 세로줄 → 도착 세로줄 매핑 */
export function ladderMapping(ladder: Ladder): number[] {
  return Array.from({ length: ladder.cols }, (_, i) => tracePath(ladder, i).end);
}
