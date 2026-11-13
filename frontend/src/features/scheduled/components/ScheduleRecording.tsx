import { lazy, Suspense } from 'react';
import type { VoiceRecording } from '@/features/voice/use-voice-recorder';
import { mediaLine } from '../preview';

const ScheduleDialog = lazy(() => import('./ScheduleDialog'));

interface ScheduleRecordingProps {
  recording: VoiceRecording | null;
  schedule: (
    recording: VoiceRecording,
    at: Date,
    onProgress: (fraction: number) => void,
  ) => Promise<void>;
  /** Scheduled, or closed without: the recording is let go either way. */
  onClose: () => void;
}

/** "Schedule message" for a voice note that has just been recorded. */
export function ScheduleRecording({ recording, schedule, onClose }: ScheduleRecordingProps) {
  if (!recording) return null;
  return (
    <Suspense fallback={null}>
      <ScheduleDialog
        mode="media"
        summary={mediaLine(
          { kind: 'voice', name: recording.name, duration: recording.duration },
          null,
        )}
        schedule={(at, onProgress) => schedule(recording, at, onProgress)}
        onDone={() => {}}
        onClose={onClose}
      />
    </Suspense>
  );
}
