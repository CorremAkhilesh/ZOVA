import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatBytes } from '@/features/media/process';
import { useAppConfig } from '@/features/media/use-app-config';
import { type BrowserFamily, browserFamily } from '@/features/notifications/support';
import { useHelpText } from '../content';
import { useKnownSignedIn } from '../signed-in';
import { Accordion, type AccordionItem } from './Accordion';
import { HelpPage, Points } from './HelpPage';

const MIC_ORDER: readonly BrowserFamily[] = ['chromium', 'firefox', 'safari-mac', 'ios'];

function GoTo({
  to,
  children,
}: {
  to: '/settings/notifications' | '/settings/devices' | '/help/install';
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 font-medium text-brand-text underline-offset-4 hover:underline"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function Microphone() {
  const { text } = useHelpText();
  const mine = browserFamily();
  const order = [mine, ...MIC_ORDER.filter((family) => family !== mine)];
  return (
    <>
      <p>{text('faq.microphone.intro')}</p>
      <Points items={order.map((family) => text(`faq.microphone.${family}`))} />
      <p className="text-text-muted">{text('faq.microphone.system')}</p>
    </>
  );
}

function Storage() {
  const { text, list, language } = useHelpText();
  // Only asked for when signed in: the server answers signed-in people only, and Help is public.
  const signedIn = useKnownSignedIn();
  const maxBytes = useAppConfig({ enabled: signedIn })?.media.maxFileBytes;
  const points = list('faq.storage.points', {
    size: maxBytes ? formatBytes(maxBytes, language) : '',
  });
  if (!maxBytes) points.splice(points.length - 1, 1, text('faq.storage.sizeUnknown'));
  return <Points items={points} />;
}

/** /help/faq: common questions as an accordion. */
export function FaqPage() {
  const { text, list } = useHelpText();
  const items: AccordionItem[] = [
    { id: 'otp', title: text('faq.otp.q'), content: <Points items={list('faq.otp.points')} /> },
    { id: 'session', title: text('faq.session.q'), content: <p>{text('faq.session.a')}</p> },
    {
      id: 'notifications',
      title: text('faq.notifications.q'),
      content: (
        <>
          <Points items={list('faq.notifications.points')} />
          <p className="flex flex-wrap gap-x-5 gap-y-2">
            <GoTo to="/settings/notifications">{text('faq.notifications.open')}</GoTo>
            <GoTo to="/help/install">{text('faq.notifications.install')}</GoTo>
          </p>
        </>
      ),
    },
    { id: 'microphone', title: text('faq.microphone.q'), content: <Microphone /> },
    { id: 'storage', title: text('faq.storage.q'), content: <Storage /> },
    {
      id: 'lost',
      title: text('faq.lost.q'),
      content: (
        <>
          <Points items={list('faq.lost.points')} />
          <GoTo to="/settings/devices">{text('faq.lost.open')}</GoTo>
        </>
      ),
    },
    { id: 'account', title: text('faq.account.q'), content: <p>{text('faq.account.a')}</p> },
  ];
  return (
    <HelpPage title={text('cards.faq.title')} description={text('faq.subtitle')}>
      <Accordion items={items} />
    </HelpPage>
  );
}
