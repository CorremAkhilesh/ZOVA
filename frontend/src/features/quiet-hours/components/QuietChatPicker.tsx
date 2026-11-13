import { QUIET_EXCEPTION_CHATS_MAX } from '@zuvo/protocol';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { useSession } from '@/features/auth/session';
import { ChatAvatar } from '@/features/chats/components/ChatAvatar';
import { useChats } from '@/features/chats/queries';
import { toChatSummary } from '@/features/chats/view';

/** "Allow these chats": ticks chats from my list (Saved Messages never alerts, so it is left out). */
export function QuietChatPicker(props: { picked: string[]; onChange: (picked: string[]) => void }) {
  const { t } = useTranslation();
  const { picked, onChange } = props;
  const me = useSession()?.user.id ?? '';
  const rows = useChats();
  const [query, setQuery] = useState('');
  const chats = useMemo(() => {
    const labels = { saved: t('chats.saved'), unknown: t('chats.unknownPerson') };
    return (rows ?? [])
      .map((row) => toChatSummary(row, me, labels))
      .filter((chat) => chat.kind !== 'saved');
  }, [me, rows, t]);
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? chats.filter((chat) => chat.name.toLocaleLowerCase().includes(needle))
    : chats;
  const full = picked.length >= QUIET_EXCEPTION_CHATS_MAX;
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...picked, id] : picked.filter((item) => item !== id));

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('quietHours.allowChats')}</legend>
      <p className="text-xs text-text-muted">
        {t('quietHours.allowChatsHint')} {t('quietHours.picked', { count: picked.length })}
      </p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('quietHours.searchChats')}
          aria-label={t('quietHours.searchChats')}
          className="pl-9"
        />
      </div>
      {full ? (
        <p className="text-xs text-warning">
          {t('quietHours.chatLimit', { max: QUIET_EXCEPTION_CHATS_MAX })}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">{t('quietHours.noChats')}</p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl border p-1">
          {shown.map((chat) => {
            const checked = picked.includes(chat.id);
            return (
              <li key={chat.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-background">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={full && !checked}
                    onChange={(event) => toggle(chat.id, event.target.checked)}
                    className="size-4 accent-brand"
                  />
                  <ChatAvatar chat={chat} className="size-8 text-xs" />
                  <span className="min-w-0 flex-1 truncate text-sm">{chat.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
