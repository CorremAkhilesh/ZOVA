import { Text } from '@react-email/components';
import { render } from '@react-email/render';
import type { AppLanguage } from '@zuvo/protocol';
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

const { light } = EMAIL_COLORS;

interface LockResetProps {
  code: string;
  expiresAt: Date;
  minutes: number;
  /** The account's language; English by default. */
  language?: AppLanguage;
}

const expiryLine = ({ expiresAt, minutes, language = 'en' }: Omit<LockResetProps, 'code'>) =>
  emailStrings(language).lockReset.expiry(minutes, formatIst(expiresAt, false, language));

export function LockResetEmail(props: LockResetProps) {
  const language = props.language ?? 'en';
  const s = emailStrings(language).lockReset;
  return (
    <EmailLayout language={language} preview={s.subject(props.code)} heading={s.heading}>
      <Text className="secondary" style={{ ...secondaryStyle, fontSize: 15, margin: '0 0 20px' }}>
        {s.intro}
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
        {s.ignore}
      </Text>
    </EmailLayout>
  );
}

/** "Forgot PIN": subject "<code> is your Zuvo PIN reset code", HTML and plain text. */
export async function lockResetEmail(to: string, props: LockResetProps): Promise<MailMessage> {
  const strings = emailStrings(props.language ?? 'en');
  const s = strings.lockReset;
  return {
    to,
    subject: s.subject(props.code),
    html: await render(<LockResetEmail {...props} />),
    text: [s.codeLine(props.code), '', expiryLine(props), '', s.ignore, '', strings.footer].join(
      '\n',
    ),
  };
}
