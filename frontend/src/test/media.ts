/** Controllable `window.matchMedia` for jsdom: viewport width and OS color scheme. */
type Listener = (event: { matches: boolean; media: string }) => void;

const state = { width: 1280, prefersDark: false };
/** Each listener with the query it was registered for. */
const listeners = new Map<Listener, string>();

function evaluate(query: string): boolean {
  const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (minWidth?.[1]) return state.width >= Number(minWidth[1]);
  const maxWidth = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (maxWidth?.[1]) return state.width <= Number(maxWidth[1]);
  if (query.includes('prefers-color-scheme: dark')) return state.prefersDark;
  return false;
}

export function installMatchMedia() {
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return evaluate(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => listeners.set(listener, query),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      addListener: (listener: Listener) => listeners.set(listener, query),
      removeListener: (listener: Listener) => listeners.delete(listener),
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
}

function notify() {
  for (const [listener, query] of [...listeners])
    listener({ matches: evaluate(query), media: query });
}

export function setViewportWidth(width: number) {
  state.width = width;
  notify();
}

export function setSystemDark(prefersDark: boolean) {
  state.prefersDark = prefersDark;
  notify();
}

export function resetMedia() {
  state.width = 1280;
  state.prefersDark = false;
  listeners.clear();
}
