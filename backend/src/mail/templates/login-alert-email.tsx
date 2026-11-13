import { Button, Text } from '@react-email/components';
import { render } from '@react-email/render';
import { brand } from '@zuvo/config';
import type { DeviceInfo } from '../../security/devices.ts';
import type { MailMessage } from '../mailer.ts';
import {
  EMAIL_COLORS,
  EmailLayout,
  formatIst,
  secondaryStyle,
  textStyle,
} from './email-layout.tsx';

const { light } = EMAIL_COLORS;

interface LoginAlertProps {
  device: DeviceInfo;
  signedInAt: Date;
  notMeUrl: string;
}

function detailLines({ device, signedInAt }: Pick<LoginAlertProps, 'device' | 'signedInAt'>) {
  return [
    `Device: ${device.deviceType === 'unknown' ? 'Unknown device' : device.deviceType}`,
    `Browser: ${device.browser}`,
    `Operating system: ${device.os}`,
    `Time: ${formatIst(signedInAt, true)}`,
  ];
}

export function LoginAlertEmail({ device, signedInAt, notMeUrl }: LoginAlertProps) {
  return (
    <EmailLayout
      preview={`New sign-in to your ${brand.name} account`}
      heading="New sign-in to your account"
    >
      <Text className="text" style={{ ...textStyle, margin: '0 0 16px' }}>
        {`Your ${brand.name} account was just used to sign in on a new device.`}
      </Text>
      {detailLines({ device, signedInAt }).map((line) => (
        <Text key={line} className="text" style={{ ...textStyle, margin: '0 0 4px' }}>
          {line}
        </Text>
      ))}
      <Text className="text" style={{ ...textStyle, margin: '16px 0 16px' }}>
        If this was you, you don’t need to do anything.
      </Text>
      <Button
        href={notMeUrl}
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
        This wasn’t me — sign out everywhere
      </Button>
      <Text className="secondary" style={{ ...secondaryStyle, margin: '16px 0 0' }}>
        The button signs your account out on every device. The link works once and expires in 7
        days.
      </Text>
    </EmailLayout>
  );
}

/** "New sign-in" alert with a single-use "This wasn't me" link. */
export async function loginAlertEmail(to: string, props: LoginAlertProps): Promise<MailMessage> {
  const text = [
    `Your ${brand.name} account was just used to sign in on a new device.`,
    '',
    ...detailLines(props),
    '',
    'If this was you, you don’t need to do anything.',
    'If it wasn’t you, open this link to sign out everywhere (works once, expires in 7 days):',
    props.notMeUrl,
    '',
    `${brand.name} — ${brand.tagline}`,
  ].join('\n');
  return {
    to,
    subject: `New sign-in to your ${brand.name} account`,
    html: await render(<LoginAlertEmail {...props} />),
    text,
  };
}
