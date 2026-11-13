import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import hi from '../locales/hi.json';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const resources = { en: { translation: en }, hi: { translation: hi } } as const;

export function initI18n(options: { language?: LanguageCode } = {}) {
  if (i18n.isInitialized) return i18n;
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      ...(options.language ? { lng: options.language } : {}),
      fallbackLng: 'en',
      supportedLngs: LANGUAGES.map((language) => language.code),
      interpolation: { escapeValue: false },
      detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'zuvo-language' },
      initAsync: false,
    });
  i18n.on('languageChanged', (language) => {
    document.documentElement.lang = language;
  });
  document.documentElement.lang = i18n.language;
  return i18n;
}

export { i18n };
