import { createPrng, createSeed } from './rng';
import type { GameId, OutcomeConfig, Participant, Round, RoundResult, Slot } from './types';

export const PASS_LABEL = '통과';

/** 결과 구성이 인원 n에 대해 유효한지 검사하고, 문제가 있으면 이유를 돌려준다. */
export function validateConfig(config: OutcomeConfig, n: number): string | null {
  if (n < 2) return '참가자는 2명 이상이어야 해요';
  if (config.mode === 'loser') {
    if (!config.label.trim()) return '결과 이름을 입력해 주세요';
    if (config.count < 1) return '1명 이상 골라야 해요';
    if (config.count > n - 1) return `최대 ${n - 1}명까지 고를 수 있어요`;
  } else if (config.mode === 'items') {
    const items = config.items.filter((i) => i.count > 0);
    if (items.length === 0) return '항목을 하나 이상 넣어 주세요';
    if (items.some((i) => !i.label.trim())) return '항목 이름을 입력해 주세요';
    const total = items.reduce((s, i) => s + i.count, 0);
    if (total > n) return `항목 수(${total})가 인원(${n})보다 많아요`;
  }
  return null;
}

/**
 * 좋은 결과(0번) → 나쁜 결과(n-1번) 순서의 결과 칸을 만든다.
 * 경주 게임의 등수, 탈락 게임의 탈락 순서가 모두 이 순서를 따른다.
 */
export function buildSlots(config: OutcomeConfig, n: number): Slot[] {
  if (config.mode === 'rank') {
    return Array.from({ length: n }, (_, i) => ({ label: `${i + 1}등`, kind: 'rank', good: i === 0, rank: i + 1 }));
  }
  const pass = (): Slot => ({ label: PASS_LABEL, kind: 'pass', good: false });
  if (config.mode === 'loser') {
    const hit = (): Slot => ({ label: config.label.trim(), kind: 'hit', good: config.good });
    const hits = Array.from({ length: config.count }, hit);
    const passes = Array.from({ length: n - config.count }, pass);
    return config.good ? [...hits, ...passes] : [...passes, ...hits];
  }
  const expanded: Slot[] = [];
  for (const item of config.items) {
    for (let i = 0; i < item.count; i++) expanded.push({ label: item.label.trim(), kind: 'hit', good: config.good });
  }
  const passes = Array.from({ length: n - expanded.length }, pass);
  // 좋은 항목은 위에서부터 나열 순서대로, 벌칙 항목은 첫 항목이 맨 아래(가장 나쁜 자리)
  return config.good ? [...expanded, ...passes] : [...passes, ...expanded.reverse()];
}

/** 시작 시점에 결과를 확정한 한 판을 만든다. */
export function createRound(args: {
  gameId: GameId;
  participants: Participant[];
  config: OutcomeConfig;
  groupId?: string;
  attempt?: number;
  seed?: string;
}): Round {
  const seed = args.seed ?? createSeed();
  const prng = createPrng(seed).fork('draw');
  const slots = buildSlots(args.config, args.participants.length);
  const ranking = prng.shuffle(args.participants.map((p) => p.id));
  return {
    id: seed.slice(0, 12),
    createdAt: Date.now(),
    gameId: args.gameId,
    groupId: args.groupId,
    participants: args.participants,
    config: args.config,
    seed,
    slots,
    ranking,
    attempt: args.attempt ?? 1,
  };
}

export function resultsFromRanking(round: Pick<Round, 'ranking' | 'slots'>): RoundResult {
  const out: RoundResult = {};
  round.ranking.forEach((pid, i) => (out[pid] = round.slots[i]));
  return out;
}

/** 순위 위치(0=가장 좋은)를 받은 결과로 만든다. 실력형·경주형 공통. */
export function resultsFromOrder(order: string[], slots: Slot[]): RoundResult {
  return resultsFromRanking({ ranking: order, slots });
}

/**
 * 탈락식 게임(룰렛, 폭탄, 해적 통)의 진행 순서.
 * - sequence: 한 번에 한 명씩 결과를 받는 칸의 인덱스 (진행 순서대로)
 * - 마지막까지 남은 사람들은 rest 칸을 받는다(통과 또는 1등).
 * from='bottom': 나쁜 결과부터(벌칙), 'top': 좋은 결과부터(당첨).
 */
export function eliminationPlan(slots: Slot[], from: 'top' | 'bottom'): { sequence: number[]; rest: number[] } {
  const idx = slots.map((_, i) => i);
  const ordered = from === 'top' ? idx : idx.reverse();
  const nonPass = ordered.filter((i) => slots[i].kind !== 'pass');
  const pass = ordered.filter((i) => slots[i].kind === 'pass');
  if (pass.length > 0) return { sequence: nonPass, rest: pass };
  // 통과 칸이 없으면 마지막 한 칸은 남은 사람이 자동으로 받는다.
  return { sequence: nonPass.slice(0, -1), rest: nonPass.slice(-1) };
}

/** 결과 구성에 따른 탈락 방향: 벌칙은 아래에서, 좋은 결과는 위에서 */
export function defaultDirection(config: OutcomeConfig, rankFrom: 'top' | 'bottom'): 'top' | 'bottom' {
  if (config.mode === 'rank') return rankFrom;
  return config.good ? 'top' : 'bottom';
}

/** "6명 중 꽝 2명" 같은 요약 */
export function configSummary(config: OutcomeConfig, n: number): string {
  if (config.mode === 'rank') return `${n}명 전체 순위`;
  if (config.mode === 'loser') return `${n}명 중 ${config.label} ${config.count}명`;
  const parts = config.items.filter((i) => i.count > 0).map((i) => (i.count > 1 ? `${i.label} ${i.count}` : i.label));
  return `${n}명 · ${parts.join(', ')}`;
}

/** 결과를 같은 칸끼리 묶어 보여주기 좋은 순서로 정렬한다. */
export function groupResults(results: RoundResult, participants: Participant[]) {
  const groups = new Map<string, { slot: Slot; people: Participant[] }>();
  for (const p of participants) {
    const slot = results[p.id];
    if (!slot) continue;
    const key = slot.kind + ':' + slot.label;
    if (!groups.has(key)) groups.set(key, { slot, people: [] });
    groups.get(key)!.people.push(p);
  }
  const arr = [...groups.values()];
  const weight = (s: Slot) => (s.kind === 'rank' ? s.rank! : s.kind === 'hit' ? 0 : 1000);
  arr.sort((a, b) => weight(a.slot) - weight(b.slot));
  return arr;
}
