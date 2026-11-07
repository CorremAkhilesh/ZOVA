import type { PublicProfile } from '@zuvo/protocol';
import { Flag, ShieldBan, ShieldCheck } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import type { ChatSummary } from '@/features/chats/types';
import { useBlockToggle, useIsBlocked } from '../blocks';
import { useModeration } from '../store';

const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-background';

/** The other person of a direct chat, as far as the list knows them. */
export const personOf = (chat: ChatSummary): PublicProfile | null =>
  chat.kind === 'personal' && chat.otherUserId
    ? {
        id: chat.otherUserId,
        displayName: chat.name,
        username: chat.username ?? null,
        about: chat.about ?? null,
        avatar: chat.avatarSrc ? { small: chat.avatarSrc, large: chat.avatarSrc } : null,
        deactivated: chat.deactivated === true,
      }
    : null;

/** Block / Unblock and Report, at the end of a chat's menu. Saved Messages has neither. */
export function ModerationEntries({ chat }: { chat: ChatSummary }) {
  const { t } = useTranslation();
  const person = personOf(chat);
  const blocked = useIsBlocked(person?.id);
  const toggle = useBlockToggle();
  const { askBlock, openReport } = useModeration.getState();
  if (chat.kind === 'saved') return null;
  return (
    <>
      <DropdownMenu.Separator className="my-1 h-px bg-border" />
      {person ? (
        <DropdownMenu.Item
          className={ITEM}
          onSelect={() =>
            blocked ? toggle.mutate({ user: person, block: false }) : askBlock(person)
          }
        >
          {blocked ? (
            <ShieldCheck className="size-4" aria-hidden />
          ) : (
            <ShieldBan className="size-4" aria-hidden />
          )}
          {t(blocked ? 'blocks.unblockName' : 'blocks.blockName', { name: person.displayName })}
        </DropdownMenu.Item>
      ) : null}
      <DropdownMenu.Item
        className={ITEM}
        onSelect={() =>
          person
            ? openReport({ target: { kind: 'user', userId: person.id, chatId: chat.id }, person })
            : openReport({
                target: { kind: 'group', chatId: chat.id },
                person: null,
                groupName: chat.name,
              })
        }
      >
        <Flag className="size-4" aria-hidden />
        {t(person ? 'report.reportName' : 'report.reportGroup', { name: chat.name })}
      </DropdownMenu.Item>
    </>
  );
}
