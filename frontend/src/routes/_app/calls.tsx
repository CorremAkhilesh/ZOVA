import { createFileRoute } from '@tanstack/react-router';
import { Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Placeholder } from '@/components/common/StatusScreens';

export const Route = createFileRoute('/_app/calls')({
  component: function Calls() {
    const { t } = useTranslation();
    return (
      <Placeholder
        title={t('placeholder.callsTitle')}
        body={t('placeholder.callsBody')}
        icon={<Phone className="size-9" aria-hidden />}
      />
    );
  },
});
