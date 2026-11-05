import { Toggle, TopBar } from '../components/ui';
import { useApp } from '../store/app';

export default function Settings() {
  const { settings, setSettings, groups, deleteGroup } = useApp();
  return (
    <main className="screen">
      <TopBar title="설정" back="home" />
      <div className="body">
        <div className="card">
          <Toggle label="소리" checked={settings.sound} onChange={(sound) => setSettings({ sound })} />
          <Toggle label="진동" hint="아이폰 사파리는 진동을 지원하지 않아요" checked={settings.vibration} onChange={(vibration) => setSettings({ vibration })} />
          <Toggle label="연출 빠르게" hint="애니메이션 시간을 절반으로" checked={settings.fast} onChange={(fast) => setSettings({ fast })} />
        </div>

        <section>
          <h2 className="section-title">화면 테마</h2>
          <div className="seg" role="group" aria-label="화면 테마" style={{ marginTop: 8 }}>
            {(['system', 'dark', 'light'] as const).map((t) => (
              <button key={t} aria-pressed={settings.theme === t} onClick={() => setSettings({ theme: t })}>
                {t === 'system' ? '기기 설정' : t === 'dark' ? '어둡게' : '밝게'}
              </button>
            ))}
          </div>
        </section>

        {groups.length > 0 && (
          <section>
            <h2 className="section-title">저장한 모임</h2>
            <ul className="card" style={{ listStyle: 'none', margin: '8px 0 0', padding: '4px 16px' }}>
              {groups.map((g) => (
                <li key={g.id} className="row between" style={{ minHeight: 52 }}>
                  <span>
                    <b>{g.name}</b> <span className="muted">{g.members.join(', ')}</span>
                  </span>
                  <button className="link-btn" onClick={() => deleteGroup(g.id)} aria-label={`${g.name} 모임 삭제`}>
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card muted" style={{ fontSize: 14 }}>
          <b style={{ color: 'var(--ink)' }}>공정하게 정하는 방법</b>
          <p style={{ margin: '6px 0 0' }}>
            게임을 시작하는 순간 기기의 암호학적 난수로 판 번호를 만들고, 그 번호로 결과를 먼저 정해요. 게임 화면은 정해진 결과를 보여주는 연출이라
            어떤 게임을 고르든 각자 걸릴 확률은 같아요. 카드·해적 통처럼 직접 고르는 게임은 배치를 시작 전에 정해두기 때문에 고르는 순서와 상관없이
            확률이 같아요. 10초 맞추기만 실력으로 정해져요.
          </p>
          <p style={{ margin: '6px 0 0' }}>모든 정보는 이 기기에만 저장되고 어디에도 보내지 않아요.</p>
        </section>
      </div>
    </main>
  );
}
