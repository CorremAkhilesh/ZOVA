import { Link2 } from 'lucide-react';
import type { ChatMessage } from '@/features/chats/types';
import { findLinks } from '@/features/formatting/links';
import { toPlainText } from '@/features/formatting/parse';

/** One message in chat info → Links: its preview's title, or the link itself, opening the page. */
export function LinkRow({ message }: { message: ChatMessage }) {
  const url =
    message.linkPreview?.url ??
    findLinks(message.text).find((match) => match.node.kind === 'url')?.node.href;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const title = message.linkPreview?.title ?? url;
  const site = message.linkPreview?.siteName ?? new URL(url).hostname;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="flex h-[68px] items-center gap-3 rounded-xl border bg-surface px-3 hover:bg-background"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-subtle text-brand-text">
        <Link2 className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-text-muted">
          {site} · {toPlainText(message.text)}
        </span>
      </span>
    </a>
  );
}
