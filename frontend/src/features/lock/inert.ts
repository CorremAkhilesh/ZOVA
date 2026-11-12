import { useEffect } from 'react';

/** The lock screen's own layer: everything else in <body> goes inert while it shows. */
export const LOCK_LAYER_ATTR = 'data-lock-layer';

function makeInert(element: Element, touched: Set<Element>) {
  if (element.hasAttribute(LOCK_LAYER_ATTR) || element.hasAttribute('inert')) return;
  if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') return;
  element.setAttribute('inert', '');
  touched.add(element);
}

/**
 * While `active`, nothing behind the lock can be focused, clicked or read by a screen reader,
 * including dialogs and menus that open later in their own portals.
 */
export function useInertBackground(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const touched = new Set<Element>();
    for (const child of Array.from(document.body.children)) makeInert(child, touched);
    const observer = new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of Array.from(change.addedNodes)) {
          if (node instanceof Element && node.parentElement === document.body) {
            makeInert(node, touched);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      for (const element of touched) element.removeAttribute('inert');
    };
  }, [active]);
}
