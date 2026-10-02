import { useEffect, useState } from 'react';

/**
 * Counts up to `target` once on arrival (v2 PHASE 013 motion): the number
 * settles instead of jumping in. Without animation support, or when reduced
 * motion is asked for, it is simply the target.
 */
export function useCountUp(target: number, ms = 700): number {
  const still =
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function' ||
    typeof requestAnimationFrame !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (still) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms, still]);
  return still ? target : value;
}
