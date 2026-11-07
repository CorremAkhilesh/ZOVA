import { type LinkPreview, linkPreviewImageUrl } from '@zuvo/protocol';
import { Globe, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Only web pages: the server already checked, and this checks again. */
const isWeb = (url: string) => /^https?:\/\//i.test(url);

function PreviewBody({ preview }: { preview: LinkPreview }) {
  const { image } = preview;
  return (
    <>
      {image ? (
        <img
          src={linkPreviewImageUrl(image.id)}
          alt=""
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
          className="max-h-48 w-full bg-black/5 object-cover"
        />
      ) : null}
      <span className="block space-y-0.5 px-3 py-2">
        <span className="flex items-center gap-1 text-xs opacity-75">
          <Globe className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{preview.siteName}</span>
        </span>
        {preview.title ? (
          <span className="line-clamp-2 block font-semibold">{preview.title}</span>
        ) : null}
        {preview.description ? (
          <span className="line-clamp-2 block text-sm opacity-85">{preview.description}</span>
        ) : null}
      </span>
    </>
  );
}

/** In a bubble: the page's card, opening the page in a new tab. Our server served the picture. */
export function LinkPreviewCard({ preview, mine }: { preview: LinkPreview; mine: boolean }) {
  const { t } = useTranslation();
  const className = cn(
    'mb-1 block overflow-hidden rounded-lg border-l-4 text-left',
    mine ? 'border-white/60 bg-black/10' : 'border-brand bg-black/5 dark:bg-white/5',
  );
  if (!isWeb(preview.url)) return null;
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={t('linkPreview.open', { site: preview.siteName, title: preview.title ?? '' })}
      className={cn(className, 'hover:opacity-90')}
    >
      <PreviewBody preview={preview} />
    </a>
  );
}

/** Above the composer: what will be sent, with a way to send the link without it. */
export function ComposerLinkPreview({
  preview,
  loading,
  onRemove,
}: {
  preview: LinkPreview | null;
  loading: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  if (!preview && !loading) return null;
  return (
    <section
      aria-label={t('linkPreview.attached')}
      aria-busy={loading}
      className="relative mx-2 mb-1 flex overflow-hidden rounded-xl border bg-surface"
    >
      {preview ? (
        <span className="min-w-0 flex-1 [&_img]:max-h-24">
          <PreviewBody preview={preview} />
        </span>
      ) : (
        <span role="status" className="flex-1 px-3 py-2 text-sm text-text-muted">
          {t('linkPreview.loading')}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('linkPreview.remove')}
        className="absolute top-1 right-1 rounded-full bg-surface/90 p-1 text-text-muted hover:text-text"
      >
        <X className="size-4" aria-hidden />
      </button>
    </section>
  );
}
