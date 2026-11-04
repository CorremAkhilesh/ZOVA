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
import { render } from '@react-email/render';
import { brand } from '@zuvo/config';
import { OTP_TTL_SECONDS } from '@zuvo/protocol';
import type { MailMessage } from '../mailer.ts';

const MINUTES = OTP_TTL_SECONDS / 60;

/**
 * Email-safe palette. Email clients ignore CSS variables and some (Outlook) recolor messages, so
 * every pair is explicit and high-contrast — see EMAIL_CONTRAST_PAIRS (tested ≥ 4.5:1, mostly ≥ 7:1).
 * The code is near-black on white (light / Outlook forced colors) or near-white on dark slate
 * (client dark mode): never brand-on-brand.
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
  },
} as const;

type Palette = (typeof EMAIL_COLORS)[keyof typeof EMAIL_COLORS];

/** Every text/background pair the template uses, per scheme (asserted in tests). */
export const EMAIL_CONTRAST_PAIRS = (['light', 'dark'] as const).flatMap((scheme) => {
  const c: Palette = EMAIL_COLORS[scheme];
  return [
    { scheme, name: 'text on card', fg: c.text, bg: c.card },
    { scheme, name: 'secondary on card', fg: c.secondary, bg: c.card },
    { scheme, name: 'code on code box', fg: c.codeText, bg: c.codeBox },
    { scheme, name: 'header text on header', fg: c.headerText, bg: c.header },
    { scheme, name: 'text on page', fg: c.text, bg: c.page },
  ];
});

const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";
const SANS = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Expiry shown in India time, the team's timezone. */
function formatExpiry(expiresAt: Date): string {
  const time = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  }).format(expiresAt);
  return `${time} IST`;
}

const { light, dark } = EMAIL_COLORS;

/**
 * - prefers-color-scheme: Apple Mail, iOS Mail, Outlook for Mac, some webmail.
 * - [data-ogsc]/[data-ogsb]: the attributes the new Outlook / Outlook.com add when they recolor a
 *   message for dark mode. We pin the code box to near-black on white so it can never end up
 *   purple-on-purple or grey-on-grey.
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
`;

interface OtpEmailProps {
  code: string;
  expiresAt: Date;
}

export function OtpEmail({ code, expiresAt }: OtpEmailProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{schemeCss}</style>
      </Head>
      <Preview>{`${code} is your ${brand.name} verification code`}</Preview>
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
              Your verification code
            </Heading>
            <Text
              className="secondary"
              style={{ color: light.secondary, fontSize: 15, margin: '0 0 20px' }}
            >
              {`Enter this code in ${brand.name} to sign in.`}
            </Text>
            {/* One text node: copies/selects as a single string; letter-spacing only spaces it visually. */}
            <Text
              className="code"
              style={{
                backgroundColor: light.codeBox,
                border: `2px solid ${light.codeBorder}`,
                borderRadius: 12,
                color: light.codeText,
                fontFamily: MONO,
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: '0.3em',
                lineHeight: '48px',
                margin: '0 0 20px',
                padding: '12px 0 12px 0.3em',
                textAlign: 'center',
              }}
            >
              {code}
            </Text>
            <Text className="text" style={{ color: light.text, fontSize: 15, margin: '0 0 8px' }}>
              {`This code expires in ${MINUTES} minutes (at ${formatExpiry(expiresAt)}). Only the most recent code works.`}
            </Text>
            <Text className="secondary" style={{ color: light.secondary, fontSize: 14, margin: 0 }}>
              If you didn’t request this, ignore this email. Nobody can sign in without the code.
            </Text>
          </Section>
          <Section
            className="divider"
            style={{ borderTop: `1px solid ${light.border}`, padding: '14px 28px' }}
          >
            <Text className="secondary" style={{ color: light.secondary, fontSize: 13, margin: 0 }}>
              {`${brand.name} — ${brand.tagline}`}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function otpEmailText(code: string, expiresAt: Date): string {
  return [
    `Your ${brand.name} verification code is: ${code}`,
    '',
    `This code expires in ${MINUTES} minutes (at ${formatExpiry(expiresAt)}). Only the most recent code works.`,
    '',
    'If you didn’t request this, ignore this email. Nobody can sign in without the code.',
    '',
    `${brand.name} — ${brand.tagline}`,
  ].join('\n');
}

/** Builds the full OTP email: subject "<code> is your Zuvo verification code", HTML and plain text. */
export async function otpEmail(to: string, code: string, expiresAt: Date): Promise<MailMessage> {
  return {
    to,
    subject: `${code} is your ${brand.name} verification code`,
    html: await render(<OtpEmail code={code} expiresAt={expiresAt} />),
    text: otpEmailText(code, expiresAt),
  };
}
