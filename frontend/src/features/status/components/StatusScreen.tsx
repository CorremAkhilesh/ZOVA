import type { PublicProfile, StatusPerson } from '@zuvo/protocol';
import { Camera, CircleDashed, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/features/auth/session';
import { useLocalDb } from '@/features/chats/queries';
import { useIsDesktop } from '@/lib/hooks';
import { refreshStatuses, useStatusFeed } from '../feed';
import { useStatusViewer, type ViewerPerson } from '../viewer/queue';
import { StatusViewer } from '../viewer/StatusViewer';
import { MediaStatusPicker } from './MediaStatusSheet';
import { StatusEmptyPane } from './StatusEmptyPane';
import { StatusRow } from './StatusRow';
import { TextStatusEditor } from './TextStatusEditor';

const toViewer = (people: StatusPerson[]): ViewerPerson[] =>
  people.map((person) => ({ user: person.user, statuses: person.statuses, mine: false }));

/** One part of the list ("Recent updates", "Viewed updates", "Muted"), each person a row. */
function Section(props: { id: string; title: string; people: StatusPerson[] }) {
  const open = useStatusViewer((state) => state.open);
  if (props.people.length === 0) return null;
  return (
    <section aria-labelledby={props.id} className="mt-4">
      <h2
        id={props.id}
        className="px-4 pb-1 text-xs font-semibold tracking-wide text-text-muted uppercase"
      >
        {props.title}
      </h2>
      <ul aria-labelledby={props.id}>
        {props.people.map((person, index) => (
          <StatusRow
            key={person.user.id}
            user={person.user}
            statuses={person.statuses}
            muted={person.muted}
            onOpen={() => open(toViewer(props.people), index)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The Status tab: mine first, then everyone else's, newest first; muted people at the bottom.
 * Wider screens (≥768 px): the list on the left, and on the right a quiet pane until a status opens
 * (the viewer then fills the window).
 */
export function StatusScreen() {
  const isDesktop = useIsDesktop();
  if (!isDesktop) return <StatusList />;
  return (
    <div className="flex h-full min-h-0">
      <div className="glass h-full w-[22rem] shrink-0 border-r lg:w-[26rem]">
        <StatusList />
      </div>
      <StatusEmptyPane />
    </div>
  );
}

function StatusList() {
  const { t } = useTranslation();
  const db = useLocalDb();
  const feed = useStatusFeed();
  const session = useSession();
  const open = useStatusViewer((state) => state.open);
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (db) void refreshStatuses(db);
  }, [db]);

  const me: PublicProfile | null = session
    ? {
        id: session.user.id,
        displayName: session.user.displayName ?? session.user.email,
        username: session.user.username,
        about: session.user.about,
        avatar: session.user.avatar,
        deactivated: false,
      }
    : null;
  const people = feed?.people ?? [];
  const recent = people.filter((p) => !p.muted && p.statuses.some((s) => !s.viewed));
  const viewed = people.filter((p) => !p.muted && p.statuses.every((s) => s.viewed));
  const muted = people.filter((p) => p.muted);
  const mine = feed?.mine ?? [];

  return (
    <section aria-labelledby="status-title" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-4 pt-4 pb-2">
        <h1 id="status-title" className="flex-1 text-xl font-bold tracking-tight">
          {t('updates.title')}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('updates.newText')}
          onClick={() => setWriting(true)}
        >
          <Pencil className="size-5" aria-hidden />
        </Button>
        <MediaStatusPicker />
      </header>
      <ScrollArea className="min-h-0 flex-1 pb-4">
        <ul aria-label={t('updates.myStatus')}>
          {me ? (
            <StatusRow
              user={me}
              statuses={mine}
              mine
              onOpen={() =>
                mine.length > 0
                  ? open([{ user: me, statuses: mine, mine: true }], 0)
                  : setWriting(true)
              }
            />
          ) : null}
        </ul>
        {feed === undefined ? (
          <div role="status" aria-label={t('common.loading')} className="space-y-2 p-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : null}
        <Section id="status-recent" title={t('updates.recent')} people={recent} />
        <Section id="status-viewed" title={t('updates.viewed')} people={viewed} />
        <Section id="status-muted" title={t('updates.muted')} people={muted} />
        {feed && people.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xs space-y-2 px-6 text-center text-sm text-text-muted">
            <CircleDashed className="mx-auto size-9" aria-hidden />
            <p>{t('updates.empty')}</p>
            <p className="flex items-center justify-center gap-1">
              <Camera className="size-4" aria-hidden />
              {t('updates.emptyHint')}
            </p>
          </div>
        ) : null}
      </ScrollArea>
      {writing ? <TextStatusEditor onClose={() => setWriting(false)} /> : null}
      <StatusViewer />
    </section>
  );
}
