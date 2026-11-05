import { useTranslation } from 'react-i18next';
import { cycleSpeed, usePlayer } from '../player';

export function SpeedButton() {
  const { t } = useTranslation();
  const speed = usePlayer((state) => state.speed);
  return (
    <button
      type="button"
      onClick={cycleSpeed}
      aria-label={t('voice.speed', { speed })}
      className="rounded-full bg-black/15 px-1.5 text-[11px] font-semibold tabular-nums"
    >
      {speed}x
    </button>
  );
}
