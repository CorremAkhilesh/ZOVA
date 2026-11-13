import { Text } from '@react-email/components';
import { render } from '@react-email/render';
import { brand } from '@zuvo/config';
import { OTP_TTL_SECONDS } from '@zuvo/protocol';
import type { MailMessage } from '../mailer.ts';
import {
  EMAIL_COLORS,
  EmailLayout,
  formatIst,
  MONO,
  secondaryStyle,
  textStyle,
} from './email-layout.tsx';

export { EMAIL_COLORS, EMAIL_CONTRAST_PAIRS } from './email-layout.tsx';

const MINUTES = OTP_TTL_SECONDS / 60;
const { light } = EMAIL_COLORS;

interface OtpEmailProps {
  code: string;
  expiresAt: Date;
}

export function OtpEmail({ code, expiresAt }: OtpEmailProps) {
  return (
    <EmailLayout
      preview={`${code} is your ${brand.name} verification code`}
      heading="Your verification code"
    >
      <Text className="secondary" style={{ ...secondaryStyle, fontSize: 15, margin: '0 0 20px' }}>
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
      <Text className="text" style={textStyle}>
        {`This code expires in ${MINUTES} minutes (at ${formatIst(expiresAt)}). Only the most recent code works.`}
      </Text>
      <Text className="secondary" style={secondaryStyle}>
        If you didn’t request this, ignore this email. Nobody can sign in without the code.
      </Text>
    </EmailLayout>
  );
}

export function otpEmailText(code: string, expiresAt: Date): string {
  return [
    `Your ${brand.name} verification code is: ${code}`,
    '',
    `This code expires in ${MINUTES} minutes (at ${formatIst(expiresAt)}). Only the most recent code works.`,
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
