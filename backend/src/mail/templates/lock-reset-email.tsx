import { Text } from '@react-email/components';
import { render } from '@react-email/render';
import { brand } from '@zuvo/config';
import type { MailMessage } from '../mailer.ts';
import {
  EMAIL_COLORS,
  EmailLayout,
  formatIst,
  MONO,
  secondaryStyle,
  textStyle,
} from './email-layout.tsx';

const { light } = EMAIL_COLORS;

interface LockResetProps {
  code: string;
  expiresAt: Date;
  minutes: number;
}

const expiryLine = ({ expiresAt, minutes }: Omit<LockResetProps, 'code'>) =>
  `This code expires in ${minutes} minutes (at ${formatIst(expiresAt)}). Only the most recent code works.`;
const IGNORE =
  'If you didn’t ask for this, ignore this email: your PIN stays as it is. Nobody can reset it without the code.';

export function LockResetEmail(props: LockResetProps) {
  return (
    <EmailLayout
      preview={`${props.code} is your ${brand.name} PIN reset code`}
      heading="Reset your PIN"
    >
      <Text className="secondary" style={{ ...secondaryStyle, fontSize: 15, margin: '0 0 20px' }}>
        {`Enter this code in ${brand.name} to remove your PIN. Your locked chats stay locked, and you will set a new PIN.`}
      </Text>
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
        {props.code}
      </Text>
      <Text className="text" style={textStyle}>
        {expiryLine(props)}
      </Text>
      <Text className="secondary" style={secondaryStyle}>
        {IGNORE}
      </Text>
    </EmailLayout>
  );
}

/** "Forgot PIN": subject "<code> is your Zuvo PIN reset code", HTML and plain text. */
export async function lockResetEmail(to: string, props: LockResetProps): Promise<MailMessage> {
  return {
    to,
    subject: `${props.code} is your ${brand.name} PIN reset code`,
    html: await render(<LockResetEmail {...props} />),
    text: [
      `Your ${brand.name} PIN reset code is: ${props.code}`,
      '',
      expiryLine(props),
      '',
      IGNORE,
      '',
      `${brand.name} — ${brand.tagline}`,
    ].join('\n'),
  };
}
