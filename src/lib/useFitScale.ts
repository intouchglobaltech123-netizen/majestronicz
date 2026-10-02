import { RefObject, useLayoutEffect, useState } from 'react';

/**
 * Scale a fixed-width document preview down to the width it is shown in (V8 /
 * INV4-14): an A4 bill laid out for ~760 px is zoomed to fit a 390 px phone
 * instead of being clipped after the RATE column. Returns the zoom (≤ 1) and
 * the style for the inner wrapper; print and PDF capture ignore it (index.css).
 */
export function useFitScale(ref: RefObject<HTMLElement | null>, active = true, designWidth = 760) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const update = () => {
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      setScale(inner > 0 ? Math.min(1, Math.round((inner / designWidth) * 1000) / 1000) : 1);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active, designWidth]);
  const style = scale < 1 ? ({ width: designWidth, zoom: scale } as React.CSSProperties) : undefined;
  return { scale, style };
}
