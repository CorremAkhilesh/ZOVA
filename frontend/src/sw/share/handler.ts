import { SHARE_TTL_MS, type SharedFile, type SharedItem, type ShareStore } from './store';

/** The manifest's share_target posts here (vite.config.ts). */
export const SHARE_TARGET_PATH = '/share-target';
/** At most this many files in one share; more are left out (the page says so). */
export const SHARE_FILES_MAX = 30;
const TEXT_MAX = 4096;
const TITLE_MAX = 300;
const URL_MAX = 2048;
const NAME_MAX = 200;

/**
 * A file name safe to show and to send: no folders, no control characters, not empty, not too long.
 * The server never uses it on disk anyway (random storage keys); this is for what people see.
 */
export function safeFileName(name: string, index: number): string {
  // Both kinds of folder separator: phones send "a/b.jpg", Windows "C:\a\b.jpg".
  const base = name.split(/[/\\]/).pop() ?? '';
  const clean = base
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we strip
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .trim()
    .replace(/^\.+/, '');
  const shortened = Array.from(clean).slice(0, NAME_MAX).join('');
  return shortened || `file-${index + 1}`;
}

const field = (form: FormData, name: string, max: number) => {
  const value = form.get(name);
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, max).join('') : '';
};

/** What was shared, as stored: text fields trimmed and capped, files named safely. */
export function readShare(form: FormData, id: string, now: number): SharedItem {
  const files: SharedFile[] = form
    .getAll('files')
    .filter((value): value is File => typeof value !== 'string' && value.size > 0)
    .slice(0, SHARE_FILES_MAX)
    .map((file, index) => ({
      name: safeFileName(file.name, index),
      type: file.type || 'application/octet-stream',
      size: file.size,
      blob: file,
    }));
  return {
    id,
    createdAt: now,
    title: field(form, 'title', TITLE_MAX),
    text: field(form, 'text', TEXT_MAX),
    url: field(form, 'url', URL_MAX),
    files,
  };
}

export interface ShareDeps {
  store: ShareStore;
  now: () => number;
  randomId: () => string;
  /** This app's origin: shares only come from our own manifest's form. */
  origin: string;
}

/**
 * POST /share-target: keep what was shared and send the window to /share (303, so the page loads
 * with GET). Anything wrong (another origin, an unreadable form) goes to /share with an error, never
 * to a broken page.
 */
export async function handleShareTarget(deps: ShareDeps, request: Request): Promise<Response> {
  const to = (path: string) => Response.redirect(`${deps.origin}${path}`, 303);
  if (new URL(request.url).origin !== deps.origin || request.method !== 'POST') {
    return to('/share?error=1');
  }
  try {
    const form = await request.formData();
    const item = readShare(form, deps.randomId(), deps.now());
    await deps.store.prune(deps.now() - SHARE_TTL_MS).catch(() => undefined);
    await deps.store.put(item);
    return to(`/share?id=${encodeURIComponent(item.id)}`);
  } catch {
    return to('/share?error=1');
  }
}
