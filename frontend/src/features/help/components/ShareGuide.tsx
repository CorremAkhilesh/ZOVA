import { useHelpText } from '../content';
import { HelpPage, HelpSection, Points, Steps } from './HelpPage';

/**
 * /help/share: "Share to Zuvo" from other apps. Android and desktop Chrome/Edge list the installed
 * app in their share menu; iPhone does not let web apps in, so there it is the 📎 button.
 */
export function ShareGuide() {
  const { text, list } = useHelpText();
  return (
    <HelpPage title={text('cards.share.title')} description={text('share.subtitle')}>
      <HelpSection id="share-android" title={text('share.android.title')}>
        <Steps items={list('share.android.steps')} label={text('share.android.title')} />
      </HelpSection>
      <HelpSection id="share-desktop" title={text('share.desktop.title')}>
        <Steps items={list('share.desktop.steps')} label={text('share.desktop.title')} />
        <p className="text-text-muted">{text('share.desktop.note')}</p>
      </HelpSection>
      <HelpSection id="share-ios" title={text('share.ios.title')}>
        <p>{text('share.ios.why')}</p>
        <Steps items={list('share.ios.steps')} label={text('share.ios.title')} />
      </HelpSection>
      <HelpSection id="share-missing" title={text('share.missing.title')}>
        <Points items={list('share.missing.points')} />
      </HelpSection>
    </HelpPage>
  );
}
