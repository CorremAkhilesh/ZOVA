// Runs before the app bundle: applies the saved theme and accent before first paint (no flash of
// the wrong theme), and sets Zod to jitless (below). A classic, render-blocking file rather than an
// inline script: the CSP allows no inline scripts (shared/config/src/security-headers.ts).
(() => {
  let dark = false;
  try {
    const saved = JSON.parse(localStorage.getItem('zuvo-theme') || '{}');
    const mode = saved.state?.mode || 'system';
    dark =
      mode === 'dark' ||
      (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    // Storage blocked: fall back to light.
  }
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // The accent this device used last (features/appearance/accent.ts).
  try {
    const accent = localStorage.getItem('zuvo-accent');
    if (accent && /^[a-z]+$/.test(accent)) document.documentElement.dataset.accent = accent;
  } catch {
    // Storage blocked: the default accent.
  }
})();

// Zod probes for eval (`new Function('')`) the first time a z.object() is built, to compile fast
// parsers. The CSP forbids eval, so the probe would only cause a CSP violation report. Zod reads its
// global config from here when it loads, so this must run before the app bundle (it does: this
// file is render-blocking, the bundle is a deferred module). Same as `z.config({ jitless: true })`.
globalThis.__zod_globalConfig = { ...globalThis.__zod_globalConfig, jitless: true };
