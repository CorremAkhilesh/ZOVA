import { Bookmark } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { ChatSummary } from '../types';

/** A person's photo or initials; Saved Messages gets its own mark. */
export function ChatAvatar({
  chat,
  online = false,
  className,
}: {
  chat: ChatSummary;
  online?: boolean;
  className?: string;
}) {
  if (chat.kind === 'saved') {
    return (
      <span
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground',
          className,
        )}
      >
        <Bookmark className="size-5" aria-hidden />
      </span>
    );
  }
  return (
    <Avatar
      name={chat.name}
      src={chat.avatarSrc}
      online={online}
      {...(className ? { className } : {})}
    />
  );
}
