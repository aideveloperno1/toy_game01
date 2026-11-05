import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultDirection, eliminationPlan } from '../../core/draw';
import { createPrng } from '../../core/rng';
import type { Participant, Slot } from '../../core/types';
import { speedFactor, vibrate } from '../../lib/device';
import { playResult, sfx } from '../../lib/sound';
import { Avatar, byId, SkipButton, slotTone } from '../_kit/kit';
import type { GameProps } from '../registry';

type Award = { p: Participant; slot: Slot };

const R = 150;
const C = 170;

export default function RouletteGame({ round, onFinish }: GameProps) {
  const people = useMemo(() => byId(round.participants), [round]);
  const plan = useMemo(() => eliminationPlan(round.slots, defaultDirection(round.config, 'top')), [round]);
  const prng = useMemo(() => createPrng(round.seed).fork('roulette'), [round]);
  const anyGood = round.slots.some((s) => s.good);

  const [step, setStep] = useState(0);
  const [wheel, setWheel] = useState<Participant[]>(round.participants);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);
  const [awards, setAwards] = useState<Award[]>([]);
  const raf = useRef(0);
  const angleRef = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const done = step >= plan.sequence.length;
  const nextSlot = !done ? round.slots[plan.sequence[step]] : null;
  const seg = 360 / wheel.length;

  const spin = () => {
    if (spinning || done) return;
    sfx.start();
    const targetId = round.ranking[plan.sequence[step]];
    const i = wheel.findIndex((p) => p.id === targetId);
    // 30% 확률로 칸 경계 근처에 멈추는 아슬아슬 연출
    const f = prng.next() < 0.3 ? (prng.next() < 0.5 ? 0.04 : 0.96) : prng.range(0.2, 0.8);
    const want = (((360 - (i + f) * seg) % 360) + 360) % 360;
    const from = angleRef.current;
    const base = from - (((from % 360) + 360) % 360);
    const spins = 4 + prng.int(3);
    const to = base + spins * 360 + want;
    const dur = (3600 + prng.int(1800)) * speedFactor();
    const t0 = performance.now();
    let lastSeg = -1;
    setSpinning(true);
    setLanded(null);
    const ease = (t: number) => 1 - Math.pow(1 - t, 4);
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const a = from + (to - from) * ease(t);
      angleRef.current = a;
      setAngle(a);
      const under = Math.floor((((360 - (a % 360)) % 360) + 360) % 360 / seg);
      if (under !== lastSeg) {
        lastSeg = under;
        sfx.tick();
      }
      if (t < 1) raf.current = requestAnimationFrame(frame);
      else land(targetId);
    };
    raf.current = requestAnimationFrame(frame);
  };

  const land = (targetId: string) => {
    const slot = round.slots[plan.sequence[step]];
    setLanded(targetId);
    playResult(slot.good, slot.kind === 'pass');
    vibrate(120);
    setTimeout(() => {
      setAwards((a) => [...a, { p: people[targetId], slot }]);
      setWheel((w) => w.filter((p) => p.id !== targetId));
      setStep((s) => s + 1);
      setSpinning(false);
      setLanded(null);
    }, 1400 * speedFactor());
  };

  useEffect(() => {
    if (done) {
      const t = setTimeout(() => onFinish(), 900);
      return () => clearTimeout(t);
    }
  }, [done, onFinish]);

  const landedP = landed ? people[landed] : null;

  return (
    <div className="game">
      <div className="turn-banner">
        {done ? '끝!' : landedP ? (
          <span className="reveal-pop" style={{ display: 'inline-block' }}>
            <span style={{ color: landedP.color }}>{landedP.name}</span> {nextSlot!.label}!
          </span>
        ) : (
          <>
            {nextSlot!.label} 뽑기 <span className="muted" style={{ fontSize: 18 }}>({step + 1}/{plan.sequence.length})</span>
          </>
        )}
      </div>

      <div className="roulette-wrap">
        <svg viewBox="0 0 340 350" className="roulette" role="img" aria-label="룰렛 원판">
          <g transform={`translate(${C} ${C + 10}) rotate(${angle})`}>
            {wheel.map((p, i) => {
              const a0 = ((i * seg - 90) * Math.PI) / 180;
              const a1 = (((i + 1) * seg - 90) * Math.PI) / 180;
              const large = seg > 180 ? 1 : 0;
              const d =
                wheel.length === 1
                  ? `M 0 ${-R} A ${R} ${R} 0 1 1 -0.01 ${-R} Z`
                  : `M 0 0 L ${R * Math.cos(a0)} ${R * Math.sin(a0)} A ${R} ${R} 0 ${large} 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)} Z`;
              const mid = (i + 0.5) * seg;
              const fs = wheel.length > 14 ? 11 : wheel.length > 8 ? 14 : 17;
              return (
                <g key={p.id}>
                  <path d={d} fill={p.color} stroke="var(--night)" strokeWidth="2" opacity={landed && landed !== p.id ? 0.35 : 1} />
                  <text
                    transform={`rotate(${mid}) translate(0 ${-R + 18}) rotate(90)`}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fontSize={fs}
                    fontWeight="800"
                    fill="#1a1a2e"
                  >
                    {p.name}
                  </text>
                </g>
              );
            })}
            <circle r="26" fill="var(--night)" stroke="var(--lantern)" strokeWidth="4" />
          </g>
          <path d={`M ${C - 14} 4 L ${C + 14} 4 L ${C} 30 Z`} fill="var(--lantern)" stroke="var(--night)" strokeWidth="2" />
        </svg>
      </div>

      <button className="btn primary big" style={{ flex: 'none' }} onClick={spin} disabled={spinning || done}>
        {spinning ? '돌아가는 중…' : step === 0 ? '돌리기' : '다음 판 돌리기'}
      </button>

      {awards.length > 0 && (
        <ul className="award-list">
          {awards.map((a) => (
            <li key={a.p.id}>
              <Avatar p={a.p} size={24} />
              {a.p.name}
              <b style={{ color: slotTone(a.slot, anyGood) }}>{a.slot.label}</b>
            </li>
          ))}
        </ul>
      )}
      {!done && <SkipButton onSkip={() => onFinish()} />}
    </div>
  );
}
