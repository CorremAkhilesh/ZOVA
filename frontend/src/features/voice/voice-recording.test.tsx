import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { RecordingBar } from './components/RecordingBar';
import { type RecorderDevices, useVoiceRecorder } from './use-voice-recorder';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the recording bar', () => {
  const bar = (overrides: Partial<Parameters<typeof RecordingBar>[0]> = {}) => {
    const handlers = {
      onCancel: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onSend: vi.fn(),
    };
    const view = render(
      <RecordingBar
        status="recording"
        locked
        elapsedMs={65_000}
        maxMs={900_000}
        levels={[0.1, 0.2]}
        {...handlers}
        {...overrides}
      />,
    );
    return { ...view, ...handlers };
  };

  it('has a timer, pause, delete and send, and no axe violations', async () => {
    const user = userEvent.setup();
    const { container, onCancel, onPause, onSend } = bar();
    expect(screen.getByRole('timer')).toHaveTextContent('1:05');
    await user.click(screen.getByRole('button', { name: 'Pause recording' }));
    await user.click(screen.getByRole('button', { name: 'Delete recording' }));
    await user.click(screen.getByRole('button', { name: 'Send voice message' }));
    expect(onPause).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(onSend).toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('offers resume while paused', () => {
    bar({ status: 'paused' });
    expect(screen.getByRole('button', { name: 'Resume recording' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause recording' })).not.toBeInTheDocument();
  });

  it('warns at 14:30, and says when the limit is reached', () => {
    const { unmount } = bar({ elapsedMs: 870_000 });
    expect(screen.getByRole('status')).toHaveTextContent('30 seconds left');
    unmount();
    bar({ status: 'atLimit', elapsedMs: 900_000 });
    expect(screen.getByRole('status')).toHaveTextContent('15:00 limit reached');
    expect(screen.getByRole('button', { name: 'Send voice message' })).toBeEnabled();
  });

  it('while held, only says how to cancel or lock', () => {
    bar({ locked: false });
    expect(screen.getByText(/Slide left to cancel/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send voice message' })).not.toBeInTheDocument();
  });
});

function Harness(props: { devices: RecorderDevices; onRecorded: (r: unknown) => void }) {
  const recorder = useVoiceRecorder({ maxSeconds: 900, ...props });
  return (
    <div>
      <p>status: {recorder.status}</p>
      <p>problem: {recorder.problem ?? 'none'}</p>
      <button type="button" onClick={() => void recorder.start(true)}>
        start
      </button>
      <button type="button" onClick={recorder.pause}>
        pause
      </button>
      <button type="button" onClick={recorder.resume}>
        resume
      </button>
      <button type="button" onClick={recorder.cancel}>
        cancel
      </button>
      <button type="button" onClick={recorder.finish}>
        finish
      </button>
    </div>
  );
}

describe('recording', () => {
  class FakeRecorder {
    state = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = 'recording';
      this.ondataavailable?.({ data: new Blob(['sound']) });
    }
    pause() {
      this.state = 'paused';
    }
    resume() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
  }

  const tracks = [{ stop: vi.fn() }];
  const devices = (overrides: Partial<RecorderDevices> = {}): RecorderDevices => ({
    supported: () => true,
    isTypeSupported: (mime) => mime === 'audio/webm;codecs=opus',
    getStream: async () => ({ getTracks: () => tracks }) as unknown as MediaStream,
    createRecorder: () => new FakeRecorder() as unknown as MediaRecorder,
    listen: () => ({ level: () => 0.5, close: vi.fn() }),
    ...overrides,
  });

  beforeEach(() => tracks[0]?.stop.mockClear());

  const clicks = async (...names: string[]) => {
    const user = userEvent.setup();
    for (const name of names) await user.click(screen.getByRole('button', { name }));
  };

  it('hands over a note with its type, length and waveform, and lets go of the mic', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const onRecorded = vi.fn();
    render(<Harness devices={devices()} onRecorded={onRecorded} />);
    await clicks('start');
    await screen.findByText('status: recording');
    now = 3000;
    await clicks('finish');
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    expect(onRecorded.mock.calls[0]?.[0]).toMatchObject({
      mime: 'audio/webm',
      name: 'voice-note.webm',
      duration: 3,
    });
    expect(onRecorded.mock.calls[0]?.[0].waveform).toHaveLength(64);
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it('does not count paused time', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const onRecorded = vi.fn();
    render(<Harness devices={devices()} onRecorded={onRecorded} />);
    await clicks('start');
    await screen.findByText('status: recording');
    now = 2000;
    await clicks('pause');
    await screen.findByText('status: paused');
    now = 60_000;
    await clicks('resume');
    now = 61_000;
    await clicks('finish');
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(onRecorded.mock.calls[0]?.[0].duration).toBe(3);
  });

  it('discards a note under a second, and says so', async () => {
    const onRecorded = vi.fn();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    render(<Harness devices={devices()} onRecorded={onRecorded} />);
    await clicks('start');
    await screen.findByText('status: recording');
    await clicks('finish');
    await screen.findByText('problem: tooShort');
    expect(onRecorded).not.toHaveBeenCalled();
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it('sends nothing when cancelled, and lets go of the mic', async () => {
    const onRecorded = vi.fn();
    render(<Harness devices={devices()} onRecorded={onRecorded} />);
    await clicks('start');
    await screen.findByText('status: recording');
    await clicks('cancel');
    await screen.findByText('status: idle');
    expect(onRecorded).not.toHaveBeenCalled();
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it.each([
    ['NotAllowedError', 'blocked'],
    ['NotFoundError', 'noMic'],
    ['NotReadableError', 'failed'],
  ])('%s becomes "%s", with no crash', async (name, problem) => {
    const refusing = devices({
      getStream: () => Promise.reject(Object.assign(new Error('no'), { name })),
    });
    render(<Harness devices={refusing} onRecorded={vi.fn()} />);
    await clicks('start');
    await screen.findByText(`problem: ${problem}`);
    expect(screen.getByText('status: idle')).toBeInTheDocument();
  });

  it('says so in a browser that cannot record at all', async () => {
    render(<Harness devices={devices({ supported: () => false })} onRecorded={vi.fn()} />);
    await clicks('start');
    await screen.findByText('problem: unsupported');
  });

  it('says so when no format can be recorded', async () => {
    render(<Harness devices={devices({ isTypeSupported: () => false })} onRecorded={vi.fn()} />);
    await clicks('start');
    await screen.findByText('problem: unsupported');
  });

  it('lets go of the mic if the recorder cannot start', async () => {
    const broken = devices({
      createRecorder: () => {
        throw new Error('no');
      },
    });
    render(<Harness devices={broken} onRecorded={vi.fn()} />);
    await clicks('start');
    await screen.findByText('problem: failed');
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });
});
