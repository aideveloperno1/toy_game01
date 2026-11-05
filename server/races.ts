import { Worker } from "node:worker_threads";
import { resolve as resolvePath } from "node:path";
import { raceCurves, progressAt } from "../src/games/horse/logic";
import { createPrng } from "../src/core/rng";
import type { Game } from "./engine";
import type { RaceFrame } from "../shared/protocol";

export type RaceAsset = {
  duration: number;
  curves?: ReturnType<typeof raceCurves>;
  marble?: {
    mapId: string;
    frames: number[];
    order: number[];
    frameCount: number;
    n: number;
    finishFrame: number[];
  };
};
let work: Promise<unknown> = Promise.resolve();
export function buildRace(g: Game): Promise<RaceAsset> {
  if (g.round.gameId === "horse") {
    const curves = raceCurves(
      g.round.participants.length,
      createPrng(g.round.seed).fork("horse"),
    );
    return Promise.resolve({
      curves,
      duration:
        Math.ceil(Math.max(...curves.map((c) => c.finish)) * 1000) + 1000,
    });
  }
  const task = work
    .catch(() => {})
    .then(
      () =>
        new Promise<RaceAsset>((resolve, reject) => {
          const worker = new Worker(
            resolvePath("dist-server/race-worker.mjs"),
            {
              workerData: {
                seed: g.round.seed,
                n: g.round.participants.length,
              },
            },
          );
          const timeout = setTimeout(() => {
            void worker.terminate();
            reject(new Error("구슬 준비 시간이 초과되었어요."));
          }, 10000);
          worker.once("message", (marble: RaceAsset["marble"]) => {
            clearTimeout(timeout);
            resolve({
              marble,
              duration: Math.ceil((marble!.frameCount / 30) * 1000) + 1000,
            });
            void worker.terminate();
          });
          worker.once("error", (e) => {
            clearTimeout(timeout);
            reject(e);
          });
          worker.once("exit", (code) => {
            clearTimeout(timeout);
            if (code !== 0) reject(new Error("구슬 준비 작업이 종료되었어요."));
          });
        }),
    );
  work = task;
  return task;
}
export function frame(g: Game, asset: RaceAsset, now: number): RaceFrame {
  const t = Math.max(0, now - g.startAt) / 1000;
  const points = g.round.ranking.map((id, rank) => {
    if (asset.curves)
      return {
        id,
        x: progressAt(asset.curves[rank].pts, t),
        y: g.round.participants.findIndex((p) => p.id === id),
      };
    const sim = asset.marble!,
      ball = sim.order[rank];
    const index = Math.min(sim.frameCount - 1, Math.floor(t * 30));
    const offset = (index * sim.n + ball) * 2;
    return { id, x: sim.frames[offset], y: sim.frames[offset + 1] };
  });
  // Do not leak the secret finishing order through array order.
  points.sort(
    (a, b) =>
      g.round.participants.findIndex((p) => p.id === a.id) -
      g.round.participants.findIndex((p) => p.id === b.id),
  );
  return { roundId: g.round.id, at: now, mapId: asset.marble?.mapId, points };
}
