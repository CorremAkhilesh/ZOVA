import { Download } from 'lucide-react';
import { soundUrl } from '@/features/notifications/sound';
import { useHelpText } from '../content';
import { HelpPage, HelpSection, Points, Steps } from './HelpPage';

/** The file name the tone downloads as: easy to find in the phone's sound picker. */
export const TONE_FILE_NAME = 'zuvo-chime.wav';

/**
 * /help/notifications: notifications on every device. With the app closed the phone or computer
 * plays its own notification sound (browsers cannot choose one), so Android users can download our
 * chime and pick it for the app's notifications.
 */
export function NotificationsGuide() {
  const { text, list } = useHelpText();
  return (
    <HelpPage
      title={text('cards.notifications.title')}
      description={text('notifications.subtitle')}
    >
      <HelpSection id="notify-on" title={text('notifications.on.title')}>
        <Steps items={list('notifications.on.steps')} label={text('notifications.on.title')} />
      </HelpSection>
      <HelpSection id="notify-android" title={text('notifications.android.title')}>
        <p>{text('notifications.android.intro')}</p>
        <a
          href={soundUrl('chime')}
          download={TONE_FILE_NAME}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 font-medium text-brand-foreground hover:bg-brand-hover"
        >
          <Download className="size-4" aria-hidden />
          {text('notifications.android.download')}
        </a>
        <Steps
          items={list('notifications.android.steps', { file: TONE_FILE_NAME })}
          label={text('notifications.android.title')}
        />
        <p className="text-text-muted">{text('notifications.android.note')}</p>
      </HelpSection>
      <HelpSection id="notify-ios" title={text('notifications.ios.title')}>
        <Points items={list('notifications.ios.points')} />
      </HelpSection>
      <HelpSection id="notify-desktop" title={text('notifications.desktop.title')}>
        <Points items={list('notifications.desktop.points')} />
      </HelpSection>
      <HelpSection id="notify-missing" title={text('notifications.missing.title')}>
        <Points items={list('notifications.missing.points')} />
      </HelpSection>
    </HelpPage>
  );
}
