/** A VAPID public key (base64url, as the server sends it) as the bytes pushManager.subscribe takes. */
export function vapidKeyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when a subscription was made with this key (a new server key needs a new subscription). */
export function sameKey(current: ArrayBuffer | null | undefined, base64Url: string): boolean {
  if (!current) return false;
  const wanted = vapidKeyBytes(base64Url);
  const have = new Uint8Array(current);
  return have.length === wanted.length && have.every((byte, i) => byte === wanted[i]);
}
