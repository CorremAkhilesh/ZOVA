import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { brand } from '@zuvo/config';
import type { AppLanguage } from '@zuvo/protocol';
import type { CSSProperties, ReactNode } from 'react';
import { emailStrings } from './email-strings.ts';

/**
 * Email-safe palette. Email clients ignore CSS variables and some (Outlook) recolor messages, so
 * every pair is explicit and high-contrast — see EMAIL_CONTRAST_PAIRS (tested ≥ 4.5:1, mostly ≥ 7:1).
 */
export const EMAIL_COLORS = {
  light: {
    page: '#F1F5F9',
    card: '#FFFFFF',
    text: '#0F172A',
    secondary: '#334155',
    border: '#CBD5E1',
    codeBox: '#FFFFFF',
    codeBorder: '#94A3B8',
    codeText: '#0F172A',
    header: brand.colors.primary,
    headerText: '#FFFFFF',
    button: '#B91C1C',
    buttonText: '#FFFFFF',
  },
  dark: {
    page: '#020617',
    card: '#0F172A',
    text: '#F8FAFC',
    secondary: '#CBD5E1',
    border: '#334155',
    codeBox: '#1E293B',
    codeBorder: '#64748B',
    codeText: '#FFFFFF',
    header: '#3730A3',
    headerText: '#FFFFFF',
    button: '#B91C1C',
    buttonText: '#FFFFFF',
  },
} as const;

type Palette = (typeof EMAIL_COLORS)[keyof typeof EMAIL_COLORS];

/** Every text/background pair the templates use, per scheme (asserted in tests). */
export const EMAIL_CONTRAST_PAIRS = (['light', 'dark'] as const).flatMap((scheme) => {
  const c: Palette = EMAIL_COLORS[scheme];
  return [
    { scheme, name: 'text on card', fg: c.text, bg: c.card },
    { scheme, name: 'secondary on card', fg: c.secondary, bg: c.card },
    { scheme, name: 'code on code box', fg: c.codeText, bg: c.codeBox },
    { scheme, name: 'header text on header', fg: c.headerText, bg: c.header },
    { scheme, name: 'button text on button', fg: c.buttonText, bg: c.button },
    { scheme, name: 'text on page', fg: c.text, bg: c.page },
  ];
});

export const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";
const SANS = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const { light, dark } = EMAIL_COLORS;

/**
 * - prefers-color-scheme: Apple Mail, iOS Mail, Outlook for Mac, some webmail.
 * - [data-ogsc]/[data-ogsb]: attributes the new Outlook / Outlook.com add when they recolor a
 *   message for dark mode. Code box pinned to near-black on white; button keeps its colors.
 */
const schemeCss = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  .code { -webkit-user-select: all; user-select: all; }
  @media (prefers-color-scheme: dark) {
    /* React Email copies the body background onto a wrapper cell; repaint that one too. */
    html, body, .page, .page > table > tbody > tr > td, .page > table > tr > td { background-color: ${dark.page} !important; }
    .card { background-color: ${dark.card} !important; border-color: ${dark.border} !important; }
    .header { background-color: ${dark.header} !important; }
    .header-text { color: ${dark.headerText} !important; }
    .text { color: ${dark.text} !important; }
    .secondary { color: ${dark.secondary} !important; }
    .code { background-color: ${dark.codeBox} !important; color: ${dark.codeText} !important; border-color: ${dark.codeBorder} !important; }
    .divider { border-color: ${dark.border} !important; }
  }
  [data-ogsb] .code { background-color: ${light.codeBox} !important; border-color: ${light.codeBorder} !important; }
  [data-ogsc] .code { color: ${light.codeText} !important; }
  [data-ogsc] .text { color: ${dark.text} !important; }
  [data-ogsc] .secondary { color: ${dark.secondary} !important; }
  [data-ogsc] .header-text { color: ${dark.headerText} !important; }
  [data-ogsb] .header { background-color: ${dark.header} !important; }
  [data-ogsb] .button { background-color: ${light.button} !important; }
  [data-ogsc] .button { color: ${light.buttonText} !important; }
`;

export const textStyle: CSSProperties = { color: light.text, fontSize: 15, margin: '0 0 8px' };
export const secondaryStyle: CSSProperties = { color: light.secondary, fontSize: 14, margin: 0 };

interface EmailLayoutProps {
  language?: AppLanguage;
  preview: string;
  heading: string;
  children: ReactNode;
}

/** Shared frame: brand header, heading, content, brand footer — light, dark and Outlook-safe. */
export function EmailLayout({ language = 'en', preview, heading, children }: EmailLayoutProps) {
  return (
    <Html lang={language}>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{schemeCss}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className="page"
        style={{ backgroundColor: light.page, margin: 0, padding: '24px 0', fontFamily: SANS }}
      >
        <Container
          className="card"
          style={{
            backgroundColor: light.card,
            border: `1px solid ${light.border}`,
            borderRadius: 16,
            maxWidth: 480,
            overflow: 'hidden',
          }}
        >
          <Section
            className="header"
            style={{ backgroundColor: light.header, padding: '18px 28px' }}
          >
            <Text
              className="header-text"
              style={{ color: light.headerText, fontSize: 20, fontWeight: 700, margin: 0 }}
            >
              {brand.name}
            </Text>
          </Section>
          <Section style={{ padding: '28px' }}>
            <Heading
              as="h1"
              className="text"
              style={{ color: light.text, fontSize: 20, margin: '0 0 8px' }}
            >
              {heading}
            </Heading>
            {children}
          </Section>
          <Section
            className="divider"
            style={{ borderTop: `1px solid ${light.border}`, padding: '14px 28px' }}
          >
            <Text className="secondary" style={{ color: light.secondary, fontSize: 13, margin: 0 }}>
              {emailStrings(language).footer}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** Expiry/time shown in India time, the team's timezone, in the email's language. */
export function formatIst(date: Date, withDate = false, language: AppLanguage = 'en'): string {
  const formatted = new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata',
    ...(withDate ? { day: 'numeric', month: 'short', year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${formatted} IST`;
}
