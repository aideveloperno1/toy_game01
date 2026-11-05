import { useEffect, useRef, useState } from 'react';
import { resultsFromOrder } from '../../core/draw';
import type { Participant } from '../../core/types';
import { sfx } from '../../lib/sound';
import { vibrate } from '../../lib/device';
import { TurnHandoff, useTapGuard } from '../_kit/kit';
import type { GameProps } from '../registry';

const TARGET = 10;
const HIDE_AFTER = 3;

type Rec = { error: number; time: number; retry?: number; retryTime?: number };

/** 10초 맞추기: 실력형. 10초에서 많이 벗어날수록 나쁜 결과 */
export default function StopwatchGame({ round, onFinish }: GameProps) {
  const [queue, setQueue] = useState<Participant[]>(round.participants);
  const [idx, setIdx] = useState(0);
  const [records, setRecords] = useState<Record<string, Rec>>({});
  const [phase, setPhase] = useState<'handoff' | 'ready' | 'running' | 'stopped'>('handoff');
  const [elapsed, setElapsed] = useState(0);
  const [tieRound, setTieRound] = useState(false);
  const startAt = useRef(0);
  const raf = useRef(0);
  const guard = useTapGuard(200);
  const player = queue[idx];

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const start = () => {
    sfx.start();
    startAt.current = performance.now();
    setPhase('running');
    const tick = () => {
      setElapsed((performance.now() - startAt.current) / 1000);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const stop = guard(() => {
    const time = (performance.now() - startAt.current) / 1000;
    cancelAnimationFrame(raf.current);
    setElapsed(time);
    const error = Math.abs(time - TARGET);
    sfx.beep();
    vibrate(40);
    setRecords((r) => ({
      ...r,
      [player.id]: tieRound ? { ...r[player.id], retry: error, retryTime: time } : { error, time },
    }));
    setPhase('stopped');
  });

  const next = () => {
    if (idx + 1 < queue.length) {
      setIdx(idx + 1);
      setPhase('handoff');
      setElapsed(0);
      return;
    }
    // 동점(0.01초 단위)이면 그 사람들끼리 한 번 더
    const cs = (x: number) => Math.round(x * 100);
    const groups = new Map<string, string[]>();
    for (const p of round.participants) {
      const r = records[p.id];
      const key = cs(r.error) + ':' + (r.retry !== undefined ? cs(r.retry) : '');
      groups.set(key, [...(groups.get(key) ?? []), p.id]);
    }
    const tied = [...groups.values()].filter((g) => g.length > 1).flat();
    if (tied.length && !tieRound) {
      setTieRound(true);
      setQueue(round.participants.filter((p) => tied.includes(p.id)));
      setIdx(0);
      setPhase('handoff');
      setElapsed(0);
      return;
    }
    // 오차가 작은 순서가 좋은 순위 (동점은 재도전 기록, 그래도 같으면 입력 순서)
    const order = [...round.participants]
      .sort((a, b) => {
        const ra = records[a.id];
        const rb = records[b.id];
        return cs(ra.error) - cs(rb.error) || (ra.retry ?? 0) - (rb.retry ?? 0);
      })
      .map((p) => p.id);
    onFinish(resultsFromOrder(order, round.slots));
  };

  const hidden = phase === 'running' && elapsed > HIDE_AFTER;
  const rec = records[player?.id];
  const shown = phase === 'stopped' && rec ? (tieRound ? rec.retryTime ?? elapsed : rec.time) : elapsed;

  return (
    <div className="game">
      <div className="turn-banner">
        {tieRound && <span style={{ color: 'var(--coral)' }}>동점 재도전 · </span>}
        <span style={{ color: player.color }}>{player.name}</span> 차례
      </div>
      <div className="hud">
        <span><b>{idx + 1}</b>/{queue.length}</span>
        <span>목표 <b>{TARGET.toFixed(2)}초</b></span>
      </div>

      <div className="watch ticket">
        <div className={'watch-digits display' + (hidden ? ' hidden' : '')} aria-live="off">
          {hidden ? '?.??' : shown.toFixed(2)}
        </div>
        {phase === 'stopped' && rec && (
          <div className="reveal-pop watch-err">
            오차 {(tieRound ? rec.retry ?? 0 : rec.error).toFixed(2)}초
          </div>
        )}
        {phase === 'running' && !hidden && <div className="muted">{HIDE_AFTER}초 뒤 숫자가 사라져요</div>}
      </div>

      {phase === 'ready' && (
        <button className="btn primary big" style={{ flex: 'none', minHeight: 96 }} onClick={start}>
          시작
        </button>
      )}
      {phase === 'running' && (
        <button className="btn big watch-stop" style={{ flex: 'none', minHeight: 96 }} onClick={stop}>
          멈춤!
        </button>
      )}
      {phase === 'stopped' && (
        <button className="btn primary big" style={{ flex: 'none' }} onClick={next}>
          {idx + 1 < queue.length ? '다음 사람' : '결과 보기'}
        </button>
      )}

      {Object.keys(records).length > 0 && (
        <ul className="award-list">
          {round.participants
            .filter((p) => records[p.id])
            .map((p) => (
              <li key={p.id}>
                <span className="dot" style={{ background: p.color }} />
                {p.name}
                <b>{records[p.id].time.toFixed(2)}초</b>
              </li>
            ))}
        </ul>
      )}
      {phase === 'handoff' && (
        <TurnHandoff
          player={player}
          note={tieRound ? '동점이라 한 번 더 해요' : '시작을 누르고 10초라고 생각할 때 멈춰요'}
          onReady={() => setPhase('ready')}
        />
      )}
    </div>
  );
}
