import { Suspense, useState } from 'react';
import { seedTag } from '../core/rng';
import { Dialog } from '../components/ui';
import { gameById } from '../games/registry';
import { useWakeLock } from '../lib/device';
import { useApp } from '../store/app';

export default function Play() {
  const { round, finish, go, replay } = useApp();
  const [leaving, setLeaving] = useState(false);
  useWakeLock(true);
  if (!round) return null;
  const game = gameById(round.gameId);
  const Game = game.Component;

  return (
    <main className="screen play">
      <header className="topbar">
        <button className="icon-btn" aria-label="게임 그만두기" onClick={() => setLeaving(true)}>
          ×
        </button>
        <h1 className="display">{game.name}</h1>
        <span className="tag" title="이번 판을 구분하는 번호예요.">
          {replay ? '다시 보기 ' : ''}판 {seedTag(round.seed)}
          {round.attempt > 1 && <b className="again"> 재경기 {round.attempt}회차</b>}
        </span>
      </header>
      <Suspense fallback={<div className="loading muted">게임 준비 중…</div>}>
        <Game key={round.id + (replay ? ':r' : '')} round={round} onFinish={finish} />
      </Suspense>
      {leaving && (
        <Dialog title="게임을 그만둘까요?" onClose={() => setLeaving(false)}>
          <p style={{ margin: 0 }} className="muted">
            이번 판은 기록되지 않아요.
          </p>
          <div className="row">
            <button className="btn ghost" onClick={() => setLeaving(false)}>
              계속하기
            </button>
            <button className="btn primary" onClick={() => go(replay ? 'history' : 'picker')}>
              그만두기
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
