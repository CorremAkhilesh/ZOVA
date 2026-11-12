import { DIM_MAX } from '@zuvo/protocol';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Saves once the slider rests for a moment, not on every step of a drag. */
export const DIM_SAVE_DELAY_MS = 400;

export function DimSlider(props: { value: number; onChange: (dim: number) => void }) {
  const { t } = useTranslation();
  const [dim, setDim] = useState(props.value);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const saved = useRef(props.value);

  // A change from another device moves the slider too.
  useEffect(() => {
    saved.current = props.value;
    setDim(props.value);
  }, [props.value]);

  useEffect(() => {
    if (dim === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = dim;
      onChange.current(dim);
    }, DIM_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dim]);

  const label = t('appearance.percent', { n: dim });
  return (
    <label className="block space-y-2">
      <span className="flex justify-between text-sm">
        <span className="font-medium">{t('appearance.dimLabel')}</span>
        <span className="text-text-muted">{label}</span>
      </span>
      <input
        type="range"
        min={0}
        max={DIM_MAX}
        step={5}
        value={dim}
        aria-valuetext={label}
        onChange={(event) => setDim(Number(event.target.value))}
        className="w-full accent-brand"
      />
    </label>
  );
}
