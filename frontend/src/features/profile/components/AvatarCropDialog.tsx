import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import Cropper from 'react-easy-crop';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { type CropArea, cropToJpeg } from '../crop-image';

interface AvatarCropDialogProps {
  /** Object URL of the chosen photo; null closes the dialog. */
  src: string | null;
  onCancel: () => void;
  onCropped: (photo: Blob) => void;
}

/** Drag to position, slider (or wheel/pinch) to zoom, then a square JPEG goes to the upload. */
export function AvatarCropDialog({ src, onCancel, onCropped }: AvatarCropDialogProps) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!src || !area) return;
    setBusy(true);
    try {
      onCropped(await cropToJpeg(src, area));
    } catch {
      setError(t('profile.photo.unreadable'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={src !== null} onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent title={t('profile.photo.cropTitle')} description={t('profile.photo.cropHint')}>
        <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
          {src ? (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
              onMediaLoaded={() => setError('')}
            />
          ) : null}
        </div>
        <label className="flex items-center gap-3 text-sm font-medium">
          {t('profile.photo.zoom')}
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="flex-1 accent-brand"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </DialogClose>
          <Button onClick={() => void save()} disabled={!area || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {t('profile.photo.use')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
