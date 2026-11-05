import { randomUUID, randomInt } from "node:crypto";
import {
  createRound,
  defaultDirection,
  eliminationPlan,
  resultsFromOrder,
  resultsFromRanking,
  validateConfig,
} from "../src/core/draw";
import { createPrng } from "../src/core/rng";
import type {
  HistoryEntry,
  OutcomeConfig,
  Round,
  RoundResult,
} from "../src/core/types";
import { dealCards } from "../src/games/cards/logic";
import { newBarrel, type Barrel } from "../src/games/pirate/logic";
import { planBomb, holderAt } from "../src/games/bomb/logic";
import { generateLadder } from "../src/games/ladder/logic";
import {
  GAME_INFO,
  PROTOCOL,
  type Command,
  type GameView,
  type MemberView,
  type OnlineGame,
  type RoomView,
} from "../shared/protocol";

export type Member = MemberView & {
  session: string;
  disconnectedAt?: number;
  left?: boolean;
  loaded?: boolean;
};
type WatchRecord = { startedAt: number; time?: number };
export type Game = {
  round: Round;
  startAt: number;
  deadline: number;
  turn: number;
  step: number;
  revealed: RoundResult;
  selected: Record<number, string>;
  automatic: string[];
  layout: number[];
  barrel?: Barrel;
  used: number[];
  remaining: string[];
  bomb?: { start: number; explodeAt: number };
  taps: number;
  watchStage: number;
  eligible: string[];
  records: Record<string, WatchRecord>[];
  tieOrder: string[];
  prepareId: string;
  rollingUntil?: number;
};
export type Room = {
  id: string;
  code: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  lastActivity: number;
  hostId: string;
  phase: RoomView["phase"];
  members: Member[];
  game: OnlineGame;
  config: OutcomeConfig;
  gameState?: Game;
  results?: RoundResult;
  notice?: string;
  prepareDeadline?: number;
  requests: Record<string, string[]>;
  expiresAt?: number;
  completed: HistoryEntry[];
};
const COLORS = [
  "#ff6b6b",
  "#ffc93c",
  "#4fd8b4",
  "#5aa9ff",
  "#c58bff",
  "#ff9a4d",
  "#7be06b",
  "#ff7fc8",
];
export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function newRoom(code: string, now: number): Room {
  return {
    id: randomUUID(),
    code,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    lastActivity: now,
    hostId: "",
    phase: "lobby",
    members: [],
    game: "ladder",
    config: { mode: "loser", count: 1, label: "꽝", good: false },
    requests: {},
    completed: [],
  };
}
export function join(
  room: Room,
  session: string,
  name: string,
  now: number,
): Member {
  check(room.phase !== "closed", "종료된 방이에요. 새 방을 만들어 주세요.");
  let member = room.members.find((m) => m.session === session && !m.left);
  if (!member) {
    check(room.members.filter((m) => !m.left).length < 30, "방이 가득 찼어요.");
    const base = name.trim().slice(0, 8);
    check(base, "닉네임을 입력해 주세요.");
    let unique = base,
      n = 2;
    while (room.members.some((m) => !m.left && m.name === unique))
      unique = `${base.slice(0, 5)}(${n++})`;
    member = {
      id: randomUUID(),
      session,
      name: unique,
      color: COLORS[room.members.length % COLORS.length],
      ready: false,
      connected: true,
      spectator: room.phase !== "lobby",
    };
    room.members.push(member);
    if (!room.hostId) room.hostId = member.id;
    if (room.phase === "lobby")
      room.members.forEach((m) => {
        m.ready = false;
      });
  }
  member.connected = true;
  member.disconnectedAt = undefined;
  room.lastActivity = now;
  return member;
}
export function disconnect(room: Room, memberId: string, now: number) {
  const m = room.members.find((x) => x.id === memberId);
  if (m && !m.left) {
    m.connected = false;
    m.disconnectedAt = now;
  }
}
function plan(g: Game) {
  return eliminationPlan(
    g.round.slots,
    defaultDirection(g.round.config, "bottom"),
  );
}
function nextElimination(g: Game) {
  const rng = createPrng(g.round.seed).fork(
    `online-${g.round.gameId}-${g.step}`,
  );
  if (g.round.gameId === "pirate") {
    g.barrel = newBarrel(g.remaining.length, rng);
    g.used = [];
  }
  if (g.round.gameId === "bomb") {
    g.bomb = planBomb(
      g.remaining,
      g.round.ranking[plan(g).sequence[g.step]],
      rng,
    );
    g.taps = 0;
  }
}
export function current(g: Game): string | undefined {
  if (g.round.gameId === "cards") return g.round.participants[g.turn]?.id;
  if (g.round.gameId === "pirate" && g.barrel)
    return g.remaining[
      (g.barrel.firstTurn + g.used.length) % g.remaining.length
    ];
  if (g.round.gameId === "bomb" && g.bomb)
    return holderAt(g.remaining, g.bomb.start, g.taps);
  return undefined;
}
function createGame(room: Room, now: number): Game {
  const participants = room.members
    .filter((m) => !m.left && !m.spectator)
    .map(({ id, name, color }) => ({ id, name, color }));
  const round = createRound({
    gameId: room.game,
    participants,
    config: room.config,
  });
  // A round's public ID is unrelated to its private random seed.
  round.id = randomUUID();
  const rng = createPrng(round.seed);
  const g: Game = {
    round,
    startAt: now,
    deadline: now,
    turn: 0,
    step: 0,
    revealed: {},
    selected: {},
    automatic: [],
    layout: dealCards(participants.length, rng.fork("cards")),
    used: [],
    remaining: participants.map((p) => p.id),
    taps: 0,
    watchStage: 0,
    eligible: participants.map((p) => p.id),
    records: [{}],
    tieOrder: rng.fork("ties").shuffle(participants.map((p) => p.id)),
    prepareId: randomUUID(),
  };
  nextElimination(g);
  return g;
}
function finish(room: Room, results: RoundResult, now: number) {
  room.results = results;
  room.phase = "result";
  room.lastActivity = now;
  room.gameState!.revealed = results;
  const g = room.gameState!;
  room.completed = [
    {
      id: g.round.id,
      createdAt: now,
      gameId: g.round.gameId,
      participants: g.round.participants,
      config: g.round.config,
      seed: g.round.id,
      results: structuredClone(results),
      attempt: 1,
      online: true,
    },
    ...room.completed.filter(
      (h) => h.createdAt > now - 86400000 && h.id !== g.round.id,
    ),
  ].slice(0, 50);
  room.members.forEach((m) => {
    m.ready = false;
  });
}
function eliminated(room: Room, id: string, now: number) {
  const g = room.gameState!,
    p = plan(g);
  g.revealed[id] = g.round.slots[p.sequence[g.step]];
  g.remaining = g.remaining.filter((x) => x !== id);
  g.step++;
  g.turn++;
  if (g.step >= p.sequence.length) {
    g.remaining.forEach((pid, i) => {
      g.revealed[pid] = g.round.slots[p.rest[Math.min(i, p.rest.length - 1)]];
    });
    finish(room, g.revealed, now);
  } else {
    nextElimination(g);
    g.deadline = now + (room.game === "bomb" ? 15000 : 30000);
  }
}
function finishWatchStage(room: Room, now: number) {
  const g = room.gameState!,
    records = g.records;
  const error = (id: string, stage: number) =>
    records[stage]?.[id]?.time === undefined
      ? Infinity
      : Math.round(Math.abs(records[stage][id].time! - 10000) / 10);
  if (g.watchStage === 0) {
    const ties = new Map<number, string[]>();
    for (const p of g.round.participants) {
      const e = error(p.id, 0);
      if (Number.isFinite(e)) ties.set(e, [...(ties.get(e) ?? []), p.id]);
    }
    const eligible = [...ties.values()].filter((ids) => ids.length > 1).flat();
    if (eligible.length) {
      g.watchStage = 1;
      g.eligible = eligible;
      g.records.push({});
      g.deadline = now + 45000;
      g.turn++;
      return;
    }
  }
  const order = g.round.participants
    .map((p) => p.id)
    .sort((a, b) => {
      const ea = error(a, 0),
        eb = error(b, 0);
      if (ea !== eb) return ea < eb ? -1 : 1;
      const ra = error(a, 1),
        rb = error(b, 1);
      if (ra !== rb) return ra < rb ? -1 : 1;
      return g.tieOrder.indexOf(a) - g.tieOrder.indexOf(b);
    });
  finish(room, resultsFromOrder(order, g.round.slots), now);
}
function gameAction(
  room: Room,
  actor: string,
  c: Command,
  now: number,
  automatic = false,
) {
  const g = room.gameState!;
  check(now >= g.startAt, "곧 시작해요.");
  check(
    automatic || g.round.participants.some((p) => p.id === actor),
    "다음 판부터 참여할 수 있어요.",
  );
  if (automatic) g.automatic.push(`${g.turn}:${actor}`);
  switch (room.game) {
    case "ladder":
    case "scratch": {
      check(c.action === "reveal" && !g.revealed[actor], "이미 공개했어요.");
      g.revealed[actor] = resultsFromRanking(g.round)[actor];
      if (Object.keys(g.revealed).length === g.round.participants.length)
        finish(room, g.revealed, now);
      break;
    }
    case "roulette": {
      check(actor === room.hostId || automatic, "방장만 돌릴 수 있어요.");
      check(c.action === "spin" && !g.rollingUntil, "이미 돌아가고 있어요.");
      g.rollingUntil = now + 2500;
      g.deadline = g.rollingUntil;
      g.turn++;
      break;
    }
    case "cards": {
      check(current(g) === actor, "내 차례가 아니에요.");
      const i = c.index!;
      check(
        c.action === "pick" &&
          Number.isInteger(i) &&
          i >= 0 &&
          i < g.layout.length &&
          !(i in g.selected),
        "선택할 수 없는 카드예요.",
      );
      g.selected[i] = actor;
      g.revealed[actor] = g.round.slots[g.layout[i]];
      g.turn++;
      g.deadline = now + 30000;
      if (g.turn === g.round.participants.length) finish(room, g.revealed, now);
      break;
    }
    case "pirate": {
      check(current(g) === actor, "내 차례가 아니에요.");
      const i = c.index!;
      check(
        c.action === "pick" &&
          Number.isInteger(i) &&
          i >= 0 &&
          i < g.barrel!.holes &&
          !g.used.includes(i),
        "선택할 수 없는 구멍이에요.",
      );
      g.used.push(i);
      if (i === g.barrel!.bad) eliminated(room, actor, now);
      else {
        g.turn++;
        g.deadline = now + 30000;
      }
      break;
    }
    case "bomb": {
      check(current(g) === actor && c.action === "pass", "내 차례가 아니에요.");
      if (g.taps === g.bomb!.explodeAt) eliminated(room, actor, now);
      else {
        g.taps++;
        g.turn++;
        g.deadline = now + 15000;
      }
      break;
    }
    case "stopwatch": {
      check(g.eligible.includes(actor), "현재 측정 대상이 아니에요.");
      const recs = g.records[g.watchStage];
      if (c.action === "watch-start") {
        check(!recs[actor], "이미 시작한 시도예요.");
        recs[actor] = { startedAt: now };
      } else {
        const rec = recs[actor];
        check(
          c.action === "watch-stop" && rec && rec.time === undefined,
          "이미 제출했거나 시작하지 않은 시도예요.",
        );
        check(
          c.time !== undefined &&
            Number.isFinite(c.time) &&
            c.time >= 0 &&
            c.time <= now - rec.startedAt + 1000,
          "측정 시간을 확인해 주세요.",
        );
        rec.time = c.time;
        if (g.eligible.every((id) => recs[id]?.time !== undefined))
          finishWatchStage(room, now);
      }
      break;
    }
    default:
      throw new Error("자동으로 진행되는 게임이에요.");
  }
}
export function applyCommand(
  room: Room,
  actor: string,
  c: Command,
  now: number,
) {
  const m = room.members.find((x) => x.id === actor && !x.left);
  check(m, "방에 다시 입장해 주세요.");
  check(room.phase !== "closed", "종료된 방이에요.");
  const seen = room.requests[actor] ?? [];
  if (seen.includes(c.id)) return false;
  if (c.type === "ready") {
    check(
      room.phase === "lobby" && c.ready !== undefined,
      "대기실에서 준비할 수 있어요.",
    );
    m.ready = c.ready;
    m.spectator = false;
  } else if (c.type === "configure") {
    check(
      room.phase === "lobby" && actor === room.hostId,
      "대기실에서 방장만 설정할 수 있어요.",
    );
    check(c.game && c.config, "게임 설정을 확인해 주세요.");
    room.game = c.game;
    room.config = c.config;
    room.members.forEach((x) => {
      x.ready = false;
    });
  } else if (c.type === "prepare") {
    check(
      room.phase === "lobby" && actor === room.hostId,
      "방장만 시작할 수 있어요.",
    );
    const members = room.members.filter((x) => !x.left && !x.spectator);
    check(
      members.length >= 2 && members.length <= GAME_INFO[room.game].max,
      `이 게임은 2~${GAME_INFO[room.game].max}명이 필요해요.`,
    );
    check(
      members.every((x) => x.ready && x.connected),
      "모든 참가자의 준비와 연결을 확인해 주세요.",
    );
    const err = validateConfig(room.config, members.length);
    check(!err, err ?? "");
    room.gameState = createGame(room, now);
    room.results = undefined;
    room.notice = undefined;
    room.phase = "preparing";
    room.prepareDeadline = now + 15000;
    room.members.forEach((x) => {
      x.loaded = false;
    });
  } else if (c.type === "loaded") {
    check(
      room.phase === "preparing" && c.roundId === room.gameState?.round.id,
      "준비 시간이 끝났어요.",
    );
    m.loaded = true;
  } else if (c.type === "act") {
    check(
      room.phase === "playing" && c.roundId === room.gameState?.round.id,
      "진행 중인 판이 달라요.",
    );
    check(
      c.turn === room.gameState!.turn,
      "차례가 바뀌었어요. 최신 화면에서 다시 선택해 주세요.",
    );
    check(now < room.gameState!.deadline, "제한 시간이 끝났어요.");
    gameAction(room, actor, c, now);
  } else if (c.type === "next") {
    check(
      room.phase === "result" && actor === room.hostId,
      "결과 화면에서 방장만 다음 판으로 이동할 수 있어요.",
    );
    room.phase = "lobby";
    room.results = undefined;
    room.gameState = undefined;
    room.members = room.members.filter((x) => !x.left);
    room.members.forEach((x) => {
      x.ready = false;
      x.spectator = !x.connected;
    });
  } else if (c.type === "leave") {
    m.left = true;
    m.connected = false;
    m.disconnectedAt = now - 60000;
    if (room.phase === "lobby")
      room.members.forEach((x) => {
        x.ready = false;
      });
  }
  room.requests[actor] = [...seen, c.id].slice(-128);
  room.lastActivity = now;
  return true;
}
export function begin(room: Room, now: number, raceDuration?: number) {
  const g = room.gameState!;
  room.phase = "playing";
  g.startAt = now + 3000;
  const duration =
    room.game === "bomb" || room.game === "roulette"
      ? 15000
      : room.game === "scratch" || room.game === "stopwatch"
        ? 45000
        : room.game === "horse" || room.game === "marble"
          ? (raceDuration ?? 30000)
          : 30000;
  g.deadline = g.startAt + duration;
  room.prepareDeadline = undefined;
}
export function tick(room: Room, now: number): boolean {
  if (room.phase === "closed") return false;
  let changed = false;
  const completed = room.completed.filter((h) => h.createdAt > now - 86400000);
  if (completed.length !== room.completed.length) {
    room.completed = completed;
    changed = true;
  }
  const host = room.members.find((m) => m.id === room.hostId);
  if (!host?.connected && now - (host?.disconnectedAt ?? now) >= 60000) {
    const next =
      room.members.find((m) => m.connected && !m.left && !m.spectator) ??
      room.members.find((m) => m.connected && !m.left);
    if (next) {
      room.hostId = next.id;
      changed = true;
    }
  }
  const absent = room.members.every((m) => !m.connected || m.left);
  const lastDisconnect = Math.max(
    room.createdAt,
    ...room.members.map((m) => m.disconnectedAt ?? room.createdAt),
  );
  if (
    (absent && now - lastDisconnect >= 600000) ||
    now - room.lastActivity >= 7200000
  ) {
    room.phase = "closed";
    room.notice = "방이 종료되었어요.";
    room.expiresAt = now + 86400000;
    return true;
  }
  if (room.phase === "preparing" && now >= room.prepareDeadline!) {
    room.phase = "lobby";
    room.gameState = undefined;
    room.notice = "준비 시간이 초과되어 대기실로 돌아왔어요.";
    room.members.forEach((m) => {
      m.ready = false;
    });
    return true;
  }
  if (room.phase !== "playing" || now < room.gameState!.deadline)
    return changed;
  const g = room.gameState!;
  if (room.game === "roulette" && g.rollingUntil) {
    g.rollingUntil = undefined;
    eliminated(room, g.round.ranking[plan(g).sequence[g.step]], now);
    if (room.phase === "playing") g.deadline = now + 15000;
  } else if (room.game === "horse" || room.game === "marble")
    finish(room, resultsFromRanking(g.round), now);
  else if (room.game === "stopwatch") finishWatchStage(room, now);
  else if (room.game === "ladder" || room.game === "scratch") {
    for (const p of g.round.participants)
      if (!g.revealed[p.id])
        gameAction(
          room,
          p.id,
          { id: "", type: "act", action: "reveal" },
          now,
          true,
        );
  } else {
    const actor = room.game === "roulette" ? room.hostId : current(g)!;
    const choices =
      room.game === "cards"
        ? g.layout.map((_, i) => i).filter((i) => !(i in g.selected))
        : room.game === "pirate"
          ? Array.from({ length: g.barrel!.holes }, (_, i) => i).filter(
              (i) => !g.used.includes(i),
            )
          : [];
    gameAction(
      room,
      actor,
      {
        id: "",
        type: "act",
        action:
          room.game === "roulette"
            ? "spin"
            : room.game === "bomb"
              ? "pass"
              : "pick",
        index: choices.length ? choices[randomInt(choices.length)] : undefined,
      },
      now,
      true,
    );
  }
  room.lastActivity = now;
  return true;
}
export function publicView(
  room: Room,
  self: string,
  now: number,
  control = true,
): RoomView {
  const g = room.gameState;
  let gameState: GameView | undefined;
  if (g) {
    gameState = {
      id: g.round.id,
      game: room.game,
      participants: g.round.participants,
      config: g.round.config,
      startAt: g.startAt,
      deadline: g.deadline,
      turn: g.turn,
      current: current(g),
      step: g.step,
      rollingUntil: g.rollingUntil,
      revealed: g.revealed,
      selected: g.selected,
      automatic: g.automatic,
      holes: g.barrel?.holes,
      used: room.game === "pirate" ? g.used : undefined,
      ladder:
        room.game === "ladder"
          ? generateLadder(
              g.round.participants.length,
              createPrng(g.round.seed).fork("ladder"),
            )
          : undefined,
      watch: {
        stage: g.watchStage,
        eligible: g.eligible,
        started: !!g.records[g.watchStage][self],
        submitted: g.records[g.watchStage][self]?.time !== undefined,
        submittedIds: Object.keys(g.records[g.watchStage]).filter(
          (id) => g.records[g.watchStage][id].time !== undefined,
        ),
      },
    };
  }
  return {
    protocol: PROTOCOL,
    id: room.id,
    code: room.code,
    revision: room.revision,
    serverNow: now,
    self,
    control,
    hostId: room.hostId,
    phase: room.phase,
    members: room.members
      .filter((m) => !m.left)
      .map(({ id, name, color, ready, connected, spectator }) => ({
        id,
        name,
        color,
        ready,
        connected,
        spectator,
      })),
    game: room.game,
    config: room.config,
    gameState,
    results: room.results,
    notice: room.notice,
    prepareDeadline: room.prepareDeadline,
  };
}
