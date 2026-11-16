import { Check, Pencil, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface EditableFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  maxLength: number;
  multiline?: boolean;
  /** Returns an error message, or null when the value is fine. */
  validate?: (value: string) => string | null;
  onSave: (value: string) => void;
  hint?: ReactNode;
}

/** Shows a value with an edit button; editing happens in place (Enter saves, Escape cancels). */
export function EditableField(props: EditableFieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const editing = draft !== null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft === null) return;
    const problem = props.validate?.(draft) ?? null;
    if (problem) return setError(problem);
    setDraft(null);
    setError('');
    if (draft.trim() !== props.value) props.onSave(draft.trim());
  }

  const cancel = () => {
    setDraft(null);
    setError('');
  };

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-text-muted">{props.label}</p>
          <p className="break-words font-medium">{props.value || props.placeholder}</p>
          {props.hint ? <div className="mt-1 text-xs text-text-muted">{props.hint}</div> : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('profile.edit', { field: props.label })}
          onClick={() => setDraft(props.value)}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }

  const field = {
    id,
    value: draft,
    maxLength: props.maxLength,
    autoFocus: true,
    'aria-invalid': Boolean(error),
    ...(error ? { 'aria-describedby': `${id}-error` } : {}),
    onKeyDown: (event: React.KeyboardEvent) => event.key === 'Escape' && cancel(),
  };

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <label htmlFor={id} className="text-sm text-text-muted">
        {props.label}
      </label>
      {props.multiline ? (
        <textarea
          {...field}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-text"
        />
      ) : (
        <Input {...field} onChange={(event) => setDraft(event.target.value)} />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">
          {draft.length}/{props.maxLength}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={cancel}>
            <X className="size-4" aria-hidden />
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="sm">
            <Check className="size-4" aria-hidden />
            {t('common.save')}
          </Button>
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
