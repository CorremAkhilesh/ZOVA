import type { PublicProfile } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { groupAbilities } from '@/features/groups/rules';
import { SelectionBar } from '@/features/messages/components/SelectionBar';
import { useMessageUi } from '@/features/messages/store';
import { useBlockToggle, useIsBlocked } from '@/features/moderation/blocks';
import { personOf } from '@/features/moderation/components/ModerationEntries';
import type { ChatSummary } from '../types';
import { Composer } from './Composer';

/** Why this person cannot write here, if they cannot. The server refuses anyway. */
export function footerNotice(chat: ChatSummary): string | null {
  if (chat.deactivated) return 'people.deactivated';
  if (!chat.group) return null;
  if (!chat.group.active) return 'groups.noLongerMember';
  return groupAbilities(chat.group).send ? null : 'groups.onlyAdminsSend';
}

/** In place of the composer while I have blocked the other person. */
function BlockedBanner({ person }: { person: PublicProfile }) {
  const { t } = useTranslation();
  const toggle = useBlockToggle();
  return (
    <button
      type="button"
      onClick={() => toggle.mutate({ user: person, block: false })}
      disabled={toggle.isPending}
      className="glass w-full border-t px-4 py-3 text-center text-sm text-text-muted hover:text-text"
    >
      {t('blocks.banner')}
    </button>
  );
}

export function ChatFooter({
  chat,
  onSent,
  onFiles,
}: {
  chat: ChatSummary;
  onSent: () => void;
  onFiles: (files: File[]) => void;
}) {
  const { t } = useTranslation();
  const notice = footerNotice(chat);
  const selecting = useMessageUi((state) => state.selecting === chat.id);
  const person = personOf(chat);
  const blocked = useIsBlocked(person?.id);
  if (selecting) return <SelectionBar />;
  if (notice) {
    return (
      <p className="glass border-t px-4 py-3 text-center text-sm text-text-muted">{t(notice)}</p>
    );
  }
  if (blocked && person) return <BlockedBanner person={person} />;
  return <Composer chatId={chat.id} onSent={onSent} onFiles={onFiles} />;
}
