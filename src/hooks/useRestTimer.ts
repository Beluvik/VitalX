import { useEffect, useRef, useState } from 'react';

/**
 * Rest timer.
 *
 * Deliberately clamped at 0 rather than auto-clearing, because a timer that
 * silently vanishes at the exact moment the user is waiting for it is worse
 * than one that sits on zero until dismissed.
 *
 * Uses a single chained setTimeout rather than setInterval so a backgrounded
 * app does not accumulate drift or keep firing while suspended.
 */
export function useRestTimer(defaultSeconds: number) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [total, setTotal] = useState<number>(defaultSeconds);
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    tick.current = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => {
      if (tick.current) clearTimeout(tick.current);
    };
  }, [remaining]);

  const start = (seconds: number) => {
    setTotal(seconds);
    setRemaining(seconds);
  };

  const adjust = (delta: number) =>
    setRemaining((r) => (r === null ? null : Math.max(0, r + delta)));

  const dismiss = () => setRemaining(null);

  return {
    remaining,
    total,
    active: remaining !== null && remaining > 0,
    finished: remaining === 0,
    start,
    adjust,
    dismiss,
  };
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${`${s}`.padStart(2, '0')}`;
}
