import { useCallback, useRef, type ReactNode } from 'react';
import type { Participant, Slot } from '../../core/types';
import { sfx } from '../../lib/sound';

/** 결과 칸의 색: 꽝은 산호색, 좋은 결과는 등불색, 통과는 민트(벌칙 모드) 또는 회색(당첨 모드) */
export function slotTone(slot: Slot, anyGood = false): string {
  if (slot.kind === 'rank') return slot.rank === 1 ? 'var(--lantern)' : 'var(--ink-2)';
  if (slot.kind === 'pass') return anyGood ? 'var(--ink-3)' : 'var(--mint)';
  return slot.good ? 'var(--lantern)' : 'var(--coral)';
}

export function Avatar({ p, size = 28 }: { p: Pick<Participant, 'name' | 'color'>; size?: number }) {
  return (
    <span className="avatar" style={{ background: p.color, width: size, height: size, fontSize: size * 0.46 }} aria-hidden>
      {p.name.slice(0, 1)}
    </span>
  );
}

/** 300ms 안의 두 번째 탭은 무시한다 (폰을 넘기다 두 번 눌리는 사고 방지) */
export function useTapGuard(ms = 300) {
  const last = useRef(0);
  return useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        const now = performance.now();
        if (now - last.current < ms) return;
        last.current = now;
        fn(...args);
      },
    [ms],
  );
}

/** 차례 넘기기 화면: "폰을 민수에게 넘기세요" */
export function TurnHandoff({ player, note, onReady }: { player: Participant; note?: ReactNode; onReady(): void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`${player.name} 차례`}>
      <button
        className="dialog"
        style={{ border: 0, alignItems: 'center', textAlign: 'center', padding: '32px 20px' }}
        onClick={() => {
          sfx.tap();
          onReady();
        }}
        autoFocus
      >
        <Avatar p={player} size={64} />
        <div className="display" style={{ fontSize: 30 }}>
          {player.name} 차례
        </div>
        <div className="muted">{note ?? '폰을 넘겨받았으면 화면을 탭하세요'}</div>
      </button>
    </div>
  );
}

export function TurnBanner({ player, suffix = '차례' }: { player?: Participant; suffix?: string }) {
  if (!player) return <div className="turn-banner" />;
  return (
    <div className="turn-banner" aria-live="polite">
      <span className="who" style={{ color: player.color }}>
        {player.name}
      </span>{' '}
      {suffix}
    </div>
  );
}

/** 결과가 이미 정해진 게임에서 연출을 건너뛴다 */
export function SkipButton({ onSkip, label = '건너뛰고 결과 보기' }: { onSkip(): void; label?: string }) {
  return (
    <button className="link-btn" onClick={onSkip} style={{ alignSelf: 'center' }}>
      {label}
    </button>
  );
}

export function byId(ps: Participant[]) {
  return Object.fromEntries(ps.map((p) => [p.id, p])) as Record<string, Participant>;
}
