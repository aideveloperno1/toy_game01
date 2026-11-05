import { useEffect, useRef, useState } from 'react';
import { configSummary, validateConfig } from '../core/draw';
import { cryptoInt } from '../core/rng';
import type { GameId } from '../core/types';
import { Dialog, GameIcon, TopBar } from '../components/ui';
import { GAMES, unavailableReason, type GameKind } from '../games/registry';
import { sfx, unlockAudio } from '../lib/sound';
import { activePlayers, useApp } from '../store/app';

const KIND_LABEL: Record<GameKind, string> = { watch: '같이 보기', play: '돌아가며', skill: '실력' };

export default function Picker() {
  const { config, go, start } = useApp();
  const n = useApp((s) => activePlayers(s).length);
  const [spinning, setSpinning] = useState<GameId | null>(null);
  const [skillConfirm, setSkillConfirm] = useState(false);
  const timer = useRef<number>(0);
  const error = validateConfig(config, n);

  useEffect(() => () => clearTimeout(timer.current), []);

  const available = GAMES.filter((g) => !unavailableReason(g, n) && g.modes.includes(config.mode) && g.kind !== 'skill');

  const choose = (id: GameId) => {
    unlockAudio();
    if (id === 'stopwatch') {
      setSkillConfirm(true);
      return;
    }
    sfx.start();
    start(id);
  };

  /** 랜덤 게임: 하이라이트가 돌다가 하나에 멈춘다 */
  const randomPick = () => {
    if (!available.length || spinning) return;
    unlockAudio();
    const target = cryptoInt(available.length);
    const steps = available.length * 2 + target + 1;
    let i = 0;
    const tick = () => {
      const g = available[i % available.length];
      setSpinning(g.id);
      sfx.tick();
      i++;
      if (i < steps) {
        timer.current = window.setTimeout(tick, 60 + (i / steps) ** 3 * 320);
      } else {
        timer.current = window.setTimeout(() => {
          setSpinning(null);
          choose(g.id);
        }, 650);
      }
    };
    tick();
  };

  if (error) {
    return (
      <main className="screen">
        <TopBar title="게임 고르기" back="outcome" />
        <div className="card">
          <p className="error">{error}</p>
          <button className="btn primary" style={{ marginTop: 12, width: '100%' }} onClick={() => go(n < 2 ? 'players' : 'outcome')}>
            설정 고치기
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen">
      <TopBar title="어떤 게임으로?" back="outcome" />
      <div className="body">
        <div className="row between picker-summary">
          <button className="link-btn" style={{ padding: 0, textAlign: 'left' }} onClick={() => go('players')}>
            {configSummary(config, n)}
          </button>
          <button className="link-btn" style={{ padding: 0 }} onClick={() => go('outcome')}>
            결과 바꾸기
          </button>
        </div>

        <button className="btn ghost random-btn" onClick={randomPick} disabled={!!spinning || available.length === 0}>
          {spinning ? '고르는 중…' : '게임도 운에 맡기기'}
        </button>

        <ul className="game-grid">
          {GAMES.map((g) => {
            const reason = unavailableReason(g, n);
            const lit = spinning === g.id;
            return (
              <li key={g.id}>
                <button
                  className={'ticket v game-ticket' + (lit ? ' lit' : '') + (g.kind === 'skill' ? ' skill' : '')}
                  disabled={!!reason || !!spinning}
                  onClick={() => choose(g.id)}
                  aria-label={`${g.name}. ${g.blurb}. ${reason ?? ''}`}
                >
                  <span className="game-ticket-top">
                    <GameIcon id={g.id} size={36} />
                    <span className="kind">{KIND_LABEL[g.kind]}</span>
                  </span>
                  <span className="game-ticket-name display">{g.name}</span>
                  <span className="game-ticket-blurb">{reason ? `인원이 맞지 않아요 (${reason})` : g.blurb}</span>
                  <span className="game-ticket-time">{g.time}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {skillConfirm && (
        <Dialog title="실력으로 정하는 게임이에요" onClose={() => setSkillConfirm(false)}>
          <p style={{ margin: 0 }}>10초 맞추기는 운이 아니라 각자의 감으로 결과가 정해져요. 10초에서 가장 많이 벗어난 사람부터 결과를 받아요.</p>
          <div className="row">
            <button className="btn ghost" onClick={() => setSkillConfirm(false)}>
              다른 게임
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setSkillConfirm(false);
                sfx.start();
                start('stopwatch');
              }}
            >
              이걸로 하기
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
