/** Pixel rectangle from react-easy-crop's `onCropComplete`. */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Upload size: the server makes 512 px and 128 px versions, so more is wasted bandwidth. */
export const AVATAR_UPLOAD_SIZE = 1024;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image cannot be opened in this browser.'));
    image.src = src;
  });
}

/** Square output side: the crop, downscaled to at most AVATAR_UPLOAD_SIZE. */
export const outputSize = (area: CropArea) =>
  Math.max(1, Math.min(AVATAR_UPLOAD_SIZE, Math.round(area.width)));

/**
 * Crops and downscales in the browser and re-encodes as JPEG. Re-encoding also turns HEIC photos
 * (which Safari can open) into JPEG, and drops EXIF/GPS before anything leaves the device.
 */
export async function cropToJpeg(src: string, area: CropArea): Promise<Blob> {
  const image = await loadImage(src);
  const size = outputSize(area);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, size, size);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the photo.'))),
      'image/jpeg',
      0.9,
    );
  });
}
