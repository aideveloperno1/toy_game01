import { useMemo, useState } from 'react';
import { configSummary, groupResults } from '../core/draw';
import { seedTag } from '../core/rng';
import { Dialog, TopBar } from '../components/ui';
import { slotTone } from '../games/_kit/kit';
import { GAME_NAMES, gameById } from '../games/registry';
import { useApp } from '../store/app';
import type { GameId } from '../core/types';

const fmt = (t: number) =>
  new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function History() {
  const { history, groups, replayEntry, clearHistory } = useApp();
  const [tab, setTab] = useState<'list' | 'stats'>('list');
  const [confirm, setConfirm] = useState(false);

  /** 모임별로 벌칙(꽝·벌칙 항목)을 받은 횟수 */
  const stats = useMemo(() => {
    const out: { groupName: string; rows: { name: string; count: number; played: number }[] }[] = [];
    const byGroup = new Map<string, typeof history>();
    for (const h of history) {
      if (!h.groupId || h.instant) continue;
      if (!byGroup.has(h.groupId)) byGroup.set(h.groupId, []);
      byGroup.get(h.groupId)!.push(h);
    }
    for (const [gid, entries] of byGroup) {
      const g = groups.find((x) => x.id === gid);
      const tally = new Map<string, { count: number; played: number }>();
      for (const e of entries) {
        for (const p of e.participants) {
          const t = tally.get(p.name) ?? { count: 0, played: 0 };
          t.played++;
          const s = e.results[p.id];
          if (s && s.kind === 'hit' && !s.good) t.count++;
          tally.set(p.name, t);
        }
      }
      out.push({
        groupName: g?.name ?? '삭제된 모임',
        rows: [...tally].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      });
    }
    return out;
  }, [history, groups]);

  return (
    <main className="screen">
      <TopBar title="기록" back="home" />
      <div className="body">
        <div className="seg" role="group" aria-label="보기">
          <button aria-pressed={tab === 'list'} onClick={() => setTab('list')}>
            최근 판
          </button>
          <button aria-pressed={tab === 'stats'} onClick={() => setTab('stats')}>
            모임별 벌칙 횟수
          </button>
        </div>

        {tab === 'list' &&
          (history.length === 0 ? (
            <div className="card muted" style={{ textAlign: 'center' }}>
              아직 기록이 없어요. 한 판 하면 여기에 최근 50판까지 남아요.
            </div>
          ) : (
            <ul className="history-list">
              {history.map((h) => {
                const gname = GAME_NAMES[h.gameId as GameId];
                if (h.instant) {
                  return (
                    <li key={h.id} className="card">
                      <div className="row between">
                        <b>{gname}</b>
                        <span className="muted">{fmt(h.createdAt)}</span>
                      </div>
                      <div className="muted">
                        {h.instant.total}명 중 {h.instant.picked}명 선택 (이름 없이 진행)
                      </div>
                    </li>
                  );
                }
                const grouped = groupResults(h.results, h.participants).filter((g) => g.slot.kind !== 'pass');
                const anyGood = grouped.some((g) => g.slot.good);
                const def = gameById(h.gameId);
                return (
                  <li key={h.id} className="card">
                    <div className="row between">
                      <b>
                        {gname} <span className="muted" style={{ fontWeight: 500 }}>{seedTag(h.seed)}</span>
                      </b>
                      <span className="muted">{fmt(h.createdAt)}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {configSummary(h.config, h.participants.length)}
                      {h.attempt > 1 && ` · 재경기 ${h.attempt}회차`}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      {grouped.slice(0, h.config.mode === 'rank' ? 3 : 8).map((g) => (
                        <div key={g.slot.label}>
                          <span style={{ color: slotTone(g.slot, anyGood), fontWeight: 700 }}>{g.slot.label}</span>{' '}
                          {g.people.map((p) => p.name).join(', ')}
                        </div>
                      ))}
                    </div>
                    {def?.replayable && (
                      <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => replayEntry(h.id)}>
                        같은 판 다시 보기
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ))}

        {tab === 'stats' &&
          (stats.length === 0 ? (
            <div className="card muted" style={{ textAlign: 'center' }}>
              모임을 저장해서 게임하면 누가 몇 번 벌칙을 받았는지 모아서 보여드려요.
            </div>
          ) : (
            stats.map((s) => (
              <section key={s.groupName} className="card">
                <h2 className="display" style={{ margin: '0 0 8px', fontSize: 20 }}>
                  {s.groupName}
                </h2>
                <ul className="stat-list">
                  {s.rows.map((r) => {
                    const max = Math.max(1, ...s.rows.map((x) => x.count));
                    return (
                      <li key={r.name}>
                        <span className="stat-name">{r.name}</span>
                        <span className="stat-bar" aria-hidden>
                          <i style={{ width: `${(r.count / max) * 100}%` }} />
                        </span>
                        <span className="stat-num">
                          {r.count}
                          <span className="muted">/{r.played}판</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          ))}

        {history.length > 0 && (
          <button className="link-btn" onClick={() => setConfirm(true)}>
            기록 모두 지우기
          </button>
        )}
      </div>
      {confirm && (
        <Dialog title="기록을 모두 지울까요?" onClose={() => setConfirm(false)}>
          <p className="muted" style={{ margin: 0 }}>
            저장한 모임은 그대로 남아요.
          </p>
          <div className="row">
            <button className="btn ghost" onClick={() => setConfirm(false)}>
              취소
            </button>
            <button className="btn primary" onClick={() => { clearHistory(); setConfirm(false); }}>
              지우기
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
