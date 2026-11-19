import { Camera } from 'lucide-react';
import { type ChangeEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** Phones and tablets: take a photo or video now. The picture opens the send sheet like any file. */
export function CameraButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    // Taking the same picture again should still fire.
    event.target.value = '';
    if (files.length > 0) onFiles(files);
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        hidden
        data-testid="pick-camera"
        onChange={choose}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 rounded-full text-text-muted hover:text-text"
        aria-label={t('media.camera')}
        onClick={() => input.current?.click()}
      >
        <Camera className="size-5" />
      </Button>
    </>
  );
}
