import { useEffect, useMemo, useState } from 'react';
import { defaultDirection, eliminationPlan } from '../../core/draw';
import { createPrng } from '../../core/rng';
import type { Participant, RoundResult, Slot } from '../../core/types';
import { vibrate } from '../../lib/device';
import { playResult, sfx } from '../../lib/sound';
import { Avatar, slotTone, TurnBanner, useTapGuard } from '../_kit/kit';
import type { GameProps } from '../registry';
import { newBarrel } from './logic';

/**
 * 해적 통: 꽝 구멍은 통마다 시작 전에 정해진다.
 * 구멍 수가 남은 인원의 배수라 모두 같은 횟수만큼 꽂고, 누가 먼저 하든 확률이 같다.
 */
export default function PirateGame({ round, onFinish }: GameProps) {
  const plan = useMemo(() => eliminationPlan(round.slots, defaultDirection(round.config, 'bottom')), [round]);
  const anyGood = round.slots.some((s) => s.good);
  const guard = useTapGuard();

  const [barrelNo, setBarrelNo] = useState(0);
  const [out, setOut] = useState<{ p: Participant; slot: Slot }[]>([]);
  const [stabbed, setStabbed] = useState<number[]>([]);
  const [popped, setPopped] = useState<Participant | null>(null);
  const [turnOffset, setTurnOffset] = useState(0);

  const remaining = useMemo(() => round.participants.filter((p) => !out.some((o) => o.p.id === p.id)), [round, out]);
  // 통은 그 통을 시작할 때 남은 인원 기준으로 만든다
  const [barrelPlayers, setBarrelPlayers] = useState(round.participants);
  const barrel = useMemo(() => newBarrel(barrelPlayers.length, createPrng(round.seed).fork('barrel' + barrelNo)), [barrelPlayers, barrelNo, round.seed]);
  const done = barrelNo >= plan.sequence.length;
  const current = barrelPlayers[(barrel.firstTurn + turnOffset) % barrelPlayers.length];

  const stab = guard((hole: number) => {
    if (popped || done || stabbed.includes(hole)) return;
    setStabbed((s) => [...s, hole]);
    if (hole === barrel.bad) {
      sfx.pop();
      vibrate([300, 80, 200]);
      const slot = round.slots[plan.sequence[barrelNo]];
      setPopped(current);
      setOut((o) => [...o, { p: current, slot }]);
      setTimeout(() => playResult(slot.good, false), 500);
    } else {
      sfx.knife();
      vibrate(25);
      setTurnOffset((t) => t + 1);
    }
  });

  const nextBarrel = () => {
    setPopped(null);
    setStabbed([]);
    setTurnOffset(0);
    setBarrelPlayers(remaining);
    setBarrelNo((b) => b + 1);
  };

  useEffect(() => {
    if (!done) return;
    const res: RoundResult = {};
    out.forEach((o) => (res[o.p.id] = o.slot));
    remaining.forEach((p, i) => (res[p.id] = round.slots[plan.rest[Math.min(i, plan.rest.length - 1)]]));
    const t = setTimeout(() => onFinish(res), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const holes = barrel.holes;
  // 구멍이 많으면 줄을 늘려 손가락으로 누르기 쉬운 간격을 유지한다
  const rows = holes <= 12 ? 2 : holes <= 18 ? 3 : 4;
  const perRow = Math.ceil(holes / rows);
  const lastSlot = popped ? out[out.length - 1].slot : null;

  return (
    <div className="game">
      {popped ? (
        <div className="turn-banner reveal-pop">
          <span style={{ color: popped.color }}>{popped.name}</span>{' '}
          <span style={{ color: slotTone(lastSlot!, anyGood) }}>{lastSlot!.label}</span>!
        </div>
      ) : done ? (
        <div className="turn-banner">끝!</div>
      ) : (
        <TurnBanner player={current} suffix="님, 구멍 하나에 칼을" />
      )}
      <div className="hud">
        <span>통 <b>{Math.min(barrelNo + 1, plan.sequence.length)}</b>/{plan.sequence.length}</span>
        <span>구멍 <b>{holes - stabbed.length}</b>/{holes}</span>
      </div>

      <svg viewBox="0 -20 320 320" className={'pirate' + (popped ? ' shake' : '')} role="group" aria-label="해적 통">
        {/* 해적 */}
        <g className={'pirate-guy' + (popped ? ' up' : '')}>
          <circle cx="160" cy="92" r="34" fill="#f2c9a0" />
          <path d="M122 82 Q160 40 198 82 Z" fill="var(--coral)" />
          <circle cx="148" cy="94" r="4" fill="#1a1a2e" />
          <rect x="164" y="88" width="14" height="10" rx="3" fill="#1a1a2e" />
          <path d="M146 110 Q160 118 174 110" stroke="#1a1a2e" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
        {/* 통 */}
        <path d="M60 120 Q50 210 70 280 L250 280 Q270 210 260 120 Z" fill="#8a5a33" stroke="#5a381d" strokeWidth="4" />
        <rect x="52" y="112" width="216" height="16" rx="6" fill="#5a381d" />
        <rect x="58" y="196" width="204" height="10" fill="#5a381d" opacity=".6" />
        {Array.from({ length: holes }, (_, h) => {
          const row = Math.floor(h / perRow);
          const col = h % perRow;
          const cx = 82 + (col * 156) / Math.max(1, perRow - 1);
          const cy = 156 + (row * 104) / Math.max(1, rows - 1);
          const used = stabbed.includes(h);
          const isBad = popped && h === barrel.bad;
          return (
            <g key={h} role="button" tabIndex={0} aria-label={`${h + 1}번 구멍${used ? ', 꽂음' : ''}`} onClick={() => stab(h)} onKeyDown={(e) => e.key === 'Enter' && stab(h)} style={{ cursor: used ? 'default' : 'pointer' }}>
              <circle cx={cx} cy={cy} r={14} fill="transparent" />
              <circle cx={cx} cy={cy} r={8} fill={isBad ? 'var(--coral)' : '#2a1608'} stroke={isBad ? '#fff' : 'none'} strokeWidth="2" />
              {used && (
                <g className="knife">
                  <rect x={cx - 3} y={cy - 34} width="6" height="30" rx="2" fill="#d8dbe8" />
                  <rect x={cx - 7} y={cy - 40} width="14" height="8" rx="3" fill="var(--lantern)" />
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {popped && (
        <>
          <p className="muted" style={{ textAlign: 'center', margin: 0, fontSize: 14 }}>
            빨간 구멍이 시작 전에 정해져 있던 꽝 구멍이에요.
          </p>
          <button className="btn primary big" style={{ flex: 'none' }} onClick={nextBarrel}>
            {barrelNo + 1 < plan.sequence.length ? '새 통으로 계속' : '결과 보기'}
          </button>
        </>
      )}

      {out.length > 0 && (
        <ul className="award-list">
          {out.map((o) => (
            <li key={o.p.id}>
              <Avatar p={o.p} size={24} />
              {o.p.name}
              <b style={{ color: slotTone(o.slot, anyGood) }}>{o.slot.label}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
