import { kindOf } from '@/features/media/process';

/**
 * One photo or video, sent as itself (not as a document), to someone else: never an album, a
 * document, a voice note, or Saved Messages.
 */
export function offersViewOnce(input: {
  files: Array<{ type: string }>;
  asDocument: boolean;
  allowed: boolean;
}): boolean {
  const [only] = input.files;
  if (!input.allowed || input.asDocument || input.files.length !== 1 || !only) return false;
  const kind = kindOf(only);
  return kind === 'image' || kind === 'video';
}
