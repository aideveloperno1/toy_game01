import { parentPort, workerData } from "node:worker_threads";
import { simulate } from "../src/games/marble/sim";
const sim = simulate(workerData.seed, workerData.n);
parentPort!.postMessage({
  ...sim,
  frames: Array.from(sim.frames),
  finishFrame: Array.from(sim.finishFrame),
});
