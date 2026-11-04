import { createFileRoute, Link } from '@tanstack/react-router';
import { brand } from '@zuvo/config';
import { ArrowRight, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/common/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const Route = createFileRoute('/')({
  component: Welcome,
});

/** Welcome / login placeholder. The real OTP flow arrives with auth. */
function Welcome() {
  const { t } = useTranslation();
  return (
    <main className="flex h-full items-center justify-center overflow-y-auto p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
        className="glass w-full max-w-md rounded-3xl border p-8 shadow-lg"
      >
        <Logo withName />
        <h1 className="mt-8 text-3xl font-bold tracking-tight">
          {t('welcome.title', { brand: brand.name })}
        </h1>
        <p className="mt-2 text-text-muted">{t('welcome.subtitle', { tagline: brand.tagline })}</p>

        <form className="mt-8 space-y-3" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="email" className="text-sm font-medium">
            {t('welcome.emailLabel')}
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t('welcome.emailPlaceholder')}
            disabled
          />
          <Button type="submit" className="w-full" size="lg" disabled>
            {t('welcome.continue')}
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-text-muted">
            <Lock className="size-3.5" aria-hidden />
            {t('welcome.loginSoon')}
          </p>
        </form>

        <div className="mt-8 border-t pt-6">
          <Button asChild variant="subtle" className="w-full">
            <Link to="/chats">
              {t('welcome.openDemo')}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <p className="mt-2 text-center text-xs text-text-muted">{t('welcome.mockNotice')}</p>
        </div>
      </motion.div>
    </main>
  );
}
