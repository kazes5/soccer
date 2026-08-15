'use client';

import type { SystemTeamMember } from '@soccer/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/components/locale-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { AppShell } from '@/components/ui/shell';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { buttonClassName, secondaryButtonClassName } from '@/components/form-controls';
import { api } from '@/lib/api';
import { systemNavItems } from '@/lib/system-nav';

export default function SystemTeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const router = useRouter();
  const { t } = useLocale();
  const [members, setMembers] = useState<SystemTeamMember[] | null>(null);
  const [pending, setPending] = useState<SystemTeamMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api.me();
      if (me.systemRole !== 'system_admin' || me.authMethod !== 'passkey') {
        router.replace('/home');
        return;
      }
      setMembers((await api.listSystemTeamMembers(teamId)).members);
    } catch {
      setError(true);
    }
  }, [router, teamId]);

  useEffect(() => {
    let cancelled = false;
    void api
      .me()
      .then(async (me) => {
        if (cancelled) return;
        if (me.systemRole !== 'system_admin' || me.authMethod !== 'passkey') {
          router.replace('/home');
          return;
        }
        const response = await api.listSystemTeamMembers(teamId);
        if (!cancelled) setMembers(response.members);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router, teamId]);

  async function changeRole() {
    if (!pending) return;
    setBusy(true);
    try {
      await api.updateSystemTeamMemberRole(teamId, pending.id, {
        role: pending.role === 'admin' ? 'parent' : 'admin',
      });
      await load();
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell brand={t('common.appName')} navItems={systemNavItems(t)}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        <Link href="/system" className="text-sm text-ink-muted underline">
          {t('system.back')}
        </Link>
        <h1 className="text-xl font-semibold">{t('system.teamMembers')}</h1>
        {error ? (
          <ErrorState title={t('system.loadError')} />
        ) : !members ? (
          <LoadingState label={t('system.loading')} />
        ) : (
          <DataList ariaLabel={t('system.teamMembers')}>
            {members.map((member) => (
              <DataListItem key={member.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-sm text-ink-muted">
                      {member.email ?? member.phone ?? '—'} · {member.role}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={member.role === 'admin' ? secondaryButtonClassName : buttonClassName}
                    onClick={() => setPending(member)}
                  >
                    {member.role === 'admin' ? t('system.demote') : t('system.promote')}
                  </button>
                </div>
              </DataListItem>
            ))}
          </DataList>
        )}
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={
          pending
            ? t('system.changeRoleConfirm', {
                name: pending.name,
                role: pending.role === 'admin' ? 'parent' : 'admin',
              })
            : ''
        }
        confirmLabel={pending?.role === 'admin' ? t('system.demote') : t('system.promote')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        confirmDisabled={busy}
        cancelDisabled={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void changeRole()}
      />
    </AppShell>
  );
}
