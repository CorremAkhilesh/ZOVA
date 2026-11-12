import type { PollInput } from '@zuvo/protocol';
import { Plus, X } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/features/quiet-hours/components/Switch';
import {
  checkPoll,
  POLL_OPTION_MAX,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_QUESTION_MAX,
  type PollProblem,
} from '../logic';

const problemKey = (problem: PollProblem) => `polls.problems.${problem.field}.${problem.code}`;

/** Question, 2–12 options and "Allow multiple answers". Enter in an option moves to the next. */
export default function CreatePollDialog(props: {
  onSend: (poll: PollInput) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [problem, setProblem] = useState<PollProblem | null>(null);
  const fields = useRef<Array<HTMLInputElement | null>>([]);

  // A field just added gets the focus as soon as it exists, before the next key press.
  const focusAdded = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (focusAdded.current === null) return;
    fields.current[focusAdded.current]?.focus();
    focusAdded.current = null;
  });
  const change = (index: number, value: string) => {
    setProblem(null);
    setOptions((current) => current.map((option, at) => (at === index ? value : option)));
  };
  const remove = (index: number) => {
    setProblem(null);
    setOptions((current) => current.filter((_, at) => at !== index));
  };
  const add = () => {
    if (options.length >= POLL_OPTIONS_MAX) return;
    focusAdded.current = options.length;
    setOptions((current) => [...current, '']);
  };

  function onOptionKey(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (index < options.length - 1) fields.current[index + 1]?.focus();
    else add();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // Rendered from inside the composer: its form must not see this submit too (portals keep the tree).
    event.stopPropagation();
    const checked = checkPoll({ question, options, multiple });
    if ('problem' in checked) {
      setProblem(checked.problem);
      return;
    }
    props.onSend(checked.poll);
  }

  const optionProblem = problem?.field === 'options' ? problem : null;
  const invalidAt = optionProblem?.code === 'duplicate' ? optionProblem.index : -1;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent title={t('polls.createTitle')} className="max-w-lg">
        <form className="flex min-h-0 flex-col gap-4" onSubmit={submit} noValidate>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-q`} className="text-sm font-medium">
              {t('polls.question')}
            </label>
            <Input
              id={`${id}-q`}
              value={question}
              maxLength={POLL_QUESTION_MAX}
              placeholder={t('polls.questionPlaceholder')}
              aria-invalid={problem?.field === 'question'}
              aria-describedby={problem?.field === 'question' ? `${id}-problem` : undefined}
              onChange={(event) => {
                setProblem(null);
                setQuestion(event.target.value);
              }}
            />
          </div>
          <fieldset className="min-h-0 space-y-2 overflow-y-auto">
            <legend className="mb-1.5 text-sm font-medium">
              {t('polls.options', { min: POLL_OPTIONS_MIN, max: POLL_OPTIONS_MAX })}
            </legend>
            {options.map((option, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: options are edited in place by position
              <div key={index} className="flex items-center gap-1.5">
                <Input
                  ref={(element) => {
                    fields.current[index] = element;
                  }}
                  value={option}
                  maxLength={POLL_OPTION_MAX}
                  aria-label={t('polls.option', { n: index + 1 })}
                  placeholder={t('polls.option', { n: index + 1 })}
                  aria-invalid={index === invalidAt || (optionProblem !== null && invalidAt < 0)}
                  aria-describedby={optionProblem ? `${id}-problem` : undefined}
                  enterKeyHint="next"
                  onChange={(event) => change(index, event.target.value)}
                  onKeyDown={(event) => onOptionKey(event, index)}
                />
                {options.length > POLL_OPTIONS_MIN ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('polls.removeOption', { n: index + 1 })}
                    onClick={() => remove(index)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={options.length >= POLL_OPTIONS_MAX}
              onClick={add}
            >
              <Plus className="size-4" aria-hidden />
              {t('polls.addOption')}
            </Button>
          </fieldset>
          <Switch
            label={t('polls.multiple')}
            hint={t('polls.multipleHint')}
            checked={multiple}
            onChange={setMultiple}
          />
          {problem ? (
            <p id={`${id}-problem`} role="alert" className="text-sm font-medium text-danger">
              {t(problemKey(problem), { n: invalidAt + 1, max: POLL_OPTIONS_MAX })}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('polls.send')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
