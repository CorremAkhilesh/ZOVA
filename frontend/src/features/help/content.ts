import { brand } from '@zuvo/config';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/lib/i18n';
import en from './locales/en.json';
import hi from './locales/hi.json';

/**
 * The long Help texts live here, not in the app's locale files: those are part of the main bundle,
 * and Help is read rarely. They are merged under the same `help` key when a Help page loads.
 */
export function registerHelpContent() {
  if (i18n.exists('help.home.subtitle', { lng: 'en' })) return;
  i18n.addResourceBundle('en', 'translation', { help: en }, true, false);
  i18n.addResourceBundle('hi', 'translation', { help: hi }, true, false);
}
registerHelpContent();

/** Values every Help text may use. */
const BRAND_VALUES = {
  brand: brand.name,
  email: brand.supportEmail,
  domain: brand.domains.organization,
  company: brand.company,
  companyShort: brand.companyShort,
};

/** `t` for Help: brand values filled in, plus `list()` for the step and point arrays. */
export function useHelpText() {
  const { t, i18n: instance } = useTranslation();
  const text = (key: string, values: Record<string, unknown> = {}) =>
    t(`help.${key}`, { ...BRAND_VALUES, ...values });
  const list = (key: string, values: Record<string, unknown> = {}): string[] => {
    const value: unknown = t(`help.${key}`, { ...BRAND_VALUES, ...values, returnObjects: true });
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  };
  return { text, list, language: instance.resolvedLanguage ?? 'en' };
}
