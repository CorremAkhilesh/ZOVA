import { Download, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ChatMessage, ME } from '@/features/chats/types';
import { cn } from '@/lib/utils';
import { mediaApi } from '../api';
import { formatBytes } from '../process';
import { UploadRing } from './MessageMedia';

export function useDownload(mediaId: string | undefined) {
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');
  return {
    state,
    async start() {
      if (!mediaId) return;
      setState('working');
      try {
        const { url } = await mediaApi.link(mediaId, true);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = '';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setState('idle');
      } catch {
        setState('failed');
      }
    },
  };
}

/** Type, name and size, and a download button. Documents are never shown inline. */
export function DocumentCard({ message }: { message: ChatMessage }) {
  const { t, i18n } = useTranslation();
  const { media } = message;
  const uploading = message.status === 'pending' && !media?.id;
  const download = useDownload(media?.id || undefined);
  if (!media) return null;
  const mine = message.authorId === ME;
  const extension = media.name.includes('.') ? media.name.split('.').pop()?.toUpperCase() : '';
  return (
    <div
      className={cn(
        'flex w-64 max-w-full items-center gap-3 rounded-xl p-2',
        mine ? 'bg-black/15' : 'bg-background',
      )}
    >
      <FileText className="size-9 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{media.name}</p>
        <p className="text-xs opacity-80">
          {[extension, formatBytes(media.size, i18n.language)].filter(Boolean).join(' · ')}
        </p>
        {download.state === 'failed' ? (
          <p role="alert" className="text-xs font-semibold">
            {t('media.notAvailable')}
          </p>
        ) : null}
      </div>
      {uploading ? (
        <div className="relative size-11 shrink-0">
          <UploadRing message={message} />
        </div>
      ) : (
        <button
          type="button"
          aria-label={t('media.downloadNamed', { name: media.name })}
          disabled={download.state === 'working'}
          onClick={() => void download.start()}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/15"
        >
          {download.state === 'working' ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Download className="size-4" aria-hidden />
          )}
        </button>
      )}
    </div>
  );
}
