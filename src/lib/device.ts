import { useEffect } from 'react';
import { useApp } from '../store/app';

/** 진동. iOS 사파리처럼 지원하지 않는 기기에서는 조용히 넘어간다. */
export function vibrate(pattern: number | number[]) {
  if (!useApp.getState().settings.vibration) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 미지원 */
  }
}

/** 게임 중 화면 꺼짐 방지 */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock.release();
      } catch {
        /* 배터리 절약 모드 등에서 거부될 수 있음 */
      }
    };
    void acquire();
    const onVis = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 연출 속도 배율: "빠르게"는 절반 시간 */
export function speedFactor(): number {
  return useApp.getState().settings.fast ? 0.5 : 1;
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * speedFactor()));
