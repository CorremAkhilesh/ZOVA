import { type RefObject, useEffect, useLayoutEffect } from 'react';

/** The composer grows to this many lines, then scrolls inside. */
export const COMPOSER_MAX_LINES = 6;

const px = (value: string) => Number.parseFloat(value) || 0;

/**
 * Sizes a textarea to its text, from one line up to `maxLines`, and shows a scrollbar only past that.
 * The borders count: leaving them out (as `height = scrollHeight` does) makes even one line overflow
 * by a pixel or two, which Windows shows as a scrollbar with ▲▼ arrows.
 */
export function fitTextarea(element: HTMLTextAreaElement, maxLines = COMPOSER_MAX_LINES): void {
  const style = getComputedStyle(element);
  const lineHeight = px(style.lineHeight) || px(style.fontSize) * 1.4;
  const padding = px(style.paddingTop) + px(style.paddingBottom);
  const borders = px(style.borderTopWidth) + px(style.borderBottomWidth);
  const max = Math.ceil(lineHeight * maxLines + padding + borders);
  element.style.height = 'auto';
  const wanted = Math.ceil(element.scrollHeight + borders);
  element.style.height = `${Math.min(wanted, max)}px`;
  element.style.overflowY = wanted > max ? 'auto' : 'hidden';
}

/**
 * Keeps `ref`'s height fitted to `value`, and again whenever its width changes: measured while the
 * chat was still opening (a narrow or hidden field), the empty field used to stay ~170 px tall.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` changes what is measured
  useLayoutEffect(() => {
    if (ref.current) fitTextarea(ref.current);
  }, [ref, value]);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fitTextarea(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}
