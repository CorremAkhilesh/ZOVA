import { useCallback, useState } from 'react';
import { useAppConfig } from '@/features/media/use-app-config';
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

  const onRecorded = useCallback(
    (recording: VoiceRecording) => {
      void useSyncStore.getState().client?.sendMedia({
        chatId,
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
  const { start } = recorder;

  const begin = useCallback(
    async (locked: boolean) => {
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
