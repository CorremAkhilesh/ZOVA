import { brand } from '@zuvo/config';
import { Mail } from 'lucide-react';
import { useHelpText } from '../content';
import { HelpPage, HelpSection, Points } from './HelpPage';

/** /help/contact: the support address, and what to include when something is wrong. */
export function ContactPage() {
  const { text, list } = useHelpText();
  const href = `mailto:${brand.supportEmail}?subject=${encodeURIComponent(text('contact.subject'))}`;
  const mailLink = (
    <a
      href={href}
      className="inline-flex items-center gap-2 font-semibold text-brand-text underline-offset-4 hover:underline"
    >
      <Mail className="size-4" aria-hidden />
      {brand.supportEmail}
    </a>
  );
  return (
    <HelpPage title={text('cards.contact.title')} description={text('contact.subtitle')}>
      <HelpSection id="contact-help" title={text('contact.helpTitle')}>
        <p>{text('contact.helpText')}</p>
        <p>{mailLink}</p>
      </HelpSection>
      <HelpSection id="contact-problem" title={text('contact.problemTitle')}>
        <p>{text('contact.problemText')}</p>
        <Points items={list('contact.problemPoints')} />
        <p className="text-text-muted">{text('contact.abuseText')}</p>
      </HelpSection>
    </HelpPage>
  );
}
