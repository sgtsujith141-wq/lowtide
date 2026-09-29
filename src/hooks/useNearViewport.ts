import { useEffect, useRef, useState } from 'react';

/**
 * True once the element comes within `margin` of the viewport, then stays
 * true. Used to render heavy, secondary content (e.g. Home's individual
 * rhythm grids) only when you scroll to it. Without IntersectionObserver the
 * content renders straight away.
 */
export function useNearViewport<T extends Element>(margin = '300px') {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, margin]);
  return { ref, near };
}
