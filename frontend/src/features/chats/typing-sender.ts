/** At most one "still typing" per this long; the server forgets after 6 s without one. */
export const TYPING_REFRESH_MS = 3000;
/** No key pressed for this long means the person paused: say so before the server has to. */
export const TYPING_IDLE_MS = 5000;

type Send = (typing: boolean) => void;

/** Turns keystrokes in one chat into a few typing:start / typing:stop events. */
export class TypingSender {
  private readonly send: Send;
  private readonly now: () => number;
  private active = false;
  private lastStart = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(send: Send, now: () => number = Date.now) {
    this.send = send;
    this.now = now;
  }

  /** The text changed. */
  input(hasText: boolean): void {
    if (!hasText) {
      this.stop();
      return;
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), TYPING_IDLE_MS);
    if (this.active && this.now() - this.lastStart < TYPING_REFRESH_MS) return;
    this.active = true;
    this.lastStart = this.now();
    this.send(true);
  }

  /** Sent, left the field, changed chat, or paused. Says nothing if nothing was announced. */
  stop(): void {
    clearTimeout(this.idleTimer);
    if (!this.active) return;
    this.active = false;
    this.send(false);
  }
}
