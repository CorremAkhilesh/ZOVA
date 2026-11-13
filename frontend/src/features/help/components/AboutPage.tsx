import { Logo } from '@/components/common/Logo';
import { version } from '../../../../package.json';
import { useHelpText } from '../content';
import { whatsNewFor } from '../whats-new';
import { HelpPage, HelpSection, Points } from './HelpPage';

/** Set by vite.config.ts (YYYY-MM-DD); missing in tests. */
const BUILD_DATE: string | undefined = import.meta.env.VITE_BUILD_DATE;

/** /help/about: version, build date and what's new. */
export function AboutPage() {
  const { text, language } = useHelpText();
  const built = BUILD_DATE
    ? new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(
        new Date(BUILD_DATE),
      )
    : null;
  return (
    <HelpPage title={text('cards.about.title')} description={text('about.subtitle')}>
      <HelpSection id="about-version" title={text('about.versionTitle')}>
        <div className="flex items-center gap-4">
          <Logo className="[&_svg]:size-10" />
          <div>
            <p className="font-medium">{text('about.version', { version })}</p>
            {built ? (
              <p className="text-text-muted">{text('about.built', { date: built })}</p>
            ) : null}
          </div>
        </div>
      </HelpSection>
      <HelpSection id="about-new" title={text('about.whatsNew')}>
        <div className="space-y-5">
          {whatsNewFor(language).map((entry) => (
            <div key={entry.id} className="space-y-2">
              <h3 className="font-semibold">{entry.title}</h3>
              <Points items={entry.items} />
            </div>
          ))}
        </div>
      </HelpSection>
    </HelpPage>
  );
}
