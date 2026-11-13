import { ChevronDown } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface AccordionItem {
  id: string;
  title: string;
  content: ReactNode;
}

/**
 * WAI-ARIA accordion: each title is a button (aria-expanded, aria-controls) inside an h2, each
 * answer a labelled region. Enter/Space toggle; ↑ ↓ Home End move between the titles.
 */
export function Accordion({
  items,
  initiallyOpen,
}: {
  items: AccordionItem[];
  initiallyOpen?: string;
}) {
  const baseId = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(initiallyOpen ? [initiallyOpen] : []),
  );
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = items.length;
    const moves: Record<string, number> = {
      ArrowDown: (index + 1) % count,
      ArrowUp: (index - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    buttons.current[target]?.focus();
  };

  return (
    <div className="divide-y overflow-hidden rounded-2xl border bg-surface shadow-sm">
      {items.map((item, index) => {
        const expanded = open.has(item.id);
        const buttonId = `${baseId}-${item.id}-button`;
        const panelId = `${baseId}-${item.id}-panel`;
        return (
          <div key={item.id}>
            <h2 className="text-base font-semibold">
              <button
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                id={buttonId}
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className="flex w-full items-center gap-3 px-5 py-4 text-start hover:bg-background focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              >
                <span className="min-w-0 flex-1">{item.title}</span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 text-text-muted transition-transform',
                    expanded && 'rotate-180',
                  )}
                />
              </button>
            </h2>
            <section
              id={panelId}
              aria-labelledby={buttonId}
              hidden={!expanded}
              className="space-y-3 px-5 pb-5 text-sm leading-relaxed"
            >
              {item.content}
            </section>
          </div>
        );
      })}
    </div>
  );
}
