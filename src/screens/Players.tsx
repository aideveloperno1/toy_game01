import { useState } from 'react';
import { Dialog, TopBar, toast } from '../components/ui';
import { MAX_PLAYERS, useApp } from '../store/app';

export default function Players() {
  const { players, addPlayers, removePlayer, toggleExcluded, go, saveGroup, groups, groupId, setPlayers } = useApp();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const group = groups.find((g) => g.id === groupId);
  const [groupName, setGroupName] = useState(group?.name ?? '');
  const active = players.filter((p) => !p.excluded);

  const add = () => {
    const names = text.split(/[,\n、·]+/);
    if (!names.some((n) => n.trim())) return;
    const before = players.length;
    addPlayers(names);
    setText('');
    const after = useApp.getState().players.length;
    if (after - before < names.filter((n) => n.trim()).length && after >= MAX_PLAYERS) toast(`최대 ${MAX_PLAYERS}명까지 넣을 수 있어요`);
  };

  return (
    <main className="screen">
      <TopBar title="누가 참가하나요?" back="home" />
      <div className="body">
        <div className="row" style={{ alignItems: 'stretch' }}>
          <textarea
            className="field"
            rows={2}
            placeholder="이름을 쉼표나 줄바꿈으로 구분해서 입력"
            aria-label="참가자 이름"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                add();
              }
            }}
          />
          <button className="btn primary small" style={{ minHeight: 'auto' }} onClick={add} disabled={!text.trim()}>
            추가
          </button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          이름은 8자까지. 이름을 누르면 이번 판에서만 빠져요.
        </p>

        {players.length > 0 ? (
          <>
            <div className="row between">
              <h2 className="section-title" style={{ margin: 0 }}>
                참가 {active.length}명{players.length !== active.length && ` (빠짐 ${players.length - active.length})`}
              </h2>
              <button className="link-btn" onClick={() => setPlayers([])}>
                모두 지우기
              </button>
            </div>
            <div className="chips">
              {players.map((p) => (
                <span key={p.id} className={'chip' + (p.excluded ? ' off' : '')}>
                  <button
                    style={{ border: 0, background: 'none', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
                    aria-pressed={!p.excluded}
                    aria-label={`${p.name} ${p.excluded ? '빠짐, 눌러서 다시 넣기' : '참가 중, 눌러서 이번 판에서 빼기'}`}
                    onClick={() => toggleExcluded(p.id)}
                  >
                    <span className="dot" style={{ background: p.color }} />
                    {p.name}
                  </button>
                  <button className="x" aria-label={`${p.name} 삭제`} onClick={() => removePlayer(p.id)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setSaving(true)}>
              {group ? `'${group.name}' 모임에 저장` : '이 멤버를 모임으로 저장'}
            </button>
          </>
        ) : (
          <div className="card muted" style={{ textAlign: 'center' }}>
            참가자를 2명 이상 넣으면 다음으로 넘어갈 수 있어요.
          </div>
        )}
      </div>

      <div className="actions">
        <button className="btn primary" disabled={active.length < 2} onClick={() => go('outcome')}>
          다음: 결과 정하기
        </button>
      </div>

      {saving && (
        <Dialog title="모임 저장" onClose={() => setSaving(false)}>
          <input
            className="field"
            autoFocus
            maxLength={16}
            placeholder="예: 회사 점심팟"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <div className="row">
            <button className="btn ghost" onClick={() => setSaving(false)}>
              취소
            </button>
            <button
              className="btn primary"
              disabled={!groupName.trim()}
              onClick={() => {
                saveGroup(groupName);
                setSaving(false);
                toast('모임을 저장했어요');
              }}
            >
              저장
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
