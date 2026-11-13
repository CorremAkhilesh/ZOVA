import { brand } from '@zuvo/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { headers, outbox, requestOtp, signIn, verifyOtp } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await built.cleanup();
});

/** The subject of the newest email to `email`, once one arrives after `count` emails. */
async function nextSubject(email: string, count: number) {
  let subject = '';
  await vi.waitFor(
    () => {
      const sent = outbox(app()).outbox.filter((message) => message.to === email);
      if (sent.length <= count) throw new Error('no email yet');
      subject = sent.at(-1)?.subject ?? '';
    },
    { timeout: 15_000, interval: 50 },
  );
  return subject;
}
const sentTo = (email: string) =>
  outbox(app()).outbox.filter((message) => message.to === email).length;

const saveLanguage = (cookie: string, language: 'en' | 'hi') =>
  app().inject({
    method: 'PATCH',
    url: '/v1/me/profile',
    headers: headers(cookie),
    payload: { language },
  });

describe('the language of the server’s emails', () => {
  it('a code to an address without an account follows Accept-Language, else English', async () => {
    const hindi = 'nayi@corremadvisory.com';
    await requestOtp(app(), hindi, { 'accept-language': 'hi-IN,hi;q=0.9' });
    expect(await nextSubject(hindi, 0)).toMatch(new RegExp(`^\\d{6} आपका ${brand.name} OTP है$`));

    const plain = 'plain@corremadvisory.com';
    await requestOtp(app(), plain);
    expect(await nextSubject(plain, 0)).toMatch(/^\d{6} is your .+ verification code$/);
  });

  it('the saved language wins for codes and new-login alerts, whatever the browser says', async () => {
    const email = 'hindi.user@corremadvisory.com';
    const { cookie } = await signIn(app(), email);
    expect((await saveLanguage(cookie, 'hi')).statusCode).toBe(200);

    const before = sentTo(email);
    await app().otpThrottle.resetEmail(email);
    await requestOtp(app(), email, { 'accept-language': 'en-US' });
    const subject = await nextSubject(email, before);
    expect(subject).toMatch(/^\d{6} आपका .+ OTP है$/);

    // Signing in with that code (a new device) sends the alert.
    expect((await verifyOtp(app(), email, subject.slice(0, 6))).statusCode).toBe(200);
    await vi.waitFor(
      () =>
        expect(outbox(app()).lastTo(email)?.subject).toBe(`आपके ${brand.name} खाते में नया साइन-इन`),
      { timeout: 15_000 },
    );
    expect(outbox(app()).lastTo(email)?.text).toContain('यह आप नहीं थे');
  });

  it('the PIN reset code is written in the saved language', async () => {
    const email = 'pin.hindi@corremadvisory.com';
    const { cookie } = await signIn(app(), email);
    await saveLanguage(cookie, 'hi');
    const call = (url: string, payload: object) =>
      app().inject({
        method: url.endsWith('pin') ? 'PUT' : 'POST',
        url,
        headers: headers(cookie),
        payload,
      });
    expect((await call('/v1/me/lock/pin', { pin: '1234' })).statusCode).toBe(200);
    const before = sentTo(email);
    expect((await call('/v1/me/lock/reset/request', {})).statusCode).toBe(200);
    expect(await nextSubject(email, before)).toMatch(/^\d{6} आपका .+ PIN रीसेट कोड है$/);
  });
});
