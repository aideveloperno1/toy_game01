import { useEffect, useMemo, useState } from 'react';
import { createPrng } from '../../core/rng';
import type { RoundResult } from '../../core/types';
import { vibrate } from '../../lib/device';
import { playResult, sfx } from '../../lib/sound';
import { slotTone, TurnBanner, TurnHandoff, useTapGuard } from '../_kit/kit';
import type { GameProps } from '../registry';
import { dealCards } from './logic';

/** 카드 배치는 시작 시 seed로 정해진다. 누가 어떤 카드를 고르든 각자의 확률은 같다. */
export default function CardsGame({ round, onFinish }: GameProps) {
  const n = round.participants.length;
  const layout = useMemo(() => dealCards(n, createPrng(round.seed).fork('cards')), [round, n]);
  const anyGood = round.slots.some((s) => s.good);
  const [owner, setOwner] = useState<Record<number, string>>({});
  const [turn, setTurn] = useState(0);
  const [handoff, setHandoff] = useState(true);
  const [justFlipped, setJustFlipped] = useState<number | null>(null);
  const guard = useTapGuard();

  const player = round.participants[turn];
  const taken = Object.keys(owner).map(Number);
  const remainingCards = layout.map((_, i) => i).filter((i) => !(i in owner));
  const remainingHits = remainingCards.filter((c) => round.slots[layout[c]].kind !== 'pass').length;
  const hasPass = round.slots.some((s) => s.kind === 'pass');

  /** 남은 카드가 모두 같은 결과면 더 뽑을 필요가 없다 */
  const settled = turn >= n || (hasPass && remainingHits === 0) || remainingCards.length <= 1;

  const pick = guard((card: number) => {
    if (card in owner || handoff || settled) return;
    const slot = round.slots[layout[card]];
    sfx.flip();
    setOwner((o) => ({ ...o, [card]: player.id }));
    setJustFlipped(card);
    setTimeout(() => {
      playResult(slot.good, slot.kind === 'pass');
      if (slot.kind === 'hit' && !slot.good) vibrate(160);
    }, 350);
    setTimeout(() => {
      setJustFlipped(null);
      setTurn((t) => t + 1);
      setHandoff(true);
    }, 1500);
  });

  // 끝나면 남은 사람에게 남은 카드를 차례로 배정한다
  useEffect(() => {
    if (!settled || justFlipped !== null) return;
    const res: RoundResult = {};
    const o = { ...owner };
    const rest = layout.map((_, i) => i).filter((i) => !(i in o));
    round.participants.slice(turn).forEach((p, k) => (o[rest[k]] = p.id));
    for (const [card, pid] of Object.entries(o)) res[pid] = round.slots[layout[Number(card)]];
    setOwner(o);
    const t = setTimeout(() => onFinish(res), 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, justFlipped]);

  const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const pById = Object.fromEntries(round.participants.map((p) => [p.id, p]));

  return (
    <div className="game">
      {settled ? <div className="turn-banner">결과 확정!</div> : <TurnBanner player={player} suffix="님, 카드 한 장" />}
      <div className="hud">
        {round.config.mode === 'rank' ? (
          <span>남은 카드 <b>{remainingCards.length}</b></span>
        ) : (
          <>
            <span>남은 {round.config.mode === 'loser' ? round.config.label : '항목'} <b>{remainingHits}</b>장</span>
            <span>남은 카드 <b>{remainingCards.length}</b>장</span>
          </>
        )}
      </div>
      <div className="card-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {layout.map((slotIdx, card) => {
          const open = card in owner;
          const slot = round.slots[slotIdx];
          const who = open ? pById[owner[card]] : null;
          return (
            <button
              key={card}
              className={'flip-card' + (open ? ' open' : '')}
              onClick={() => pick(card)}
              disabled={open || settled}
              aria-label={open ? `${who?.name}: ${slot.label}` : `${card + 1}번 카드`}
            >
              <span className="flip-inner">
                <span className="flip-back ticket v">
                  <span className="display">{card + 1}</span>
                </span>
                <span className="flip-front ticket v" style={{ ['--tone' as string]: slotTone(slot, anyGood) }}>
                  <span className="display flip-label">{slot.label}</span>
                  {who && <span className="flip-who">{who.name}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {taken.length === 0 && !handoff && <p className="muted" style={{ textAlign: 'center', margin: 0 }}>카드 배치는 시작할 때 이미 정해졌어요.</p>}
      {handoff && !settled && <TurnHandoff player={player} note="카드를 한 장 골라 뒤집어요" onReady={() => setHandoff(false)} />}
    </div>
  );
}
