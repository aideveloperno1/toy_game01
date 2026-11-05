import { useEffect, useMemo, useRef, useState } from 'react';
import { resultsFromRanking } from '../../core/draw';
import { createPrng } from '../../core/rng';
import { vibrate } from '../../lib/device';
import { playResult, sfx } from '../../lib/sound';
import { slotTone, TurnHandoff } from '../_kit/kit';
import type { GameProps } from '../registry';

const SYMBOLS = ['★', '♣', '♥', '◆', '●', '▲'];

/** 결과는 시작 시 정해져 있고, 각자 은박을 긁어서 확인한다 */
export default function ScratchGame({ round, onFinish }: GameProps) {
  const results = useMemo(() => resultsFromRanking(round), [round]);
  const anyGood = round.slots.some((s) => s.good);
  const prng = useMemo(() => createPrng(round.seed).fork('scratch'), [round]);
  /** 꽝·당첨이면 같은 그림 3개, 아니면 2개만 같게 그려 마지막 칸까지 긴장감을 준다 */
  const symbols = useMemo(
    () =>
      Object.fromEntries(
        round.participants.map((p) => {
          const s = results[p.id];
          const a = prng.pick(SYMBOLS);
          const others = SYMBOLS.filter((x) => x !== a);
          const three = s.kind !== 'pass';
          const set = three ? [a, a, a] : prng.shuffle([a, a, prng.pick(others)]);
          return [p.id, set];
        }),
      ),
    [round, results, prng],
  );

  const [turn, setTurn] = useState(0);
  const [handoff, setHandoff] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const player = round.participants[turn];
  const done = turn >= round.participants.length;

  useEffect(() => {
    if (done) {
      const t = setTimeout(() => onFinish(), 600);
      return () => clearTimeout(t);
    }
  }, [done, onFinish]);

  if (done) return <div className="game"><div className="turn-banner">모두 확인!</div></div>;
  const slot = results[player.id];

  return (
    <div className="game">
      <div className="turn-banner">
        <span style={{ color: player.color }}>{player.name}</span>님의 복권
      </div>
      <div className="hud">
        <span>
          <b>{turn + 1}</b>/{round.participants.length}번째
        </span>
      </div>
      <div className="scratch-ticket ticket" key={player.id}>
        <div className="scratch-under">
          <div className="scratch-symbols">
            {symbols[player.id].map((s, i) => (
              <span key={i}>{s}</span>
            ))}
          </div>
          <div className="display scratch-label" style={{ color: slotTone(slot, anyGood) }}>
            {slot.label}
          </div>
        </div>
        {!revealed && (
          <Foil
            onReveal={() => {
              setRevealed(true);
              playResult(slot.good, slot.kind === 'pass');
              if (slot.kind === 'hit' && !slot.good) vibrate(160);
            }}
          />
        )}
      </div>
      <p className="muted" style={{ textAlign: 'center', margin: 0 }}>{revealed ? '' : '손가락으로 은박을 긁어요'}</p>
      {revealed && (
        <button
          className="btn primary big"
          style={{ flex: 'none' }}
          onClick={() => {
            setRevealed(false);
            setTurn((t) => t + 1);
            setHandoff(true);
          }}
        >
          {turn + 1 < round.participants.length ? '다음 사람에게 넘기기' : '결과 보기'}
        </button>
      )}
      {handoff && <TurnHandoff player={player} note="복권을 긁어서 확인해요" onReady={() => setHandoff(false)} />}
    </div>
  );
}

function Foil({ onReveal }: { onReveal(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const moves = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr;
    cv.height = cv.clientHeight * dpr;
    const g = cv.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, cv.width, cv.height);
    grad.addColorStop(0, '#b9bccf');
    grad.addColorStop(0.5, '#e6e8f2');
    grad.addColorStop(1, '#a6a9bf');
    g.fillStyle = grad;
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(40,40,70,.35)';
    g.font = `${28 * dpr}px Jua, system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('여기를 긁어요', cv.width / 2, cv.height / 2);
  }, []);

  const scratch = (x: number, y: number) => {
    const cv = ref.current!;
    const g = cv.getContext('2d')!;
    const rect = cv.getBoundingClientRect();
    const sx = ((x - rect.left) / rect.width) * cv.width;
    const sy = ((y - rect.top) / rect.height) * cv.height;
    const r = cv.width * 0.07;
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = r * 2;
    g.lineCap = 'round';
    g.beginPath();
    const [lx, ly] = last.current ?? [sx, sy];
    g.moveTo(lx, ly);
    g.lineTo(sx, sy);
    g.stroke();
    last.current = [sx, sy];
    if (++moves.current % 6 === 0) {
      sfx.scratch();
      // 투명해진 비율 확인 (격자 표본)
      const data = g.getImageData(0, 0, cv.width, cv.height).data;
      let clear = 0;
      let total = 0;
      const step = 16;
      for (let yy = 0; yy < cv.height; yy += step)
        for (let xx = 0; xx < cv.width; xx += step) {
          total++;
          if (data[(yy * cv.width + xx) * 4 + 3] < 64) clear++;
        }
      if (clear / total > 0.6 && !doneRef.current) {
        doneRef.current = true;
        onReveal();
      }
    }
  };

  return (
    <canvas
      ref={ref}
      className="scratch-foil"
      onPointerDown={(e) => {
        drawing.current = true;
        last.current = null;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        scratch(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => drawing.current && scratch(e.clientX, e.clientY)}
      onPointerUp={() => {
        drawing.current = false;
        last.current = null;
      }}
      aria-label="복권 은박. 긁어서 결과 확인"
      role="img"
    />
  );
}
