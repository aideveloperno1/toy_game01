import { useEffect, useRef, useState } from 'react';
import { Stepper, TopBar } from '../components/ui';
import { cryptoInt } from '../core/rng';
import { PLAYER_COLORS, useApp } from '../store/app';
import { useWakeLock, vibrate } from '../lib/device';
import { sfx } from '../lib/sound';

type Touch = { id: number; x: number; y: number; color: string };
type Phase = 'setup' | 'waiting' | 'countdown' | 'done';

/** 손가락 터치 뽑기: 이름 없이, 화면에 올린 손가락 중 K개를 고른다 */
export default function Instant() {
  const logInstant = useApp((s) => s.logInstant);
  const [pick, setPick] = useState(1);
  const [phase, setPhase] = useState<Phase>('setup');
  const [touches, setTouches] = useState<Touch[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [count, setCount] = useState(3);
  const area = useRef<HTMLDivElement>(null);
  const stableTimer = useRef(0);
  const countTimer = useRef(0);
  const colorFor = useRef(new Map<number, string>());
  const touchesRef = useRef<Touch[]>([]);
  const phaseRef = useRef<Phase>('setup');
  phaseRef.current = phase;
  useWakeLock(phase !== 'setup');

  const canTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 1);

  useEffect(() => () => { clearTimeout(stableTimer.current); clearInterval(countTimer.current); }, []);

  useEffect(() => {
    const el = area.current;
    if (!el || phase === 'setup') return;
    const update = (e: TouchEvent) => {
      e.preventDefault();
      if (phaseRef.current === 'done') return;
      const rect = el.getBoundingClientRect();
      const list: Touch[] = Array.from(e.touches).map((t) => {
        if (!colorFor.current.has(t.identifier)) colorFor.current.set(t.identifier, PLAYER_COLORS[colorFor.current.size % PLAYER_COLORS.length]);
        return { id: t.identifier, x: t.clientX - rect.left, y: t.clientY - rect.top, color: colorFor.current.get(t.identifier)! };
      });
      const prev = touchesRef.current.length;
      const changed = list.length !== prev;
      touchesRef.current = list;
      setTouches(list);
      if (changed) {
        if (list.length > prev) sfx.tap();
        // 손가락 수가 바뀌면 카운트다운을 처음부터
        clearTimeout(stableTimer.current);
        clearInterval(countTimer.current);
        setPhase('waiting');
        if (list.length > pick) {
          stableTimer.current = window.setTimeout(beginCountdown, 1500);
        }
      }
    };
    el.addEventListener('touchstart', update, { passive: false });
    el.addEventListener('touchmove', update, { passive: false });
    el.addEventListener('touchend', update, { passive: false });
    el.addEventListener('touchcancel', update, { passive: false });
    return () => {
      el.removeEventListener('touchstart', update);
      el.removeEventListener('touchmove', update);
      el.removeEventListener('touchend', update);
      el.removeEventListener('touchcancel', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'setup', pick]);

  function beginCountdown() {
    setPhase('countdown');
    let c = 3;
    setCount(c);
    sfx.beep();
    countTimer.current = window.setInterval(() => {
      c -= 1;
      if (c > 0) {
        setCount(c);
        sfx.beep();
        vibrate(20);
        return;
      }
      clearInterval(countTimer.current);
      // 손가락이 모두 올라온 이 순간 암호학적 난수로 고른다
      const ids = touchesRef.current.map((t) => t.id);
      const pool = [...ids];
      const sel: number[] = [];
      for (let i = 0; i < Math.min(pick, pool.length - 1); i++) sel.push(pool.splice(cryptoInt(pool.length), 1)[0]);
      setChosen(sel);
      setPhase('done');
      sfx.win();
      vibrate([80, 60, 120]);
      logInstant(ids.length, sel.length);
    }, 700);
  }

  const reset = () => {
    clearTimeout(stableTimer.current);
    clearInterval(countTimer.current);
    colorFor.current.clear();
    touchesRef.current = [];
    setTouches([]);
    setChosen([]);
    setPhase('waiting');
  };

  if (phase === 'setup') {
    return (
      <main className="screen">
        <TopBar title="손가락 터치 뽑기" back="home" />
        <div className="body">
          <div className="card">
            <div className="row between">
              <b>몇 명을 고를까요?</b>
              <Stepper label="고를 인원" value={pick} min={1} max={9} onChange={setPick} />
            </div>
          </div>
          <ol className="muted" style={{ margin: 0, paddingLeft: 20 }}>
            <li>폰을 테이블 가운데에 놓아요.</li>
            <li>모두 화면에 손가락을 하나씩 올려요.</li>
            <li>손가락 수가 잠깐 그대로면 3초 카운트다운 후 {pick}명이 골라져요.</li>
          </ol>
          {!canTouch && <p className="error">이 게임은 터치 화면이 있는 휴대폰이나 태블릿에서만 할 수 있어요.</p>}
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            기기마다 동시에 인식하는 손가락 수(보통 5~10개)가 정해져 있어요.
          </p>
        </div>
        <div className="actions">
          <button className="btn primary big" disabled={!canTouch} onClick={() => setPhase('waiting')}>
            시작
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="finger-screen">
      <div ref={area} className="finger-area" aria-label="손가락을 올리는 곳">
        <div className="finger-hint display" aria-live="polite">
          {phase === 'waiting' && (touches.length <= pick ? `손가락을 올려요 (${pick + 1}명 이상)` : '그대로 기다려요…')}
          {phase === 'countdown' && <span className="finger-count">{count}</span>}
          {phase === 'done' && '이 손가락!'}
        </div>
        {touches.map((t) => {
          const isChosen = chosen.includes(t.id);
          const hidden = phase === 'done' && !isChosen;
          return (
            <span
              key={t.id}
              className={'finger-dot' + (phase === 'countdown' ? ' pulse' : '') + (isChosen ? ' chosen' : '') + (hidden ? ' gone' : '')}
              style={{ left: t.x, top: t.y, ['--c' as string]: t.color }}
            />
          );
        })}
      </div>
      <div className="finger-bar">
        <button className="btn ghost small" onClick={() => setPhase('setup')}>
          나가기
        </button>
        {phase === 'done' && (
          <button className="btn primary small" onClick={reset}>
            다시
          </button>
        )}
      </div>
    </main>
  );
}
