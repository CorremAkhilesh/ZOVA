import { Mic } from 'lucide-react';
import { type PointerEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { holdGesture } from '../permission';

interface MicButtonProps {
  disabled?: boolean;
  /** A click, keyboard press, or a mouse: starts a recording that stays on. */
  onClick: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onSlideCancel: () => void;
  onSlideLock: () => void;
}

/** Click to record, or on a touch screen hold to record and let go to send. */
export function MicButton(props: MicButtonProps) {
  const { disabled, onClick, onHoldStart, onHoldEnd, onSlideCancel, onSlideLock } = props;
  const { t } = useTranslation();
  const hold = useRef<{ x: number; y: number; done: boolean } | null>(null);
  /** A touch also fires a click afterwards, which must not start a second recording. */
  const ignoreClick = useRef(false);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' || disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    hold.current = { x: event.clientX, y: event.clientY, done: false };
    ignoreClick.current = true;
    onHoldStart();
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = hold.current;
    if (!current || current.done) return;
    const gesture = holdGesture(event.clientX - current.x, event.clientY - current.y);
    if (gesture === 'hold') return;
    current.done = true;
    if (gesture === 'cancel') onSlideCancel();
    else onSlideLock();
  };
  const onPointerUp = () => {
    const current = hold.current;
    hold.current = null;
    if (current && !current.done) onHoldEnd();
  };

  return (
    <Button
      type="button"
      size="icon"
      className="touch-none rounded-full"
      disabled={disabled}
      aria-label={t('conversation.voice')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // The system took the finger away (a call, a gesture): keep what was said rather than lose it.
      onPointerCancel={() => {
        if (hold.current && !hold.current.done) onSlideLock();
        hold.current = null;
      }}
      onClick={() => {
        if (ignoreClick.current) {
          ignoreClick.current = false;
          return;
        }
        onClick();
      }}
    >
      <Mic className="size-5" />
    </Button>
  );
}
