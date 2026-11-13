/** A tab hidden this long counts as away: others see me as offline. See docs/protocol.md. */
export const AWAY_AFTER_MS = 60_000;

/** Reports when this tab has been hidden for a while, and when it comes back. */
export function trackAway(report: (active: boolean) => void) {
  let away = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (active: boolean) => {
    away = !active;
    report(active);
  };
  const onVisibility = () => {
    clearTimeout(timer);
    if (document.visibilityState === 'hidden') timer = setTimeout(() => set(false), AWAY_AFTER_MS);
    else if (away) set(true);
  };
  document.addEventListener('visibilitychange', onVisibility);
  return {
    /** A new connection starts out active, so an away tab has to say so again. */
    reconnected() {
      if (away) report(false);
    },
    stop() {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
