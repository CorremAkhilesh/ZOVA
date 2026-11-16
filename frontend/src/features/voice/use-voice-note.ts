import { useCallback, useRef, useState } from 'react';
import { useAppConfig } from '@/features/media/use-app-config';
import { useMessageUi } from '@/features/messages/store';
import { scheduleMedia } from '@/features/scheduled/schedule-media';
import { useSyncStore } from '@/features/sync/store';
import { hasExplainedMic, readMicPermission, rememberMicExplained } from './permission';
import { useVoiceRecorder, type VoiceRecording } from './use-voice-recorder';

/** Used until the server's setting has arrived. The server still decides. */
const DEFAULT_MAX_SECONDS = 900;

/** The composer's voice note: permission first, then the recording, then the same outbox as files. */
export function useVoiceNote(chatId: string, onSent: () => void) {
  const config = useAppConfig();
  const maxSeconds = config?.media.voiceMaxSeconds ?? DEFAULT_MAX_SECONDS;
  const [explaining, setExplaining] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  /** Where the next finished recording goes: the outbox, or the "Schedule" dialog. */
  const target = useRef<'send' | 'schedule'>('send');
  const [toSchedule, setToSchedule] = useState<VoiceRecording | null>(null);

  const onRecorded = useCallback(
    (recording: VoiceRecording) => {
      if (target.current === 'schedule') {
        target.current = 'send';
        setToSchedule(recording);
        return;
      }
      const replyTo = useMessageUi.getState().replies[chatId];
      useMessageUi.getState().setReply(chatId, undefined);
      void useSyncStore.getState().client?.sendMedia({
        chatId,
        replyTo,
        caption: '',
        file: recording.blob,
        info: {
          kind: 'voice',
          name: recording.name,
          mime: recording.mime,
          size: recording.blob.size,
          duration: recording.duration,
          waveform: recording.waveform,
        },
      });
      onSent();
    },
    [chatId, onSent],
  );

  const recorder = useVoiceRecorder({ maxSeconds, onRecorded });
  const { start, finish } = recorder;

  const begin = useCallback(
    async (locked: boolean) => {
      target.current = 'send';
      const permission = await readMicPermission();
      if (permission === 'denied') return setBlockedOpen(true);
      if (permission === 'prompt' && !hasExplainedMic()) return setExplaining(true);
      await start(locked);
    },
    [start],
  );

  return {
    recorder,
    maxMs: maxSeconds * 1000,
    begin,
    /** "Schedule message" from the recording's Send button: stop, then pick the time. */
    finishForSchedule: useCallback(() => {
      target.current = 'schedule';
      finish();
    }, [finish]),
    /** A finished recording waiting for its time; null otherwise. */
    toSchedule,
    schedule: useCallback(
      (recording: VoiceRecording, at: Date, onProgress: (fraction: number) => void) =>
        scheduleMedia(
          chatId,
          [
            {
              file: recording.blob,
              info: {
                kind: 'voice',
                name: recording.name,
                mime: recording.mime,
                size: recording.blob.size,
                duration: recording.duration,
                waveform: recording.waveform,
              },
              caption: '',
            },
          ],
          at,
          onProgress,
        ),
      [chatId],
    ),
    /** Scheduled, or the dialog closed: the recording is let go (it was never sent). */
    dropScheduled: useCallback(() => setToSchedule(null), []),
    explaining,
    blockedOpen: blockedOpen || recorder.problem === 'blocked',
    closeBlocked() {
      setBlockedOpen(false);
      recorder.dismiss();
    },
    closeExplaining: () => setExplaining(false),
    allowMic() {
      setExplaining(false);
      rememberMicExplained();
      // The finger has long left the button by now, so this recording stays on by itself.
      void start(true);
    },
  };
}
