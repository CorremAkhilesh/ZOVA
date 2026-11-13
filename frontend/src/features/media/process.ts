import { IMAGE_MAX_BYTES, type MediaKind } from '@zuvo/protocol';

export const IMAGE_MAX_PX = 2560;
const JPEG_QUALITY = 0.8;
const POSTER_MAX_PX = 640;
/** A large video must not leave the send button spinning: it can go without a poster. */
const POSTER_TIMEOUT_MS = 15_000;

/** The largest size that fits, keeping the shape. Never enlarges. */
export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** What the browser will send: the picture type decides how it is compressed. */
export function outputType(mime: string): 'image/png' | 'image/jpeg' {
  return mime === 'image/png' ? 'image/png' : 'image/jpeg';
}

/** Formats the audio player can offer. Anything else goes as a document, not lost. */
const PLAYABLE_AUDIO = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
]);

export function kindOf(file: { type: string }): MediaKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (PLAYABLE_AUDIO.has(file.type)) return 'audio';
  return 'document';
}

/** The name once converted: a HEIC photo becoming a JPEG should not still say .heic. */
export function renamed(name: string, mime: string): string {
  const extension = mime === 'image/png' ? 'png' : 'jpg';
  return `${name.replace(/\.[^.]+$/, '')}.${extension}`;
}

export interface PreparedFile {
  file: Blob;
  name: string;
  mime: string;
  kind: MediaKind;
  width?: number;
  height?: number;
  duration?: number;
  poster?: Blob;
}

const asDocument = (file: File): PreparedFile => ({
  file,
  name: file.name,
  mime: file.type || 'application/octet-stream',
  kind: 'document',
});

async function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function drawn(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(source, 0, 0, width, height);
  return canvas;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This browser cannot read this picture'));
    image.src = url;
  });
}

/**
 * Resizes and compresses, and converts HEIC where the browser can read it (Safari). Where it cannot
 * (HEIC on Chrome), the photo goes as a document instead of being lost. PNG stays PNG, for
 * transparency, and GIF is left alone so it can stay animated.
 */
export async function prepareImage(file: File): Promise<PreparedFile> {
  // Decoding this much could take the tab down, and the server would refuse it as a picture.
  if (file.size > IMAGE_MAX_BYTES) return asDocument(file);
  if (file.type === 'image/gif') return { file, name: file.name, mime: file.type, kind: 'image' };
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const size = fitWithin(image.naturalWidth, image.naturalHeight, IMAGE_MAX_PX);
    const type = outputType(file.type);
    const blob = await canvasBlob(
      drawn(image, size.width, size.height),
      type,
      type === 'image/jpeg' ? JPEG_QUALITY : undefined,
    );
    if (!blob || blob.size > IMAGE_MAX_BYTES) return asDocument(file);
    return { file: blob, name: renamed(file.name, type), mime: type, kind: 'image', ...size };
  } catch {
    return asDocument(file);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out')), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

function createVideo(url: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  return video;
}

function videoLoaded(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('This browser cannot read this video'));
    // It may have got there already.
    if (video.readyState >= 2) resolve();
  });
}

/** Without this it goes on reading the file, however large, after we are done with it. */
function stopReading(video: HTMLVideoElement) {
  video.removeAttribute('src');
  video.load();
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    video.onseeked = () => resolve();
    video.currentTime = time;
  });
}

/** Poster frame, duration and size, from the browser: the server does not decode video yet. */
export async function prepareVideo(file: File): Promise<PreparedFile> {
  const basics = { file, name: file.name, mime: file.type, kind: 'video' as const };
  const url = URL.createObjectURL(file);
  let video: HTMLVideoElement | undefined;
  try {
    video = createVideo(url);
    await withTimeout(videoLoaded(video), POSTER_TIMEOUT_MS);
    const duration = Number.isFinite(video.duration) ? video.duration : undefined;
    // Not the very first frame: it is often black.
    await withTimeout(seek(video, Math.min(0.5, (duration ?? 1) / 2)), POSTER_TIMEOUT_MS);
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) return { ...basics, ...(duration ? { duration } : {}) };
    const size = fitWithin(width, height, POSTER_MAX_PX);
    const poster = await canvasBlob(drawn(video, size.width, size.height), 'image/jpeg', 0.75);
    return {
      ...basics,
      width,
      height,
      ...(duration ? { duration } : {}),
      ...(poster ? { poster } : {}),
    };
  } catch {
    // Still sendable: it just has no poster or duration to show.
    return basics;
  } finally {
    if (video) stopReading(video);
    URL.revokeObjectURL(url);
  }
}

export function prepareFile(file: File, sendAsDocument: boolean): Promise<PreparedFile> {
  const kind = sendAsDocument ? 'document' : kindOf(file);
  if (kind === 'image') return prepareImage(file);
  if (kind === 'video') return prepareVideo(file);
  if (kind === 'audio') {
    return Promise.resolve({ file, name: file.name, mime: file.type, kind: 'audio' });
  }
  return Promise.resolve(asDocument(file));
}

export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

export { formatDuration } from '@zuvo/protocol';
