import { useEffect, useMemo, useRef, useState } from 'react';
import { resultsFromRanking } from '../../core/draw';
import { createPrng } from '../../core/rng';
import { speedFactor, vibrate } from '../../lib/device';
import { playResult, sfx } from '../../lib/sound';
import { SkipButton, slotTone } from '../_kit/kit';
import type { GameProps } from '../registry';
import { progressAt, raceCurves } from './logic';

const ANIMALS = ['🐎', '🐢', '🐇', '🐓', '🐖', '🐕', '🐈', '🦆', '🐄', '🦔', '🐑', '🐿️'];

export default function HorseGame({ round, onFinish }: GameProps) {
  const n = round.participants.length;
  const prng = useMemo(() => createPrng(round.seed).fork('horse'), [round]);
  const results = useMemo(() => resultsFromRanking(round), [round]);
  const anyGood = round.slots.some((s) => s.good);
  /** 순위 순서대로의 곡선. 참가자 id → 곡선 */
  const curves = useMemo(() => {
    const c = raceCurves(n, prng);
    return Object.fromEntries(round.ranking.map((pid, rank) => [pid, c[rank]]));
  }, [n, prng, round]);
  const animals = useMemo(() => {
    const a = prng.shuffle(ANIMALS);
    return Object.fromEntries(round.participants.map((p, i) => [p.id, a[i % a.length]]));
  }, [prng, round]);

  const [t, setT] = useState(-3);
  const [caption, setCaption] = useState('출발 준비!');
  const [finished, setFinished] = useState<string[]>([]);
  const raf = useRef(0);

  useEffect(() => {
    const total = Math.max(...Object.values(curves).map((c) => c.finish)) + 1.2;
    // 사진 판정: 결과가 갈리는 경계에서 0.3초 이내로 붙어 들어오면 그 순간 느리게
    const order = round.ranking;
    const slowAt: number[] = [];
    for (let i = 1; i < n; i++) {
      const a = results[order[i - 1]];
      const b = results[order[i]];
      const boundary = a.label !== b.label || (a.kind === 'rank' && i === 1);
      if (boundary && curves[order[i]].finish - curves[order[i - 1]].finish < 0.3) slowAt.push(curves[order[i - 1]].finish);
    }
    let sim = -3;
    let last = performance.now();
    let lastLeader = '';
    let lastSec = 4;
    const seen = new Set<string>();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000) / speedFactor();
      last = now;
      const slow = slowAt.some((s) => Math.abs(sim - s) < 0.45);
      sim += dt * (slow ? 0.25 : 1);
      if (sim < 0) {
        const sec = Math.ceil(-sim);
        if (sec !== lastSec) {
          lastSec = sec;
          sfx.beep();
          setCaption(String(sec));
        }
      } else if (lastSec !== 0) {
        lastSec = 0;
        sfx.start();
        setCaption('출발!');
      }
      setT(sim);
      if (sim > 0) {
        // 선두 바뀜 중계
        const ps = round.participants.map((p) => ({ p, v: progressAt(curves[p.id].pts, sim) }));
        ps.sort((a, b) => b.v - a.v);
        const leader = ps[0];
        if (leader.v < 0.97 && leader.p.id !== lastLeader && sim > 1) {
          lastLeader = leader.p.id;
          setCaption(`${leader.p.name} 선두!`);
          sfx.tick();
        }
        if (slow) setCaption('사진 판정!');
        for (const pid of order) {
          if (!seen.has(pid) && sim >= curves[pid].finish) {
            seen.add(pid);
            setFinished((f) => [...f, pid]);
            const s = results[pid];
            if (s.kind === 'hit' || (s.kind === 'rank' && s.rank === 1)) {
              playResult(s.good, false);
              vibrate(s.good ? 60 : 150);
            } else sfx.tick();
          }
        }
      }
      if (sim < total) raf.current = requestAnimationFrame(loop);
      else setTimeout(() => onFinish(), 900);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [curves, n, onFinish, results, round]);

  const laneH = n > 8 ? 38 : 48;

  return (
    <div className="game">
      <div className="turn-banner" aria-live="polite">{caption}</div>
      <div className="track" style={{ ['--lane' as string]: laneH + 'px' }}>
        {round.participants.map((p) => {
          const v = progressAt(curves[p.id].pts, Math.max(0, t));
          const pos = finished.indexOf(p.id);
          return (
            <div key={p.id} className="lane">
              <span className="lane-name" style={{ color: p.color }}>{p.name}</span>
              <span className="lane-run">
                <span className="runner" style={{ left: `calc(${v * 100}% - ${v * 34}px)` }}>
                  <span className={'runner-emoji' + (t > 0 && v < 1 ? ' run' : '')} aria-hidden>
                    {animals[p.id]}
                  </span>
                </span>
              </span>
              <span className="lane-rank">
                {pos >= 0 && (
                  <b className="reveal-pop" style={{ color: slotTone(results[p.id], anyGood), display: 'inline-block' }}>
                    {round.config.mode === 'rank' ? `${pos + 1}` : results[p.id].kind === 'pass' ? `${pos + 1}` : results[p.id].label}
                  </b>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <SkipButton onSkip={() => onFinish()} />
    </div>
  );
}
