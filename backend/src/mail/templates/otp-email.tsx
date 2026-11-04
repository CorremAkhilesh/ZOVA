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
import { darkColors, lightColors } from '@zuvo/ui-tokens';
import type { MailMessage } from '../mailer.ts';

const MINUTES = OTP_TTL_SECONDS / 60;

/** Expiry shown in India time, the team's timezone. */
function formatExpiry(expiresAt: Date): string {
  const time = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  }).format(expiresAt);
  return `${time} IST`;
}

// Email clients ignore CSS variables; dark mode uses classes + prefers-color-scheme where supported.
const darkModeCss = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .bg { background-color: ${darkColors.background} !important; }
    .card { background-color: ${darkColors.surface} !important; }
    .text { color: ${darkColors.text} !important; }
    .muted { color: ${darkColors.textMuted} !important; }
    .code { background-color: ${darkColors.brandSubtle} !important; color: ${darkColors.brandText} !important; }
  }
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
        <style>{darkModeCss}</style>
      </Head>
      <Preview>{`${code} is your ${brand.name} verification code`}</Preview>
      <Body
        className="bg"
        style={{
          backgroundColor: lightColors.background,
          margin: 0,
          padding: '24px 0',
          fontFamily: 'Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <Container
          className="card"
          style={{
            backgroundColor: lightColors.surface,
            borderRadius: 16,
            maxWidth: 480,
            overflow: 'hidden',
          }}
        >
          <Section style={{ backgroundColor: brand.colors.primary, padding: '18px 28px' }}>
            <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: 700, margin: 0 }}>
              {brand.name}
            </Text>
          </Section>
          <Section style={{ padding: '28px' }}>
            <Heading
              as="h1"
              className="text"
              style={{ color: lightColors.text, fontSize: 20, margin: '0 0 8px' }}
            >
              Your verification code
            </Heading>
            <Text
              className="muted"
              style={{ color: lightColors.textMuted, fontSize: 14, margin: '0 0 20px' }}
            >
              {`Enter this code in ${brand.name} to sign in.`}
            </Text>
            <Text
              className="code"
              style={{
                backgroundColor: lightColors.brandSubtle,
                color: lightColors.brandText,
                borderRadius: 12,
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: 8,
                margin: '0 0 20px',
                padding: '14px 0',
                textAlign: 'center',
              }}
            >
              {code}
            </Text>
            <Text
              className="text"
              style={{ color: lightColors.text, fontSize: 14, margin: '0 0 8px' }}
            >
              {`This code expires in ${MINUTES} minutes (at ${formatExpiry(expiresAt)}).`}
            </Text>
            <Text
              className="muted"
              style={{ color: lightColors.textMuted, fontSize: 13, margin: 0 }}
            >
              If you didn’t request this, ignore this email. Nobody can sign in without the code.
            </Text>
          </Section>
          <Section style={{ borderTop: `1px solid ${lightColors.border}`, padding: '14px 28px' }}>
            <Text
              className="muted"
              style={{ color: lightColors.textMuted, fontSize: 12, margin: 0 }}
            >
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
    `This code expires in ${MINUTES} minutes (at ${formatExpiry(expiresAt)}).`,
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
