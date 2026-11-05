import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultDirection, eliminationPlan } from '../../core/draw';
import { createPrng } from '../../core/rng';
import type { Participant, Slot } from '../../core/types';
import { vibrate } from '../../lib/device';
import { sfx } from '../../lib/sound';
import { Avatar, byId, slotTone, TurnBanner, useTapGuard } from '../_kit/kit';
import type { GameProps } from '../registry';
import { holderAt, planBomb } from './logic';

const HOLD_LIMIT = 15_000;

export default function BombGame({ round, onFinish }: GameProps) {
  const people = useMemo(() => byId(round.participants), [round]);
  const plan = useMemo(() => eliminationPlan(round.slots, defaultDirection(round.config, 'bottom')), [round]);
  const anyGood = round.slots.some((s) => s.good);
  const guard = useTapGuard(350);

  const [bombNo, setBombNo] = useState(0);
  const [out, setOut] = useState<{ p: Participant; slot: Slot }[]>([]);
  const [taps, setTaps] = useState(0);
  const [exploded, setExploded] = useState<Participant | null>(null);
  const [warned, setWarned] = useState(false);
  const [left, setLeft] = useState(HOLD_LIMIT);
  const holdStart = useRef(performance.now());

  const remaining = useMemo(() => round.participants.map((p) => p.id).filter((id) => !out.some((o) => o.p.id === id)), [round, out]);
  const done = bombNo >= plan.sequence.length;
  const target = !done ? round.ranking[plan.sequence[bombNo]] : null;
  // 폭발 직후에는 터진 사람이 남은 명단에서 빠지므로 다음 폭탄 전까지 계획이 없다
  const bomb = useMemo(() => (target && remaining.includes(target) ? planBomb(remaining, target, createPrng(round.seed).fork('bomb' + bombNo)) : null), [target, remaining, round.seed, bombNo]);
  const holder = bomb ? people[holderAt(remaining, bomb.start, taps)] : undefined;

  const pass = () => {
    if (!bomb || exploded) return;
    if (taps === bomb.explodeAt) {
      // 정해둔 차례: 펑
      sfx.boom();
      vibrate([400, 100, 300]);
      const slot = round.slots[plan.sequence[bombNo]];
      setExploded(holder!);
      setOut((o) => [...o, { p: holder!, slot }]);
      return;
    }
    sfx.fuse();
    vibrate(Math.min(80, 15 + taps * 3));
    setTaps((t) => t + 1);
    setWarned(false);
    holdStart.current = performance.now();
  };
  const onTap = guard(pass);

  // 15초 넘게 들고 있으면 경고 후 자동으로 넘긴다. 결과는 바뀌지 않는다.
  useEffect(() => {
    if (!bomb || exploded || done) return;
    holdStart.current = performance.now();
    const iv = setInterval(() => {
      const el = performance.now() - holdStart.current;
      setLeft(Math.max(0, HOLD_LIMIT - el));
      if (el > HOLD_LIMIT - 4000 && !warned) {
        setWarned(true);
        sfx.warn();
      }
      if (el >= HOLD_LIMIT) pass();
    }, 200);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taps, exploded, bombNo, warned]);

  const next = () => {
    setExploded(null);
    setTaps(0);
    setBombNo((b) => b + 1);
  };

  useEffect(() => {
    if (done) {
      const t = setTimeout(() => onFinish(), 800);
      return () => clearTimeout(t);
    }
  }, [done, onFinish]);

  const lastSlot = exploded ? out[out.length - 1].slot : null;
  // 심지 길이: 탭할수록 줄어드는 것처럼 보이는 연출 (남은 탭 수는 알려주지 않는다)
  const fuse = bomb ? Math.max(0.12, 1 - taps / (bomb.explodeAt + remaining.length * 1.5)) : 0;

  return (
    <div className={'game' + (exploded ? ' shake' : '')}>
      {exploded ? (
        <div className="turn-banner reveal-pop">
          펑! <span style={{ color: exploded.color }}>{exploded.name}</span>{' '}
          <span style={{ color: slotTone(lastSlot!, anyGood) }}>{lastSlot!.label}</span>
        </div>
      ) : done ? (
        <div className="turn-banner">끝!</div>
      ) : (
        <TurnBanner player={holder} suffix="님이 들고 있어요" />
      )}
      <div className="hud">
        <span>폭탄 <b>{Math.min(bombNo + 1, plan.sequence.length)}</b>/{plan.sequence.length}</span>
        <span>남은 사람 <b>{remaining.length}</b></span>
        {!exploded && !done && <span style={{ color: warned ? 'var(--coral)' : undefined }}>자동 넘김 {Math.ceil(left / 1000)}초</span>}
      </div>

      <button className={'bomb' + (exploded ? ' boom' : '')} onClick={onTap} disabled={!!exploded || done} aria-label="폭탄을 누르고 옆 사람에게 넘기기">
        <svg viewBox="0 0 200 200" aria-hidden>
          <path d={`M 128 58 Q ${150 + 20 * fuse} ${40 - 30 * fuse} ${150 + 30 * fuse} ${30 - 25 * fuse}`} fill="none" stroke="var(--ink-2)" strokeWidth="6" strokeLinecap="round" />
          {!exploded && <circle className="spark" cx={150 + 30 * fuse} cy={30 - 25 * fuse} r="9" fill="var(--lantern)" />}
          <rect x="108" y="50" width="34" height="26" rx="6" transform="rotate(35 125 63)" fill="var(--night-3)" />
          <circle cx="96" cy="118" r="66" fill={exploded ? 'var(--coral)' : '#2b2d48'} stroke="var(--ink-3)" strokeWidth="4" />
          <ellipse cx="72" cy="94" rx="18" ry="12" fill="#fff" opacity=".18" />
        </svg>
        <span className="bomb-label display">{exploded ? '펑!' : '누르고 넘기기'}</span>
      </button>

      {exploded && (
        <button className="btn primary big" style={{ flex: 'none' }} onClick={next}>
          {bombNo + 1 < plan.sequence.length ? '다음 폭탄' : '결과 보기'}
        </button>
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
      <p className="muted" style={{ fontSize: 13, textAlign: 'center', margin: 0 }}>
        입력한 순서대로 옆 사람에게 넘겨요. 15초 넘게 들고 있으면 자동으로 넘어가요.
      </p>
    </div>
  );
}
