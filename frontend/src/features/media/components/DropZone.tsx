import { ImagePlus } from 'lucide-react';
import { type DragEvent, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const hasFiles = (event: DragEvent) => event.dataTransfer?.types?.includes('Files');

/** Files dragged over the chat show an overlay; dropping them opens the preview sheet. */
export function DropZone(props: {
  className: string;
  onFiles: ((files: File[]) => void) | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  // Moving across child elements fires leave and enter in pairs.
  const depth = useRef(0);
  const { onFiles } = props;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dragging is mouse only; the attach button is the keyboard route
    <div
      className={`relative ${props.className}`}
      onDragEnter={(event) => {
        if (!onFiles || !hasFiles(event)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (onFiles && hasFiles(event)) event.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        depth.current = 0;
        setOver(false);
        if (!onFiles || !hasFiles(event)) return;
        event.preventDefault();
        onFiles([...event.dataTransfer.files]);
      }}
    >
      {props.children}
      {over ? (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-surface/90 text-brand-text">
          <ImagePlus className="size-10" aria-hidden />
          <p className="font-semibold">{t('media.dropHere')}</p>
        </div>
      ) : null}
    </div>
  );
}
