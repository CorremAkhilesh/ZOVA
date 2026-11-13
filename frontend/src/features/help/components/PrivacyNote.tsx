import { useHelpText } from '../content';
import { HelpPage, HelpSection, Points } from './HelpPage';

const SECTIONS = [
  { id: 'store', list: 'store' },
  { id: 'protect', list: 'protect' },
  { id: 'who', list: 'who' },
  { id: 'limits', list: 'limits' },
  { id: 'lock', list: 'lock' },
] as const;

/** /help/privacy: a plain-language privacy note. */
export function PrivacyNote() {
  const { text, list } = useHelpText();
  return (
    <HelpPage title={text('cards.privacy.title')} description={text('privacy.subtitle')}>
      {SECTIONS.map((section) => (
        <HelpSection
          key={section.id}
          id={`privacy-${section.id}`}
          title={text(`privacy.${section.id}Title`)}
        >
          <Points items={list(`privacy.${section.list}`)} />
        </HelpSection>
      ))}
    </HelpPage>
  );
}
