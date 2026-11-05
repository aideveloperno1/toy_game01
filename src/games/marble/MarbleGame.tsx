import { useEffect, useMemo, useRef, useState } from 'react';
import { resultsFromRanking } from '../../core/draw';
import type { Participant } from '../../core/types';
import { speedFactor, vibrate } from '../../lib/device';
import { playResult, sfx } from '../../lib/sound';
import { SkipButton, slotTone } from '../_kit/kit';
import type { GameProps } from '../registry';
import { MAPS, MARBLE_R, REC_EVERY, SIM_HZ, WORLD_W, type SimResult } from './maps';

const REC_FPS = SIM_HZ / REC_EVERY;

export default function MarbleGame({ round, onFinish }: GameProps) {
  const n = round.participants.length;
  const [sim, setSim] = useState<SimResult | null>(null);
  const [finished, setFinished] = useState<number[]>([]);
  const [countdown, setCountdown] = useState(3);
  const canvas = useRef<HTMLCanvasElement>(null);
  const results = useMemo(() => resultsFromRanking(round), [round]);
  const anyGood = round.slots.some((s) => s.good);

  // 1) 워커에서 시뮬레이션
  useEffect(() => {
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<SimResult>) => setSim(e.data);
    w.postMessage({ seed: round.seed, n });
    return () => w.terminate();
  }, [round.seed, n]);

  /** 구슬 번호 → 참가자: p번째로 도착한 구슬이 순위 p번째 사람 */
  const marbleOwner = useMemo(() => {
    if (!sim) return [] as Participant[];
    const byIdMap = Object.fromEntries(round.participants.map((p) => [p.id, p]));
    const owner: Participant[] = new Array(n);
    sim.order.forEach((marble, pos) => (owner[marble] = byIdMap[round.ranking[pos]]));
    return owner;
  }, [sim, round, n]);

  // 2) 카운트다운 후 재생
  useEffect(() => {
    if (!sim) return;
    if (countdown > 0) {
      sfx.beep();
      const t = setTimeout(() => setCountdown((c) => c - 1), 700);
      return () => clearTimeout(t);
    }
    sfx.start();
    const map = MAPS.find((m) => m.id === sim.mapId)!;
    const cv = canvas.current!;
    const ctx = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const cs = getComputedStyle(document.documentElement);
    const col = { line: cs.getPropertyValue('--ink-3').trim() || '#7f7eaa', lantern: cs.getPropertyValue('--lantern').trim() || '#ffc93c', bg: cs.getPropertyValue('--night-2').trim() || '#23254a' };

    let raf = 0;
    let camY = 0;
    const t0 = performance.now();
    const announced = new Set<number>();
    const speed = 1 / speedFactor();

    const draw = (now: number) => {
      const f = Math.min(sim.frameCount - 1, ((now - t0) / 1000) * REC_FPS * speed);
      const f0 = Math.floor(f);
      const f1 = Math.min(sim.frameCount - 1, f0 + 1);
      const k = f - f0;
      const pos = (i: number): [number, number] => {
        const a = (f0 * n + i) * 2;
        const b = (f1 * n + i) * 2;
        return [sim.frames[a] + (sim.frames[b] - sim.frames[a]) * k, sim.frames[a + 1] + (sim.frames[b + 1] - sim.frames[a + 1]) * k];
      };

      // 도착 알림
      for (const i of sim.order) {
        if (!announced.has(i) && sim.finishFrame[i] <= f0) {
          announced.add(i);
          const p = marbleOwner[i];
          const s = results[p.id];
          setFinished((x) => [...x, i]);
          if (s.kind === 'hit' || (s.kind === 'rank' && s.rank === 1)) {
            playResult(s.good, false);
            vibrate(s.good ? 60 : 160);
          } else sfx.tick();
        }
      }

      // 카메라: 처음엔 선두, 남은 구슬이 적어지면 꼴찌 경쟁을 비춘다
      const unfinished = Array.from({ length: n }, (_, i) => i).filter((i) => !announced.has(i));
      const scale = cv.width / WORLD_W;
      const viewH = cv.height / scale;
      let focus = map.finishY;
      if (unfinished.length) {
        const ys = unfinished.map((i) => pos(i)[1]).sort((a, b) => b - a);
        const tension = unfinished.length <= Math.max(3, Math.ceil(n * 0.25));
        focus = tension ? ys[ys.length - 1] + Math.min(220, (ys[0] - ys[ys.length - 1]) / 2) : ys[0];
      }
      const target = Math.max(0, Math.min(map.height - viewH, focus - viewH * 0.45));
      camY += (target - camY) * 0.08;

      ctx.setTransform(scale, 0, 0, scale, 0, -camY * scale);
      ctx.clearRect(0, camY, WORLD_W, viewH);

      // 결승선
      ctx.fillStyle = col.lantern;
      for (let x = 0; x < WORLD_W; x += 20) ctx.fillRect(x + ((x / 20) % 2 ? 10 : 0), map.finishY, 10, 6);

      // 장애물
      const tSec = (f * REC_EVERY) / SIM_HZ;
      ctx.fillStyle = col.line;
      for (const s of map.shapes) {
        if (s.y < camY - 200 || s.y > camY + viewH + 200) continue;
        if (s.kind === 'peg') {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const ang = s.kind === 'bar' ? s.angle : s.phase + s.speed * tSec;
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(ang);
          ctx.fillStyle = s.kind === 'spinner' ? col.lantern : col.line;
          ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
          ctx.restore();
        }
      }

      // 구슬
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const [x, y] = pos(i);
        if (y < camY - 30 || y > camY + viewH + 30) continue;
        const p = marbleOwner[i];
        ctx.beginPath();
        ctx.arc(x, y, MARBLE_R, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = col.bg;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.lineWidth = 3;
        ctx.strokeText(p.name, x, y - 16);
        ctx.fillText(p.name, x, y - 16);
      }

      if (f < sim.frameCount - 1) raf = requestAnimationFrame(draw);
      else setTimeout(() => onFinish(), 1200);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [sim, countdown, marbleOwner, results, n, onFinish]);

  const map = sim ? MAPS.find((m) => m.id === sim.mapId) : null;
  const lastFinished = finished.length ? marbleOwner[finished[finished.length - 1]] : null;

  return (
    <div className="game">
      <div className="hud">
        <span>맵 <b>{map?.name ?? '…'}</b></span>
        <span>도착 <b>{finished.length}</b>/{n}</span>
        {lastFinished && (
          <span key={lastFinished.id} className="reveal-pop">
            <b style={{ color: lastFinished.color }}>{lastFinished.name}</b>{' '}
            <span style={{ color: slotTone(results[lastFinished.id], anyGood) }}>{results[lastFinished.id].label}</span>
          </span>
        )}
      </div>
      <div className="marble-stage">
        <canvas ref={canvas} className="marble-canvas" aria-label="구슬 레이스 화면" />
        {(!sim || countdown > 0) && <div className="marble-count display" style={sim ? undefined : { fontSize: 28 }}>{sim ? countdown : '맵 준비 중…'}</div>}
      </div>
      <SkipButton onSkip={() => onFinish()} />
    </div>
  );
}
