import { BarChart3, Camera, FileText, Image as ImageIcon, Paperclip } from 'lucide-react';
import { Popover } from 'radix-ui';
import { type ChangeEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useBackClose } from '@/lib/back-stack';
import { useIsDesktop } from '@/lib/hooks';

const CHOICE =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-background';

/** `onPoll`: offered only where a poll can go (see features/polls/use-poll-composer.tsx). */
export function AttachMenu(props: {
  onFiles: (files: File[]) => void;
  onPoll?: (() => void) | undefined;
}) {
  const { onFiles, onPoll } = props;
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const media = useRef<HTMLInputElement>(null);
  const document = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    // Choosing the same file again should still fire.
    event.target.value = '';
    setOpen(false);
    if (files.length > 0) onFiles(files);
  }

  return (
    <>
      <input
        ref={media}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        data-testid="pick-media"
        onChange={choose}
      />
      <input
        ref={document}
        type="file"
        multiple
        hidden
        data-testid="pick-document"
        onChange={choose}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        hidden
        onChange={choose}
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={t('conversation.attach')}>
            <Paperclip className="size-5" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            aria-label={t('conversation.attach')}
            className="z-[1500] w-56 rounded-xl border bg-surface p-1.5 shadow-lg"
          >
            <button type="button" className={CHOICE} onClick={() => media.current?.click()}>
              <ImageIcon className="size-5 text-brand-text" aria-hidden />
              {t('media.photosAndVideos')}
            </button>
            <button type="button" className={CHOICE} onClick={() => document.current?.click()}>
              <FileText className="size-5 text-brand-text" aria-hidden />
              {t('media.document')}
            </button>
            {isDesktop ? null : (
              <button type="button" className={CHOICE} onClick={() => camera.current?.click()}>
                <Camera className="size-5 text-brand-text" aria-hidden />
                {t('media.camera')}
              </button>
            )}
            {onPoll ? (
              <button
                type="button"
                className={CHOICE}
                onClick={() => {
                  setOpen(false);
                  onPoll();
                }}
              >
                <BarChart3 className="size-5 text-brand-text" aria-hidden />
                {t('polls.attach')}
              </button>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
