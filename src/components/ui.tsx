import { useEffect, useState, type ReactNode } from 'react';
import { useApp, type Screen } from '../store/app';

export function TopBar({ title, back, right }: { title: ReactNode; back?: Screen | (() => void); right?: ReactNode }) {
  const go = useApp((s) => s.go);
  return (
    <header className="topbar">
      {back && (
        <button className="icon-btn" aria-label="뒤로" onClick={() => (typeof back === 'function' ? back() : go(back))}>
          ‹
        </button>
      )}
      <h1 className="display">{title}</h1>
      {right}
    </header>
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange(v: number): void; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button aria-label={`${label} 줄이기`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button aria-label={`${label} 늘리기`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange(v: boolean): void; label: string; hint?: string }) {
  return (
    <label className="row between" style={{ minHeight: 52, cursor: 'pointer' }}>
      <span>
        <span style={{ fontWeight: 700 }}>{label}</span>
        {hint && <span className="muted" style={{ display: 'block', fontSize: 14 }}>{hint}</span>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

let toastSetter: ((m: string) => void) | null = null;
export function toast(message: string) {
  if (message) toastSetter?.(message);
}
export function ToastHost() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    toastSetter = (m) => setMsg(m);
    return () => {
      toastSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 2200);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

export function GameIcon({ id, size = 40 }: { id: string; size?: number }) {
  const s = { width: size, height: size };
  const stroke = 'currentColor';
  const common = { fill: 'none', stroke, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'ladder':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><path d="M10 5v30M20 5v30M30 5v30M10 12h10M20 20h10M10 27h10" /></svg>);
    case 'roulette':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><circle cx="20" cy="22" r="13" /><path d="M20 9v26M7 22h26M11 13l18 18M29 13L11 31" opacity=".5" /><path d="M20 3l3 5h-6z" fill={stroke} /></svg>);
    case 'marble':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><circle cx="12" cy="10" r="4" /><circle cx="26" cy="18" r="4" /><circle cx="16" cy="30" r="4" /><path d="M6 20l10 4M34 26l-10 6" opacity=".6" /></svg>);
    case 'cards':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><rect x="6" y="9" width="16" height="24" rx="3" /><rect x="18" y="6" width="16" height="24" rx="3" transform="rotate(10 26 18)" /></svg>);
    case 'bomb':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><circle cx="18" cy="24" r="11" /><path d="M25 15l4-4M29 11c2-3 5-2 6 0" /><path d="M33 6l1 2M36 9l2 0" /></svg>);
    case 'finger':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><circle cx="12" cy="14" r="6" /><circle cx="28" cy="12" r="6" /><circle cx="20" cy="28" r="7" strokeWidth="3.4" /></svg>);
    case 'horse':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><path d="M4 12h32M4 22h32M4 32h32" opacity=".4" /><circle cx="28" cy="12" r="3" fill={stroke} /><circle cx="18" cy="22" r="3" fill={stroke} /><circle cx="24" cy="32" r="3" fill={stroke} /><path d="M35 6v30" strokeDasharray="2 3" /></svg>);
    case 'scratch':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><rect x="5" y="9" width="30" height="22" rx="3" /><path d="M10 24c4-6 6 2 10-4s6 2 10-4" /></svg>);
    case 'pirate':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><path d="M9 18h22l-2 17H11z" /><circle cx="20" cy="11" r="5" /><path d="M14 24h2M20 24h2M26 24h-1M16 30h2M24 30h2" /></svg>);
    case 'stopwatch':
      return (<svg viewBox="0 0 40 40" style={s} {...common}><circle cx="20" cy="23" r="13" /><path d="M20 23V15M17 5h6M20 5v5" /></svg>);
    default:
      return (<svg viewBox="0 0 40 40" style={s} {...common}><circle cx="20" cy="20" r="14" /></svg>);
  }
}
