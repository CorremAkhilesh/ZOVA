import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from './button';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

interface DialogContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  title: string;
  description?: string | undefined;
  /** Visually hide the title (it is still announced). */
  hideTitle?: boolean;
  /** For a dialog with its own close button. */
  hideClose?: boolean;
}

/** Centered modal with focus trap, Escape to close and a labelled close button. */
function DialogContent({
  title,
  description,
  hideTitle,
  hideClose,
  className,
  children,
  ...props
}: DialogContentProps) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl border bg-elevated p-5 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <DialogPrimitive.Title className={cn('text-lg font-semibold', hideTitle && 'sr-only')}>
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.close')}>
                <X className="size-4" aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          )}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * For DialogContent's className: below the desktop layout the dialog fills the screen like a page
 * (clear of notches and the home bar) instead of floating as a card.
 */
const FULL_SCREEN_ON_PHONE =
  'max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:px-4 max-md:pt-[max(1rem,env(safe-area-inset-top))] max-md:pb-[max(1rem,env(safe-area-inset-bottom))]';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  danger?: boolean;
}

/** "Are you sure?" for destructive actions. */
function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent title={props.title} description={props.description}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </DialogClose>
          <Button
            variant={props.danger ? 'danger' : 'default'}
            disabled={props.pending}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmDialog, Dialog, DialogClose, DialogContent, DialogTrigger, FULL_SCREEN_ON_PHONE };
