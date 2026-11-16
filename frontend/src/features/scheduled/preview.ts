import { formatDuration, type MediaInfo } from '@zuvo/protocol';
import { previewText } from '@/features/chats/view';
import { i18n } from '@/lib/i18n';

type MediaLike = Pick<MediaInfo, 'kind' | 'name'> & { duration?: number | null | undefined };

/**
 * One scheduled file in a line, like the chat list shows it: "📷 caption", "🎥 Video",
 * "📄 report.pdf · caption", "🎤 Voice message (0:12)".
 */
export function mediaLine(media: MediaLike, caption: string | null): string {
  const labels = {
    photo: i18n.t('media.photo'),
    video: i18n.t('media.video'),
    voice: i18n.t('voice.preview'),
  };
  const named = media.kind === 'document' || media.kind === 'audio';
  const preview =
    media.kind === 'voice'
      ? formatDuration(media.duration ?? 0)
      : named
        ? media.name
        : (caption ?? '');
  const line = previewText({ type: media.kind, preview }, labels);
  return named && caption ? `${line} · ${caption}` : line;
}

/** What a scheduled message says, in a line: its text, or its file and caption. */
export function scheduledPreview(item: { text: string | null; media: MediaLike | null }): string {
  return item.media ? mediaLine(item.media, item.text) : (item.text ?? '');
}
