import { Button, Text } from '@react-email/components';
import { render } from '@react-email/render';
import type { AppLanguage } from '@zuvo/protocol';
import type { DeviceInfo } from '../../security/devices.ts';
import type { MailMessage } from '../mailer.ts';
import {
  EMAIL_COLORS,
  EmailLayout,
  formatIst,
  secondaryStyle,
  textStyle,
} from './email-layout.tsx';
import { emailStrings } from './email-strings.ts';

const { light } = EMAIL_COLORS;

interface LoginAlertProps {
  device: DeviceInfo;
  signedInAt: Date;
  notMeUrl: string;
  /** The account's language; English by default. */
  language?: AppLanguage;
}

function detailLines({ device, signedInAt, language = 'en' }: Omit<LoginAlertProps, 'notMeUrl'>) {
  const s = emailStrings(language).loginAlert;
  return [
    s.device(device.deviceType),
    s.browser(device.browser),
    s.os(device.os),
    s.time(formatIst(signedInAt, true, language)),
  ];
}

export function LoginAlertEmail(props: LoginAlertProps) {
  const language = props.language ?? 'en';
  const s = emailStrings(language).loginAlert;
  return (
    <EmailLayout language={language} preview={s.subject} heading={s.heading}>
      <Text className="text" style={{ ...textStyle, margin: '0 0 16px' }}>
        {s.intro}
      </Text>
      {detailLines(props).map((line) => (
        <Text key={line} className="text" style={{ ...textStyle, margin: '0 0 4px' }}>
          {line}
        </Text>
      ))}
      <Text className="text" style={{ ...textStyle, margin: '16px 0 16px' }}>
        {s.ifYou}
      </Text>
      <Button
        href={props.notMeUrl}
        className="button"
        style={{
          backgroundColor: light.button,
          borderRadius: 10,
          color: light.buttonText,
          display: 'inline-block',
          fontSize: 15,
          fontWeight: 700,
          padding: '12px 20px',
          textDecoration: 'none',
        }}
      >
        {s.button}
      </Button>
      <Text className="secondary" style={{ ...secondaryStyle, margin: '16px 0 0' }}>
        {s.note}
      </Text>
    </EmailLayout>
  );
}

/** "New sign-in" alert with a single-use "This wasn't me" link, in the account's language. */
export async function loginAlertEmail(to: string, props: LoginAlertProps): Promise<MailMessage> {
  const strings = emailStrings(props.language ?? 'en');
  const s = strings.loginAlert;
  const text = [
    s.intro,
    '',
    ...detailLines(props),
    '',
    s.ifYou,
    s.linkLine,
    props.notMeUrl,
    '',
    strings.footer,
  ].join('\n');
  return { to, subject: s.subject, html: await render(<LoginAlertEmail {...props} />), text };
}
