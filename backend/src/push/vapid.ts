import { createECDH } from 'node:crypto';

/** VAPID keys are P-256 keys in unpadded base64url (RFC 8292). */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function decodeBase64Url(value: string): Buffer | null {
  if (!BASE64URL.test(value)) return null;
  return Buffer.from(value, 'base64url');
}

/** An uncompressed P-256 point: 65 bytes, starting with 0x04. */
export function isVapidPublicKey(value: string): boolean {
  const bytes = decodeBase64Url(value);
  return bytes?.length === 65 && bytes[0] === 0x04;
}

/** A P-256 private scalar: 32 bytes. */
export function isVapidPrivateKey(value: string): boolean {
  return decodeBase64Url(value)?.length === 32;
}

/** True when the public key is the one that belongs to the private key. */
export function vapidKeysMatch(keys: VapidKeys): boolean {
  const privateKey = decodeBase64Url(keys.privateKey);
  if (privateKey?.length !== 32) return false;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(privateKey);
    return ecdh.getPublicKey().toString('base64url') === keys.publicKey;
  } catch {
    return false;
  }
}

/** A fresh key pair (`pnpm vapid:gen` does the same in plain Node). */
export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const scalar = ecdh.getPrivateKey();
  // A scalar with leading zero bytes comes back shorter: keep it 32 bytes.
  const privateKey = Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]);
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: privateKey.toString('base64url'),
  };
}

/** A subscription's keys: p256dh is a P-256 point (65 bytes), auth a 16-byte secret. */
export function isValidSubscriptionKeys(keys: { p256dh: string; auth: string }): boolean {
  return isVapidPublicKey(keys.p256dh) && decodeBase64Url(keys.auth)?.length === 16;
}
