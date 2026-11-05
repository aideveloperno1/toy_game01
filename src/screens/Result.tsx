import { useEffect, useState } from 'react';
import { groupResults } from '../core/draw';
import { seedTag } from '../core/rng';
import { toast, TopBar } from '../components/ui';
import { Avatar, slotTone } from '../games/_kit/kit';
import { GAME_NAMES } from '../games/registry';
import { vibrate } from '../lib/device';
import { shareResult } from '../lib/share';
import { sfx } from '../lib/sound';
import { useApp } from '../store/app';

export default function Result() {
  const { round, results, start, go, replay } = useApp();
  const [sharing, setSharing] = useState(false);

  const groups = round && results ? groupResults(results, round.participants) : [];
  const headline = groups.find((g) => g.slot.kind !== 'pass') ?? groups[0];
  const anyGood = groups.some((g) => g.slot.good);

  useEffect(() => {
    if (!headline) return;
    if (headline.slot.good) sfx.win();
    else if (headline.slot.kind === 'hit') sfx.lose();
    else sfx.pass();
    vibrate(headline.slot.good ? [60, 40, 60] : 200);
  }, [headline]);

  if (!round || !results || !headline) return null;
  const rest = groups.filter((g) => g !== headline);
  const isRank = round.config.mode === 'rank';
  const title = isRank ? '1등은' : headline.slot.good ? '축하해요!' : '오늘의 주인공';

  return (
    <main className="screen">
      <TopBar
        title={GAME_NAMES[round.gameId]}
        right={
          <span className="tag">
            판 {seedTag(round.seed)}
            {round.attempt > 1 && <b className="again"> 재경기 {round.attempt}회차</b>}
          </span>
        }
      />
      <div className="body">
        {replay && <p className="muted" style={{ margin: 0, textAlign: 'center' }}>기록 다시 보기예요. 새 기록으로 남지 않아요.</p>}
        <section className="ticket result-hero reveal-pop" style={{ ['--tone' as string]: slotTone(headline.slot, anyGood) }} aria-live="assertive">
          <div className="result-kicker">{title}</div>
          <div className="result-label display">{headline.slot.label}</div>
          <ul className="result-names">
            {headline.people.map((p) => (
              <li key={p.id}>
                <Avatar p={p} size={36} />
                <span className="display">{p.name}</span>
              </li>
            ))}
          </ul>
        </section>

        {rest.length > 0 && (
          <ul className="result-rest">
            {rest.map((g) => (
              <li key={g.slot.kind + g.slot.label}>
                <span className="result-rest-label" style={{ color: slotTone(g.slot, anyGood) }}>
                  {g.slot.label}
                </span>
                <span className="result-rest-people">
                  {g.people.map((p) => (
                    <span key={p.id} className="row" style={{ gap: 6 }}>
                      <span className="dot" style={{ background: p.color }} />
                      {p.name}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', margin: 0 }}>
          결과는 게임을 시작할 때 판 번호 {seedTag(round.seed)}로 정해졌어요.
        </p>
      </div>

      <div className="actions" style={{ flexWrap: 'wrap' }}>
        <button className="btn ghost small" style={{ flex: 1 }} disabled={sharing} onClick={async () => {
          setSharing(true);
          toast(await shareResult({ gameName: GAME_NAMES[round.gameId], seed: round.seed, attempt: round.attempt, participants: round.participants, results, createdAt: round.createdAt }));
          setSharing(false);
        }}>
          공유
        </button>
        <button className="btn ghost small" style={{ flex: 1 }} onClick={() => go(replay ? 'history' : 'picker')}>
          {replay ? '기록으로' : '다른 게임으로'}
        </button>
        {!replay && (
          <button className="btn primary" style={{ flexBasis: '100%' }} onClick={() => { sfx.start(); start(round.gameId); }}>
            다시 하기
          </button>
        )}
        <button className="link-btn" style={{ flexBasis: '100%' }} onClick={() => go('home')}>
          처음으로
        </button>
      </div>
    </main>
  );
}
