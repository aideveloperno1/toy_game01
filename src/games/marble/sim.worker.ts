/// <reference lib="webworker" />
import { simulate } from './sim';

self.onmessage = (e: MessageEvent<{ seed: string; n: number }>) => {
  const r = simulate(e.data.seed, e.data.n);
  (self as unknown as Worker).postMessage(r, [r.frames.buffer, r.finishFrame.buffer]);
};
