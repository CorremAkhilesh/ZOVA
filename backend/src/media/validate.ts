import type { MediaKind } from '@zuvo/protocol';
import { type FileTypeResult, fileTypeFromBuffer } from 'file-type';
import { AppError } from '../lib/errors.ts';

/** Enough for every signature we look for. */
export const SNIFF_BYTES = 8192;

export const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const EXECUTABLE_MIMES = new Set([
  'application/x-msdownload',
  'application/vnd.microsoft.portable-executable',
  'application/x-elf',
  'application/x-mach-binary',
  'application/x-executable',
  'application/x-sharedlib',
  'application/x-deb',
  'application/x-rpm',
  'application/x-apple-diskimage',
  'application/vnd.android.package-archive',
  'application/java-archive',
]);

/** Scripts and installers look like text or zip files, so the name has to count here too. */
const BLOCKED_EXTENSIONS = new Set(
  'exe msi com scr pif bat cmd ps1 vbs vbe wsf wsh jar apk app dmg deb rpm dll sys sh bash'.split(
    ' ',
  ),
);

/** Text has no signature. These are allowed only if the content really looks like text. */
const TEXT_EXTENSIONS = new Set('txt csv tsv md log json xml svg html htm js css rtf'.split(' '));
/** Safe to label as text. Anything else is served as bytes: it could run if a browser rendered it. */
const PLAIN_TEXT_EXTENSIONS = new Set(['txt', 'csv', 'tsv', 'md', 'log']);

const DOCUMENT_MIME_PREFIXES = [
  'application/vnd.openxmlformats-officedocument.',
  'application/vnd.oasis.opendocument.',
  'image/',
  'video/',
  'audio/',
];
const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/x-cfb',
  'application/zip',
  'application/gzip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/rtf',
  'application/epub+zip',
]);

/** What a voice recorder makes, whatever a signature check calls it, as it is served to players. */
const RECORDING_MIMES: Record<string, string> = {
  'audio/webm': 'audio/webm',
  'video/webm': 'audio/webm',
  'audio/ogg': 'audio/ogg',
  'audio/opus': 'audio/ogg',
  'application/ogg': 'audio/ogg',
  'audio/mp4': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'video/mp4': 'audio/mp4',
};
const AUDIO_FILE_MIMES: Record<string, string> = {
  ...RECORDING_MIMES,
  'audio/mpeg': 'audio/mpeg',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/flac': 'audio/flac',
  'audio/x-flac': 'audio/flac',
  'audio/aac': 'audio/aac',
};

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

function looksLikeText(head: Uint8Array): boolean {
  // Binary formats almost always have a NUL early on; text never does.
  return !head.includes(0);
}

const refuse = (message: string) => new AppError('UNSUPPORTED_MEDIA_TYPE', message);

function verifyDocument(detected: FileTypeResult | undefined, extension: string, head: Uint8Array) {
  // Formats text-like enough for a signature check to call them XML.
  if (!detected || detected.mime === 'application/xml') {
    if (!TEXT_EXTENSIONS.has(extension) || !looksLikeText(head)) {
      throw refuse('This type of file cannot be sent.');
    }
    return PLAIN_TEXT_EXTENSIONS.has(extension) ? 'text/plain' : 'application/octet-stream';
  }
  const { mime } = detected;
  if (
    DOCUMENT_MIMES.has(mime) ||
    DOCUMENT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
  ) {
    return mime;
  }
  throw refuse('This type of file cannot be sent.');
}

function verifyAudio(detected: FileTypeResult | undefined, known: Record<string, string>) {
  // "audio/ogg; codecs=opus" is still Ogg.
  const mime = known[detected?.mime.split(';')[0] ?? ''];
  if (mime) return mime;
  throw refuse('This file is not an audio format that can be played here. Send it as a document.');
}

const isExecutable = (detected: FileTypeResult | undefined) =>
  detected && (EXECUTABLE_MIMES.has(detected.mime) || BLOCKED_EXTENSIONS.has(detected.ext));

/**
 * Decides what a file is from its first bytes, never from its name or declared type, and refuses
 * anything not on the allow-list. Returns the type it will be served as.
 */
export async function verifyFileType(kind: MediaKind, name: string, head: Uint8Array) {
  const extension = extensionOf(name);
  const detected = await fileTypeFromBuffer(head);
  if (BLOCKED_EXTENSIONS.has(extension) || isExecutable(detected)) {
    throw refuse('Programs and scripts cannot be sent.');
  }
  if (kind === 'document') return verifyDocument(detected, extension, head);
  if (kind === 'voice') return verifyAudio(detected, RECORDING_MIMES);
  if (kind === 'audio') return verifyAudio(detected, AUDIO_FILE_MIMES);
  if (kind === 'image') {
    if (detected && IMAGE_MIMES.has(detected.mime)) return detected.mime;
    throw refuse('This file is not a JPEG, PNG, WebP or GIF picture. Send it as a document.');
  }
  if (detected && VIDEO_MIMES.has(detected.mime)) return detected.mime;
  throw refuse('This file is not an MP4, WebM or MOV video. Send it as a document.');
}
