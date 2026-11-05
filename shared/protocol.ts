import { z } from "zod";
import type {
  OutcomeConfig,
  Participant,
  RoundResult,
} from "../src/core/types";
import type { Ladder } from "../src/games/ladder/logic";

export const PROTOCOL = 1;
export const GAME_INFO = {
  ladder: { name: "사다리타기", max: 12, kind: "watch" },
  roulette: { name: "룰렛", max: 20, kind: "watch" },
  horse: { name: "동물 경주", max: 12, kind: "watch" },
  cards: { name: "카드 뒤집기", max: 20, kind: "play" },
  pirate: { name: "해적 통", max: 12, kind: "play" },
  bomb: { name: "폭탄 돌리기", max: 12, kind: "play" },
  scratch: { name: "스크래치 복권", max: 20, kind: "play" },
  stopwatch: { name: "10초 맞추기", max: 20, kind: "skill" },
  marble: { name: "구슬 레이스", max: 30, kind: "watch" },
} as const;
export type OnlineGame = keyof typeof GAME_INFO;
export const gameSchema = z.enum(
  Object.keys(GAME_INFO) as [OnlineGame, ...OnlineGame[]],
);
const label = z.string().trim().min(1).max(30);
export const configSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("loser"),
      count: z.number().int().min(1).max(29),
      label,
      good: z.boolean(),
    })
    .strict(),
  z.object({ mode: z.literal("rank") }).strict(),
  z
    .object({
      mode: z.literal("items"),
      good: z.boolean(),
      items: z
        .array(
          z.object({ label, count: z.number().int().min(1).max(30) }).strict(),
        )
        .min(1)
        .max(30),
    })
    .strict(),
]);
export const joinSchema = z
  .object({
    code: z.string().regex(/^[A-Z2-9]{6}$/),
    name: z.string().trim().min(1).max(8),
    protocol: z.literal(PROTOCOL),
  })
  .strict();
export const commandSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum([
      "ready",
      "configure",
      "prepare",
      "loaded",
      "act",
      "next",
      "leave",
    ]),
    roundId: z.string().max(64).optional(),
    turn: z.number().int().nonnegative().optional(),
    ready: z.boolean().optional(),
    game: gameSchema.optional(),
    config: configSchema.optional(),
    action: z
      .enum(["reveal", "pick", "spin", "pass", "watch-start", "watch-stop"])
      .optional(),
    index: z.number().int().min(0).max(100).optional(),
    time: z.number().min(0).max(45000).optional(),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export type MemberView = Participant & {
  ready: boolean;
  connected: boolean;
  spectator: boolean;
};
export type GameView = {
  id: string;
  game: OnlineGame;
  participants: Participant[];
  config: OutcomeConfig;
  startAt: number;
  deadline: number;
  turn: number;
  current?: string;
  step: number;
  rollingUntil?: number;
  revealed: RoundResult;
  selected: Record<number, string>;
  automatic: string[];
  holes?: number;
  used?: number[];
  ladder?: Ladder;
  watch: {
    stage: number;
    eligible: string[];
    started: boolean;
    submitted: boolean;
    submittedIds: string[];
  };
};
export type RoomView = {
  protocol: number;
  id: string;
  code: string;
  revision: number;
  serverNow: number;
  self: string;
  hostId: string;
  phase: "lobby" | "preparing" | "playing" | "result" | "closed";
  members: MemberView[];
  game: OnlineGame;
  config: OutcomeConfig;
  gameState?: GameView;
  results?: RoundResult;
  notice?: string;
  prepareDeadline?: number;
  control: boolean;
};
export type RaceFrame = {
  roundId: string;
  at: number;
  mapId?: string;
  points: { id: string; x: number; y: number }[];
};
export type Ack = { ok: boolean; error?: string; code?: string };
