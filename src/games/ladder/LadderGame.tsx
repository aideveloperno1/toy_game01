import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resultsFromRanking } from '../../core/draw';
import { createPrng } from '../../core/rng';
import { speedFactor, vibrate } from '../../lib/device';
import { playResult, sfx } from '../../lib/sound';
import { SkipButton, slotTone } from '../_kit/kit';
import type { GameProps } from '../registry';
import { generateLadder, tracePath } from './logic';

const W = 340;
const TOP = 44;
const ROW = 26;

export default function LadderGame({ round, onFinish }: GameProps) {
  const n = round.participants.length;
  const ladder = useMemo(() => generateLadder(n, createPrng(round.seed).fork('ladder')), [round, n]);
  const results = useMemo(() => resultsFromRanking(round), [round]);
  const paths = useMemo(() => round.participants.map((_, i) => tracePath(ladder, i)), [ladder, round]);
  /** 도착 세로줄 → 그 자리에 놓인 결과 */
  const bottom = useMemo(() => {
    const arr = new Array(n);
    round.participants.forEach((p, i) => (arr[paths[i].end] = { slot: results[p.id], p }));
    return arr as { slot: (typeof results)[string]; p: (typeof round.participants)[number] }[];
  }, [paths, results, round, n]);
  const anyGood = round.slots.some((s) => s.good);

  const gap = W / n;
  const x = (c: number) => gap * (c + 0.5);
  const y = (r: number) => TOP + 10 + r * ROW;
  const H = y(ladder.rows) + 20 + 60;

  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const [autoAll, setAutoAll] = useState(false);
  const busy = useRef(false);

  const run = (i: number) =>
    new Promise<void>((resolve) => {
      if (busy.current || revealed.has(i)) return resolve();
      busy.current = true;
      setActive(i);
      sfx.tap();
      setTimeout(() => {
        const r = results[round.participants[i].id];
        playResult(r.good, r.kind === 'pass');
        if (r.kind === 'hit' && !r.good) vibrate(150);
        setRevealed((s) => new Set(s).add(i));
        setActive(null);
        busy.current = false;
        setTimeout(resolve, 350 * speedFactor());
      }, pathDuration(paths[i].points.length));
    });

  const all = async () => {
    setAutoAll(true);
    for (let i = 0; i < n; i++) if (!revealed.has(i)) await run(i);
  };

  useEffect(() => {
    if (revealed.size === n) {
      const t = setTimeout(() => onFinish(), 1200);
      return () => clearTimeout(t);
    }
  }, [revealed, n, onFinish]);

  const fs = n > 9 ? 11 : n > 6 ? 13 : 15;

  return (
    <div className="game">
      <div className="turn-banner" style={{ fontSize: 20 }}>
        {revealed.size === n ? '모두 공개!' : '이름을 눌러 내려가 보세요'}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ladder" role="img" aria-label="사다리">
        {/* 세로줄 */}
        {Array.from({ length: n }, (_, c) => (
          <line key={c} x1={x(c)} y1={TOP} x2={x(c)} y2={y(ladder.rows) + 10} stroke="var(--ink-3)" strokeWidth="3" strokeLinecap="round" />
        ))}
        {/* 가로줄 */}
        {ladder.rungs.map((r, i) => (
          <line key={i} x1={x(r.col)} x2={x(r.col + 1)} y1={y(r.row + 0.5)} y2={y(r.row + 0.5)} stroke="var(--ink-3)" strokeWidth="3" strokeLinecap="round" />
        ))}
        {/* 지나간 경로 */}
        {round.participants.map((p, i) =>
          revealed.has(i) || active === i ? (
            <PathLine key={p.id} pts={paths[i].points.map(([c, r]) => [x(c), y(r)] as [number, number])} color={p.color} animate={active === i} />
          ) : null,
        )}
        {/* 위: 참가자 */}
        {round.participants.map((p, i) => (
          <g
            key={p.id}
            role="button"
            tabIndex={0}
            aria-label={`${p.name} 출발`}
            onClick={() => !autoAll && void run(i)}
            onKeyDown={(e) => e.key === 'Enter' && !autoAll && void run(i)}
            style={{ cursor: 'pointer' }}
          >
            <rect x={x(i) - gap / 2 + 2} y={2} width={gap - 4} height={34} rx={8} fill={revealed.has(i) ? 'var(--night-2)' : p.color} />
            <text x={x(i)} y={24} textAnchor="middle" fontSize={fs} fontWeight="800" fill={revealed.has(i) ? p.color : '#1a1a2e'}>
              {p.name}
            </text>
          </g>
        ))}
        {/* 아래: 결과 */}
        {bottom.map((b, c) => {
          const open = round.participants.some((_, i) => revealed.has(i) && paths[i].end === c);
          return (
            <g key={c} className={open ? 'reveal-pop' : ''} style={{ transformOrigin: `${x(c)}px ${H - 30}px`, transformBox: 'view-box' }}>
              <rect x={x(c) - gap / 2 + 2} y={H - 52} width={gap - 4} height={44} rx={8} fill={open ? slotTone(b.slot, anyGood) : 'var(--night-3)'} />
              <text x={x(c)} y={H - 25} textAnchor="middle" fontSize={fs} fontWeight="800" fill={open ? '#1a1a2e' : 'var(--ink-3)'}>
                {open ? b.slot.label : '?'}
              </text>
            </g>
          );
        })}
      </svg>
      {revealed.size < n && (
        <>
          <button className="btn primary" style={{ flex: 'none' }} onClick={() => void all()} disabled={autoAll}>
            {autoAll ? '공개하는 중…' : '남은 사람 한 번에 공개'}
          </button>
          <SkipButton onSkip={() => onFinish()} />
        </>
      )}
    </div>
  );
}

function pathDuration(points: number) {
  return Math.min(2600, 700 + points * 70) * speedFactor();
}

function PathLine({ pts, color, animate }: { pts: [number, number][]; color: string; animate: boolean }) {
  const ref = useRef<SVGPolylineElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const L = el.getTotalLength?.() ?? 2000;
    el.style.strokeDasharray = String(L);
    if (!animate) {
      el.style.strokeDashoffset = '0';
    } else {
      el.style.transition = 'none';
      el.style.strokeDashoffset = String(L);
      void el.getBoundingClientRect();
      // 처음엔 빠르게, 끝에서 느리게
      el.style.transition = `stroke-dashoffset ${pathDuration(pts.length)}ms cubic-bezier(.3,.1,.3,1)`;
      el.style.strokeDashoffset = '0';
    }
  }, [animate, pts.length]);
  return (
    <polyline
      ref={ref}
      points={pts.map((p) => p.join(',')).join(' ')}
      fill="none"
      stroke={color}
      strokeWidth="6"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}
