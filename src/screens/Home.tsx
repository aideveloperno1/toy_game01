import { unlockAudio, sfx } from '../lib/sound';
import { useApp } from '../store/app';
import { configSummary } from '../core/draw';

export default function Home() {
  const { go, groups, players, loadGroup, config } = useApp();
  const active = players.filter((p) => !p.excluded);
  const sorted = [...groups].sort((a, b) => b.updatedAt - a.updatedAt);

  const tap = (fn: () => void) => () => {
    unlockAudio();
    sfx.tap();
    fn();
  };

  return (
    <main className="screen home">
      <header className="home-head">
        <div className="home-mark display" aria-label="복불복">
          <span>복</span>
          <span>불</span>
          <span>복</span>
        </div>
        <p className="home-sub">오늘 계산은 누가 할까요?</p>
      </header>

      <div className="body">
        <a className="ticket home-start" href="/online?mode=create"><span className="display">각자 폰으로 하기</span><span className="home-start-sub">방 만들기 → 친구 초대 → 함께 게임</span></a>
        <a className="btn ghost" href="/online">방 코드로 참가하기</a>
        <button className="ticket home-start" onClick={tap(() => go('players'))}>
          <span className="display">한 기기로 하기</span>
          <span className="home-start-sub">이름 입력 → 결과 정하기 → 게임 고르기</span>
        </button>

        {active.length >= 2 && (
          <button className="btn ghost" style={{ flex: 'none', justifyContent: 'space-between' }} onClick={tap(() => go('picker'))}>
            <span>지난 멤버로 바로 하기</span>
            <span className="muted" style={{ fontWeight: 600, fontSize: 15 }}>
              {configSummary(config, active.length)}
            </span>
          </button>
        )}

        {sorted.length > 0 && (
          <section>
            <h2 className="section-title">저장한 모임</h2>
            <div className="chips" style={{ marginTop: 8 }}>
              {sorted.map((g) => (
                <button
                  key={g.id}
                  className="chip"
                  onClick={tap(() => {
                    loadGroup(g.id);
                    go('picker');
                  })}
                >
                  {g.name}
                  <span className="muted" style={{ fontWeight: 500 }}>
                    {g.members.length}명
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <button className="home-instant" onClick={tap(() => go('instant'))}>
          <span className="home-instant-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>
            <b>손가락 터치 뽑기</b>
            <span className="muted">이름 없이 바로. 다 같이 화면에 손가락을 올려요</span>
          </span>
        </button>
      </div>

      <nav className="home-foot">
        <button className="link-btn" onClick={tap(() => go('history'))}>
          기록
        </button>
        <button className="link-btn" onClick={tap(() => go('settings'))}>
          설정
        </button>
      </nav>
    </main>
  );
}
