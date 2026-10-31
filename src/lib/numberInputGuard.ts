/**
 * Global guard so the mouse WHEEL never silently changes a number field.
 *
 * A browser `<input type="number">` increments/decrements its value when the
 * wheel is scrolled while it is focused — which repeatedly bit staff who scrolled
 * the page with a amount/qty field focused (client 2026-10-31: "mouse vechu number
 * increase/decrease pandrathu venam, naanga manual-ah type panni change pannikrom").
 * The field only reacts to the wheel while focused, so the instant a wheel event
 * lands on a focused number input we blur it: the value stays put and the page
 * scrolls normally. One listener covers every number input in the app, so new
 * ones are protected automatically. (The stepper arrows are hidden in index.css.)
 */
let installed = false;

export function installNumberInputWheelGuard(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'wheel',
    (e) => {
      const el = e.target as HTMLElement | null;
      if (
        el instanceof HTMLInputElement &&
        el.type === 'number' &&
        el === document.activeElement
      ) {
        el.blur();
      }
    },
    { passive: true, capture: true },
  );
}
