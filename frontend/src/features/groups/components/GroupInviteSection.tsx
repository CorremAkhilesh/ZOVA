import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, QrCode, RotateCcw, Unlink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { authErrorMessage } from '@/features/auth/errors';
import { groupsApi } from '../api';

/** The link as a drawing. The library is only fetched for people who open this. */
function QrImage({ text, label }: { text: string; label: string }) {
  const [path, setPath] = useState<{ d: string; size: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('uqr').then(({ encode }) => {
      if (cancelled) return;
      const { data, size } = encode(text, { border: 2 });
      const d = data
        .flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])))
        .join('');
      setPath({ d, size });
    });
    return () => {
      cancelled = true;
    };
  }, [text]);
  if (!path) return null;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${path.size} ${path.size}`}
      className="mx-auto size-48 rounded-lg bg-white"
    >
      <path d={path.d} fill="#000" />
    </svg>
  );
}

export function inviteUrl(code: string, origin = window.location.origin) {
  return `${origin}/join/${code}`;
}

/** The invite link: copy, show as a QR code, reset or switch off. Admins only. */
export function GroupInviteSection({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const key = ['group-invite', chatId];
  const queryClient = useQueryClient();
  const [showQr, setShowQr] = useState(false);
  const invite = useQuery({ queryKey: key, queryFn: () => groupsApi.invite(chatId) });
  const change = useMutation({
    mutationFn: async (work: () => ReturnType<typeof groupsApi.invite>) => work(),
    onSuccess: (result) => queryClient.setQueryData(key, result),
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });
  const code = invite.data?.code ?? null;
  const url = code ? inviteUrl(code) : null;
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('groups.linkCopied'));
    } catch {
      toast.error(t('groups.copyFailed'));
    }
  };

  return (
    <section aria-label={t('groups.inviteTitle')} className="space-y-2 px-4 py-3">
      <h3 className="text-sm font-semibold">{t('groups.inviteTitle')}</h3>
      {invite.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('groups.inviteFailed')}
        </p>
      ) : null}
      {url ? (
        <>
          <p data-testid="invite-link" className="break-all text-xs text-text-muted">
            {url}
          </p>
          <div className="flex flex-wrap gap-1">
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <Copy className="size-4" aria-hidden />
              {t('groups.copyLink')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={showQr}
              onClick={() => setShowQr((shown) => !shown)}
            >
              <QrCode className="size-4" aria-hidden />
              {t('groups.qr')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => change.mutate(() => groupsApi.resetInvite(chatId))}
            >
              <RotateCcw className="size-4" aria-hidden />
              {t('groups.resetLink')}
            </Button>
            <Button
              variant="danger-outline"
              size="sm"
              onClick={() => change.mutate(() => groupsApi.revokeInvite(chatId))}
            >
              <Unlink className="size-4" aria-hidden />
              {t('groups.revokeLink')}
            </Button>
          </div>
          {showQr ? <QrImage text={url} label={t('groups.qrLabel')} /> : null}
        </>
      ) : invite.isSuccess ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => change.mutate(() => groupsApi.resetInvite(chatId))}
        >
          <Link2 className="size-4" aria-hidden />
          {t('groups.createLink')}
        </Button>
      ) : null}
    </section>
  );
}
