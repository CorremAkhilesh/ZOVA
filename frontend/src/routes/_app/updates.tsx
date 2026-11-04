import { createFileRoute } from '@tanstack/react-router';
import { CircleDashed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Placeholder } from '@/components/common/StatusScreens';

export const Route = createFileRoute('/_app/updates')({
  component: function Updates() {
    const { t } = useTranslation();
    return (
      <Placeholder
        title={t('placeholder.updatesTitle')}
        body={t('placeholder.updatesBody')}
        icon={<CircleDashed className="size-9" aria-hidden />}
      />
    );
  },
});
