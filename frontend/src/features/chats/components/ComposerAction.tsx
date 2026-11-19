import { ChevronUp, Lock } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import type { ReactNode } from 'react';

/** What the round button next to the composer does: send what was typed, or record a voice note. */
export type ComposerActionMode = 'send' | 'mic' | 'none';

const SWAP = {
  initial: { scale: 0.5, opacity: 0, rotate: -60 },
  animate: { scale: 1, opacity: 1, rotate: 0 },
  exit: { scale: 0.5, opacity: 0, rotate: 60 },
  transition: { duration: 0.16, ease: 'easeOut' },
} as const;

interface ComposerActionProps {
  mode: ComposerActionMode;
  send: ReactNode;
  mic: ReactNode;
  /** A voice note is being held (touch): show where to slide to keep recording hands-free. */
  holding?: boolean;
}

/**
 * The round button to the right of the composer. It turns between mic and send as text or an edit
 * appears (reduced motion: a plain swap, see MotionConfig in App.tsx).
 */
export function ComposerAction({ mode, send, mic, holding = false }: ComposerActionProps) {
  if (mode === 'none') return null;
  return (
    <div className="relative grid size-12 shrink-0 place-items-center">
      {holding ? (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-full mb-2 flex flex-col items-center gap-0.5 rounded-full border bg-surface px-2 py-2 text-text-muted shadow-md"
        >
          <Lock className="size-4" />
          <ChevronUp className="size-4 motion-safe:animate-bounce" />
        </span>
      ) : null}
      <AnimatePresence initial={false} mode="popLayout">
        <m.div key={mode} className="grid place-items-center" {...SWAP}>
          {mode === 'send' ? send : mic}
        </m.div>
      </AnimatePresence>
    </div>
  );
}
