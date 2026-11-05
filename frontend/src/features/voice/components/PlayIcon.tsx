import { Loader2, Pause, Play } from 'lucide-react';

export function PlayIcon(props: { playing: boolean; loading?: boolean; className: string }) {
  const { playing, loading, className } = props;
  if (loading) {
    return (
      <Loader2 className={`${className} animate-spin motion-reduce:animate-none`} aria-hidden />
    );
  }
  return playing ? (
    <Pause className={className} aria-hidden />
  ) : (
    <Play className={className} aria-hidden />
  );
}
