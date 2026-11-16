import { Text } from '@react-email/components';
import { render } from '@react-email/render';
import { type AppLanguage, OTP_TTL_SECONDS } from '@zuvo/protocol';
import type { MailMessage } from '../mailer.ts';
import {
  EMAIL_COLORS,
  EmailLayout,
  formatIst,
  MONO,
  secondaryStyle,
  textStyle,
} from './email-layout.tsx';
import { emailStrings } from './email-strings.ts';

export { EMAIL_COLORS, EMAIL_CONTRAST_PAIRS } from './email-layout.tsx';

const MINUTES = OTP_TTL_SECONDS / 60;
const { light } = EMAIL_COLORS;

interface OtpEmailProps {
  code: string;
  expiresAt: Date;
  language?: AppLanguage;
}

export function OtpEmail({ code, expiresAt, language = 'en' }: OtpEmailProps) {
  const s = emailStrings(language).otp;
  return (
    <EmailLayout language={language} preview={s.subject(code)} heading={s.heading}>
      <Text className="secondary" style={{ ...secondaryStyle, fontSize: 15, margin: '0 0 20px' }}>
        {s.intro}
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
      <Text className="text" style={textStyle}>
        {s.expiry(MINUTES, formatIst(expiresAt, false, language))}
      </Text>
      <Text className="secondary" style={secondaryStyle}>
        {s.ignore}
      </Text>
    </EmailLayout>
  );
}

export function otpEmailText(code: string, expiresAt: Date, language: AppLanguage = 'en'): string {
  const strings = emailStrings(language);
  const s = strings.otp;
  return [
    s.codeLine(code),
    '',
    s.expiry(MINUTES, formatIst(expiresAt, false, language)),
    '',
    s.ignore,
    '',
    strings.footer,
  ].join('\n');
}

/**
 * The full OTP email (subject "<code> is your Zuvo verification code"), HTML and plain text, in
 * the account's language (see auth.ts for addresses without one).
 */
export async function otpEmail(
  to: string,
  code: string,
  expiresAt: Date,
  language: AppLanguage = 'en',
): Promise<MailMessage> {
  return {
    to,
    subject: emailStrings(language).otp.subject(code),
    html: await render(<OtpEmail code={code} expiresAt={expiresAt} language={language} />),
    text: otpEmailText(code, expiresAt, language),
  };
}
