import { type RefObject, useCallback, useEffect, useRef } from 'react';

/** A scroll this soon after the reader's own wheel, touch, key or pointer counts as theirs. */
const INTENT_MS = 1000;
const INTENT_EVENTS = ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown'] as const;

/**
 * Keeps a scroller at its end while `stick` is on, whatever changes size after the first paint:
 * rows measured late, a picture, the composer growing, the phone keyboard opening.
 *
 * Only the reader unpins it. A scroll event is theirs when it follows their own input, or when it
 * moved up: a layout change only ever pushes the end further down, and a scroll event it causes
 * (the browser clamping, the virtualizer correcting) must not be taken for the reader leaving.
 */
export function useBottomPin(
  viewport: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  stick: RefObject<boolean>,
) {
  const lastIntent = useRef(Number.NEGATIVE_INFINITY);
  const lastTop = useRef(0);

  const pin = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    lastTop.current = element.scrollTop;
  }, [viewport]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const intent = () => {
      lastIntent.current = performance.now();
    };
    for (const name of INTENT_EVENTS) element.addEventListener(name, intent, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (stick.current) pin();
          });
    observer?.observe(element);
    if (content.current) observer?.observe(content.current);
    return () => {
      for (const name of INTENT_EVENTS) element.removeEventListener(name, intent);
      observer?.disconnect();
    };
  }, [viewport, content, stick, pin]);

  /** Call once per scroll event: whether the reader moved the list. */
  const byReader = useCallback((element: HTMLElement) => {
    const movedUp = element.scrollTop < lastTop.current - 1;
    lastTop.current = element.scrollTop;
    return movedUp || performance.now() - lastIntent.current < INTENT_MS;
  }, []);

  return { pin, byReader };
}
