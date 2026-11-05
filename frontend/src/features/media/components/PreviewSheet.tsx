import { ALBUM_MAX_ITEMS, CAPTION_MAX } from '@zuvo/protocol';
import { FileText, Loader2, Video, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { uuidv7 } from '@/lib/uuid';
import { formatBytes, kindOf } from '../process';

export interface PickedFile {
  id: string;
  file: File;
  caption: string;
}

export const toPicked = (files: File[]): PickedFile[] =>
  files.map((file) => ({ id: uuidv7(), file, caption: '' }));

interface SendInput {
  items: PickedFile[];
  asDocument: boolean;
}

interface PreviewSheetProps {
  picked: PickedFile[];
  /** From the server. Null while it is not known, so nothing is left out on a guess. */
  maxBytes: number | null;
  onChange: (picked: PickedFile[]) => void;
  onClose: () => void;
  onSend: (input: SendInput) => Promise<void>;
}

/** A picture's preview, in the sheet only; it goes when the sheet does. */
function usePreviewUrl(file: File) {
  const url = useMemo(() => (kindOf(file) === 'image' ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

const isTooBig = (file: File, maxBytes: number | null) => maxBytes !== null && file.size > maxBytes;

function PickedItem(props: {
  item: PickedFile;
  maxBytes: number | null;
  onCaption: (caption: string) => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { item, maxBytes } = props;
  const url = usePreviewUrl(item.file);
  const kind = kindOf(item.file);
  const tooBig = isTooBig(item.file, maxBytes);
  const Icon = kind === 'video' ? Video : FileText;
  return (
    <li className="flex gap-3 rounded-xl border p-2">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background">
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <Icon className="size-8 text-text-muted" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.file.name}</p>
          <button
            type="button"
            aria-label={t('media.removeFile', { name: item.file.name })}
            onClick={props.onRemove}
            className="shrink-0 rounded-full p-1 text-text-muted hover:bg-background"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <p className="text-xs text-text-muted">
          {formatBytes(item.file.size, i18n.language)}
          {tooBig && maxBytes !== null ? (
            <span className="font-semibold text-danger">
              {' · '}
              {t('media.tooBig', { limit: formatBytes(maxBytes, i18n.language) })}
            </span>
          ) : null}
        </p>
        <input
          type="text"
          maxLength={CAPTION_MAX}
          value={item.caption}
          onChange={(event) => props.onCaption(event.target.value)}
          placeholder={t('media.addCaption')}
          aria-label={t('media.captionFor', { name: item.file.name })}
          className="w-full rounded-lg border bg-surface px-2.5 py-1.5 text-sm outline-none focus-visible:border-brand"
        />
      </div>
    </li>
  );
}

/** Check before sending: remove things, add captions, or send without compressing. */
export function PreviewSheet({ picked, maxBytes, onChange, onClose, onSend }: PreviewSheetProps) {
  const { t, i18n } = useTranslation();
  const [asDocument, setAsDocument] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const items = picked.slice(0, ALBUM_MAX_ITEMS);
  const overLimit = picked.length > ALBUM_MAX_ITEMS;
  const sendable = items.filter((item) => !isTooBig(item.file, maxBytes));
  const nothing = sendable.length === 0;
  const total = sendable.reduce((sum, item) => sum + item.file.size, 0);

  async function send() {
    setSending(true);
    setFailed(false);
    try {
      await onSend({ items: sendable, asDocument });
      onClose();
    } catch (error) {
      console.error(`[media] could not queue: ${error instanceof Error ? error.name : 'unknown'}`);
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={picked.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={
          nothing ? t('media.nothingToSend') : t('media.previewTitle', { count: sendable.length })
        }
        className="max-w-lg"
      >
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
          {items.map((item) => (
            <PickedItem
              key={item.id}
              item={item}
              maxBytes={maxBytes}
              onCaption={(caption) =>
                onChange(
                  picked.map((other) => (other.id === item.id ? { ...other, caption } : other)),
                )
              }
              onRemove={() => onChange(picked.filter((other) => other.id !== item.id))}
            />
          ))}
        </ul>
        {overLimit ? (
          <p role="alert" className="text-sm text-danger">
            {t('media.tooMany', { count: ALBUM_MAX_ITEMS })}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            {t('media.sendFailed')}
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={asDocument}
            onChange={(event) => setAsDocument(event.target.checked)}
          />
          {t('media.sendAsDocument')}
        </label>
        <div className="flex items-center justify-between gap-3">
          {nothing ? null : (
            <p className="text-sm text-text-muted">
              {t('media.totalSize', { size: formatBytes(total, i18n.language) })}
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('media.cancel')}
            </Button>
            <Button onClick={() => void send()} disabled={sending || nothing}>
              {sending ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : null}
              {nothing ? t('media.nothingToSend') : t('media.send', { count: sendable.length })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
