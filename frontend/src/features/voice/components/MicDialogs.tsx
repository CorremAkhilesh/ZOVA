import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { type BrowserFamily, browserFamily } from '../permission';

const STEP_SECTIONS = ['chrome', 'edge', 'safari', 'iphone'] as const;
type StepSection = (typeof STEP_SECTIONS)[number];

const sectionFor = (family: BrowserFamily): StepSection =>
  family === 'edge' || family === 'safari' || family === 'iphone' ? family : 'chrome';

/** Before the browser's own prompt, which says nothing about why. */
export function MicExplainDialog(props: {
  open: boolean;
  onAllow: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent title={t('voice.permissionTitle')} className="max-w-sm">
        <p className="text-sm text-text-muted">{t('voice.permissionBody')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t('voice.notNow')}
          </Button>
          <Button onClick={props.onAllow}>{t('voice.allowMic')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The browser said no. Only the browser's settings can undo that, so say exactly where they are. */
export function MicBlockedDialog(props: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [section, setSection] = useState(() => sectionFor(browserFamily(navigator.userAgent)));
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent title={t('voice.blockedTitle')} className="max-w-md">
        <p className="text-sm text-text-muted">{t('voice.blockedBody')}</p>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">{t('voice.browserChoice')}</legend>
          {STEP_SECTIONS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={section === name}
              onClick={() => setSection(name)}
              className={
                section === name
                  ? 'rounded-full bg-brand px-3 py-1 text-sm font-medium text-white'
                  : 'rounded-full border px-3 py-1 text-sm'
              }
            >
              {t(`voice.browsers.${name}`)}
            </button>
          ))}
        </fieldset>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {[1, 2, 3].map((step) => (
            <li key={step}>{t(`voice.steps.${section}.${step}`)}</li>
          ))}
        </ol>
        <div className="flex justify-end">
          <Button onClick={props.onClose}>{t('voice.gotIt')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
