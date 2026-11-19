import { FileText, Film, Link2, Music } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '@/features/media/process';
import { cn } from '@/lib/utils';
import type { SharedFile, SharedItem } from '@/sw/share/store';
import { sharedText } from '../use-shared-item';

function FileThumb({ file }: { file: SharedFile }) {
  const url = useMemo(
    () => (file.type.startsWith('image/') ? URL.createObjectURL(file.blob) : null),
    [file],
  );
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  if (url) return <img src={url} alt="" className="size-14 rounded-lg object-cover" />;
  const Icon = file.type.startsWith('video/')
    ? Film
    : file.type.startsWith('audio/')
      ? Music
      : FileText;
  return (
    <span className="flex size-14 items-center justify-center rounded-lg bg-brand-subtle text-brand-text">
      <Icon className="size-6" aria-hidden />
    </span>
  );
}

/** What is about to be sent: each file (picture, or icon), its name and size; and the text or link. */
export function SharePreview(props: {
  item: SharedItem;
  tooLarge: Set<SharedFile>;
  maxBytes: number | null;
}) {
  const { t, i18n } = useTranslation();
  const { item } = props;
  const text = sharedText(item);
  return (
    <section aria-label={t('share.preview')} className="space-y-2">
      {item.files.length > 0 ? (
        <ul className="space-y-2">
          {item.files.map((file, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a share never changes order, and two files may share a name
              key={`${index}-${file.name}`}
              className={cn(
                'flex items-center gap-3 rounded-xl border bg-surface p-2',
                props.tooLarge.has(file) && 'border-danger',
              )}
            >
              <FileThumb file={file} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{file.name}</span>
                <span className="block text-xs text-text-muted">
                  {formatBytes(file.size, i18n.language)}
                </span>
                {props.tooLarge.has(file) ? (
                  <span role="alert" className="block text-xs text-danger">
                    {t('share.tooLarge', {
                      limit: formatBytes(props.maxBytes ?? 0, i18n.language),
                    })}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {text ? (
        <p className="flex items-start gap-2 rounded-xl border bg-surface p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
          {item.url ? (
            <Link2 className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
          ) : null}
          {text}
        </p>
      ) : null}
    </section>
  );
}
