import { brand } from '@zuvo/config';
import type { AppLanguage } from '@zuvo/protocol';
import type { DeviceInfo } from '../../security/devices.ts';

/**
 * Every word the emails say, in English and Hindi. The brand comes from brand.ts; "OTP" and "PIN"
 * stay as they are in Hindi, which is how people say them.
 */
export interface EmailStrings {
  footer: string;
  otp: {
    subject: (code: string) => string;
    heading: string;
    intro: string;
    codeLine: (code: string) => string;
    expiry: (minutes: number, at: string) => string;
    ignore: string;
  };
  lockReset: {
    subject: (code: string) => string;
    heading: string;
    intro: string;
    codeLine: (code: string) => string;
    expiry: (minutes: number, at: string) => string;
    ignore: string;
  };
  loginAlert: {
    subject: string;
    heading: string;
    intro: string;
    device: (device: DeviceInfo['deviceType']) => string;
    browser: (browser: string) => string;
    os: (os: string) => string;
    time: (at: string) => string;
    ifYou: string;
    button: string;
    note: string;
    linkLine: string;
  };
}

const { name } = brand;

const EN: EmailStrings = {
  footer: `${name} — ${brand.tagline}`,
  otp: {
    subject: (code) => `${code} is your ${name} verification code`,
    heading: 'Your verification code',
    intro: `Enter this code in ${name} to sign in.`,
    codeLine: (code) => `Your ${name} verification code is: ${code}`,
    expiry: (minutes, at) =>
      `This code expires in ${minutes} minutes (at ${at}). Only the most recent code works.`,
    ignore: 'If you didn’t request this, ignore this email. Nobody can sign in without the code.',
  },
  lockReset: {
    subject: (code) => `${code} is your ${name} PIN reset code`,
    heading: 'Reset your PIN',
    intro: `Enter this code in ${name} to remove your PIN. Your locked chats stay locked, and you will set a new PIN.`,
    codeLine: (code) => `Your ${name} PIN reset code is: ${code}`,
    expiry: (minutes, at) =>
      `This code expires in ${minutes} minutes (at ${at}). Only the most recent code works.`,
    ignore:
      'If you didn’t ask for this, ignore this email: your PIN stays as it is. Nobody can reset it without the code.',
  },
  loginAlert: {
    subject: `New sign-in to your ${name} account`,
    heading: 'New sign-in to your account',
    intro: `Your ${name} account was just used to sign in on a new device.`,
    device: (type) => `Device: ${type === 'unknown' ? 'Unknown device' : type}`,
    browser: (browser) => `Browser: ${browser}`,
    os: (os) => `Operating system: ${os}`,
    time: (at) => `Time: ${at}`,
    ifYou: 'If this was you, you don’t need to do anything.',
    button: 'This wasn’t me — sign out everywhere',
    note: 'The button signs your account out on every device. The link works once and expires in 7 days.',
    linkLine:
      'If it wasn’t you, open this link to sign out everywhere (works once, expires in 7 days):',
  },
};

const DEVICE_HI: Record<DeviceInfo['deviceType'], string> = {
  desktop: 'कंप्यूटर',
  mobile: 'मोबाइल',
  tablet: 'टैबलेट',
  unknown: 'अज्ञात डिवाइस',
};

const HI: EmailStrings = {
  footer: `${name} — ${brand.taglineHi}`,
  otp: {
    subject: (code) => `${code} आपका ${name} OTP है`,
    heading: 'आपका OTP',
    intro: `साइन इन करने के लिए यह OTP ${name} में डालें।`,
    codeLine: (code) => `आपका ${name} OTP है: ${code}`,
    expiry: (minutes, at) =>
      `यह OTP ${minutes} मिनट में (${at} पर) समाप्त हो जाएगा। केवल सबसे नया OTP ही काम करता है।`,
    ignore: 'अगर आपने यह नहीं माँगा था, तो इस ईमेल को अनदेखा करें। OTP के बिना कोई भी साइन इन नहीं कर सकता।',
  },
  lockReset: {
    subject: (code) => `${code} आपका ${name} PIN रीसेट कोड है`,
    heading: 'अपना PIN रीसेट करें',
    intro: `अपना PIN हटाने के लिए यह कोड ${name} में डालें। आपकी लॉक की गई चैट लॉक ही रहेंगी, और आप नया PIN सेट करेंगे।`,
    codeLine: (code) => `आपका ${name} PIN रीसेट कोड है: ${code}`,
    expiry: (minutes, at) =>
      `यह कोड ${minutes} मिनट में (${at} पर) समाप्त हो जाएगा। केवल सबसे नया कोड ही काम करता है।`,
    ignore:
      'अगर आपने यह नहीं माँगा था, तो इस ईमेल को अनदेखा करें: आपका PIN जैसा है वैसा ही रहेगा। कोड के बिना कोई भी इसे रीसेट नहीं कर सकता।',
  },
  loginAlert: {
    subject: `आपके ${name} खाते में नया साइन-इन`,
    heading: 'आपके खाते में नया साइन-इन',
    intro: `आपके ${name} खाते से अभी एक नए डिवाइस पर साइन इन किया गया।`,
    device: (type) => `डिवाइस: ${DEVICE_HI[type]}`,
    browser: (browser) => `ब्राउज़र: ${browser === 'Unknown browser' ? 'अज्ञात ब्राउज़र' : browser}`,
    os: (os) => `ऑपरेटिंग सिस्टम: ${os === 'Unknown OS' ? 'अज्ञात' : os}`,
    time: (at) => `समय: ${at}`,
    ifYou: 'अगर यह आप ही थे, तो आपको कुछ करने की ज़रूरत नहीं है।',
    button: 'यह मैं नहीं था — हर जगह से साइन आउट करें',
    note: 'यह बटन हर डिवाइस पर आपके खाते से साइन आउट कर देता है। लिंक केवल एक बार काम करता है और 7 दिनों में समाप्त हो जाता है।',
    linkLine:
      'अगर यह आप नहीं थे, तो हर जगह से साइन आउट करने के लिए यह लिंक खोलें (एक बार काम करता है, 7 दिनों में समाप्त होता है):',
  },
};

const STRINGS: Record<AppLanguage, EmailStrings> = { en: EN, hi: HI };

export const emailStrings = (language: AppLanguage): EmailStrings => STRINGS[language];

/**
 * The language of an email to an address with no saved choice: the request's Accept-Language
 * (the app sends its own language there), else English.
 */
export function languageFromHeader(header: string | null | undefined): AppLanguage {
  const first = header?.split(',')[0]?.trim().toLowerCase() ?? '';
  return first === 'hi' || first.startsWith('hi-') ? 'hi' : 'en';
}
