'use client';

import { LogOut } from 'lucide-react';
import { useLocale } from '@/components/locale-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';

/**
 * AppShell's mobile header and desktop sidebar are both always mounted
 * (visibility is CSS-only, to avoid layout shift across the md breakpoint),
 * so a trigger button is needed in each — but the confirm dialog itself is a
 * native <dialog> that stays in the DOM (with its text) regardless of its
 * `open` state, so rendering *two* would let a query for the confirm copy
 * match both. AppShell renders LogOutTrigger twice sharing one `onClick`,
 * and LogOutDialog exactly once.
 */
export function LogOutTrigger({ onClick }: { onClick: () => void }) {
  const { t } = useLocale();
  return (
    <IconButton
      label={t('home.logOut')}
      icon={<LogOut className="size-5" aria-hidden="true" />}
      onClick={onClick}
    />
  );
}

export function LogOutDialog({
  open,
  isSingleTeamParent,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  isSingleTeamParent: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <ConfirmDialog
      open={open}
      title={t('home.logOutConfirmTitle')}
      description={t(
        isSingleTeamParent ? 'home.logOutConfirmBodySingleTeam' : 'home.logOutConfirmBody',
      )}
      confirmLabel={t('home.logOut')}
      cancelLabel={t('common.cancel')}
      closeLabel={t('common.close')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
