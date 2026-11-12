import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { useQuery } from '@tanstack/react-query';
import { lockApi } from './api';

/** 127.0.0.1, 10.0.0.5, [::1]: WebAuthn refuses an IP address as the site's id. */
export function isIpHost(hostname: string): boolean {
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':') || hostname.startsWith('[')
  );
}

/**
 * Windows Hello, Touch ID or a fingerprint can be used here: a secure page on a real host name,
 * with a built-in authenticator that checks who is there.
 */
export async function platformBiometricAvailable(
  hostname = window.location.hostname,
): Promise<boolean> {
  if (!window.isSecureContext || isIpHost(hostname)) return false;
  const credential = window.PublicKeyCredential;
  if (!credential?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await credential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export const useBiometricSupport = () =>
  useQuery({
    queryKey: ['device', 'biometric'],
    queryFn: () => platformBiometricAvailable(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  }).data === true;

type Json = Record<string, unknown>;

/** Adds this device's Windows Hello / fingerprint. The library loads only now. */
export async function registerBiometric() {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const { options } = await lockApi.biometricOptions('register');
  const response = await startRegistration({
    optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
  return lockApi.biometricVerify('register', response as unknown as Json);
}

/** Unlocks with Windows Hello / fingerprint instead of the PIN. */
export async function unlockWithBiometric() {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const { options } = await lockApi.biometricOptions('unlock');
  const response = await startAuthentication({
    optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
  });
  return lockApi.biometricVerify('unlock', response as unknown as Json);
}
