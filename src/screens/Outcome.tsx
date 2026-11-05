import { buildSlots, PASS_LABEL, validateConfig } from '../core/draw';
import type { OutcomeConfig, OutcomeItem } from '../core/types';
import { Stepper, TopBar } from '../components/ui';
import { activePlayers, useApp } from '../store/app';

export default function Outcome() {
  const { config, setConfig, go, recentLabels } = useApp();
  const n = useApp((s) => activePlayers(s).length);
  const error = validateConfig(config, n);

  const setMode = (mode: OutcomeConfig['mode']) => {
    if (mode === config.mode) return;
    if (mode === 'loser') setConfig({ mode, count: 1, label: '꽝', good: false });
    else if (mode === 'items') setConfig({ mode, good: false, items: [{ label: '밥값', count: 1 }, { label: '커피', count: 1 }] });
    else setConfig({ mode: 'rank' });
  };

  const slots = error ? [] : buildSlots(config, n);
  const preview = slots.reduce<Record<string, number>>((acc, s) => ((acc[s.label] = (acc[s.label] ?? 0) + 1), acc), {});

  return (
    <main className="screen">
      <TopBar title="무엇을 정할까요?" back="players" />
      <div className="body">
        <div className="seg" role="group" aria-label="결과 방식">
          <button aria-pressed={config.mode === 'loser'} onClick={() => setMode('loser')}>
            꽝 / 당첨
          </button>
          <button aria-pressed={config.mode === 'items'} onClick={() => setMode('items')}>
            항목 나누기
          </button>
          <button aria-pressed={config.mode === 'rank'} onClick={() => setMode('rank')}>
            전체 순위
          </button>
        </div>

        {config.mode === 'loser' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="row between">
              <label htmlFor="label" style={{ fontWeight: 700 }}>
                결과 이름
              </label>
              <GoodToggle good={config.good} onChange={(good) => setConfig({ ...config, good, label: config.label === '꽝' && good ? '당첨' : config.label === '당첨' && !good ? '꽝' : config.label })} />
            </div>
            <input id="label" className="field" maxLength={12} value={config.label} onChange={(e) => setConfig({ ...config, label: e.target.value })} />
            <div className="chips">
              {recentLabels.slice(0, 5).map((l) => (
                <button key={l} className={'chip' + (l === config.label ? ' on' : '')} onClick={() => setConfig({ ...config, label: l })}>
                  {l}
                </button>
              ))}
            </div>
            <div className="row between">
              <span style={{ fontWeight: 700 }}>몇 명?</span>
              <Stepper label="인원" value={config.count} min={1} max={Math.max(1, n - 1)} onChange={(count) => setConfig({ ...config, count })} />
            </div>
          </div>
        )}

        {config.mode === 'items' && <ItemsEditor config={config} n={n} onChange={setConfig} />}

        {config.mode === 'rank' && (
          <div className="card muted">1등부터 {n}등까지 모두 순위를 정해요. 발표 순서, 노래방 순서를 정할 때 좋아요.</div>
        )}

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <section aria-label="결과 미리보기">
            <h2 className="section-title">이렇게 나눠요</h2>
            <div className="chips" style={{ marginTop: 8 }}>
              {Object.entries(preview).map(([label, count]) => (
                <span key={label} className="chip" style={{ borderStyle: label === PASS_LABEL ? 'dashed' : 'solid' }}>
                  {label}
                  {count > 1 && <span className="muted">×{count}</span>}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
      <div className="actions">
        <button className="btn primary" disabled={!!error} onClick={() => go('picker')}>
          다음: 게임 고르기
        </button>
      </div>
    </main>
  );
}

function GoodToggle({ good, onChange }: { good: boolean; onChange(g: boolean): void }) {
  return (
    <div className="seg" style={{ padding: 3 }} role="group" aria-label="결과 성격">
      <button style={{ minHeight: 34, padding: '0 10px' }} aria-pressed={!good} onClick={() => onChange(false)}>
        벌칙
      </button>
      <button style={{ minHeight: 34, padding: '0 10px' }} aria-pressed={good} onClick={() => onChange(true)}>
        좋은 결과
      </button>
    </div>
  );
}

function ItemsEditor({ config, n, onChange }: { config: Extract<OutcomeConfig, { mode: 'items' }>; n: number; onChange(c: OutcomeConfig): void }) {
  const total = config.items.reduce((s, i) => s + i.count, 0);
  const update = (idx: number, patch: Partial<OutcomeItem>) =>
    onChange({ ...config, items: config.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row between">
        <span style={{ fontWeight: 700 }}>항목</span>
        <GoodToggle good={config.good} onChange={(good) => onChange({ ...config, good })} />
      </div>
      {config.items.map((it, i) => (
        <div key={i} className="row" style={{ gap: 8 }}>
          <input
            className="field"
            style={{ flex: 1, minWidth: 0 }}
            maxLength={12}
            aria-label={`${i + 1}번째 항목 이름`}
            value={it.label}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <Stepper label={`${it.label || '항목'} 개수`} value={it.count} min={1} max={Math.max(1, n - (total - it.count))} onChange={(count) => update(i, { count })} />
          <button className="icon-btn" aria-label={`${it.label} 항목 삭제`} disabled={config.items.length <= 1} onClick={() => onChange({ ...config, items: config.items.filter((_, j) => j !== i) })}>
            ×
          </button>
        </div>
      ))}
      <button className="btn ghost small" disabled={total >= n || config.items.length >= 8} onClick={() => onChange({ ...config, items: [...config.items, { label: '', count: 1 }] })}>
        항목 추가
      </button>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {config.good ? '맨 위 항목이 가장 좋은 결과예요.' : '맨 위 항목이 가장 큰 벌칙이에요.'} 남는 {Math.max(0, n - total)}명은 통과.
      </p>
    </div>
  );
}
