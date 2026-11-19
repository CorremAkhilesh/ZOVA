import { brand } from '@zuvo/config';
import { useTranslation } from 'react-i18next';
import type { PushProblem } from '../status';
import { browserFamily } from '../support';

/** Why push cannot work here, and what to do about it. */
export function PermissionHelp({
  problem,
  titleId,
  stepsOnly = false,
}: {
  problem: PushProblem;
  titleId?: string;
  /** Only how to unblock (the screen around it already says what is wrong). */
  stepsOnly?: boolean;
}) {
  const { t } = useTranslation();
  const vars = { brand: brand.name };
  if (problem === 'denied' && stepsOnly) {
    return <p className="text-sm">{t(`notifications.help.${browserFamily()}`, vars)}</p>;
  }
  if (problem === 'denied') {
    return (
      <div className="space-y-1 text-sm">
        <p id={titleId} className="font-semibold">
          {t('notifications.denied.title')}
        </p>
        <p className="text-text-muted">{t('notifications.denied.text', vars)}</p>
        <p className="text-text-muted">{t(`notifications.help.${browserFamily()}`, vars)}</p>
      </div>
    );
  }
  const key = problem === 'ios-install' ? 'ios' : 'unsupported';
  return (
    <div className="space-y-1 text-sm">
      <p id={titleId} className="font-semibold">
        {t(`notifications.${key}.title`, vars)}
      </p>
      <p className="text-text-muted">{t(`notifications.${key}.text`, vars)}</p>
    </div>
  );
}
