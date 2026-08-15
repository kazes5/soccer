'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SystemAuditListResponse } from '@soccer/contracts';
import { useLocale } from '@/components/locale-provider';
import { AppShell } from '@/components/ui/shell';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { api } from '@/lib/api';
import { systemNavItems } from '@/lib/system-nav';
import { secondaryButtonClassName } from '@/components/form-controls';

export default function SystemAuditLogsPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [data, setData] = useState<SystemAuditListResponse | null>(null);
  const [error, setError] = useState(false);
  async function loadMore() {
    if (!data?.nextCursor) return;
    const next = await api.listSystemAuditLogs(data.nextCursor);
    setData({ entries: [...data.entries, ...next.entries], nextCursor: next.nextCursor });
  }
  useEffect(() => {
    void api
      .me()
      .then((me) => {
        if (me.systemRole !== 'system_admin' || me.authMethod !== 'passkey') {
          router.replace('/home');
          return;
        }
        return api.listSystemAuditLogs().then(setData);
      })
      .catch(() => setError(true));
  }, [router]);
  return (
    <AppShell brand={t('common.appName')} navItems={systemNavItems(t, 'audit')}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold">{t('system.auditLogs')}</h1>
        {error ? (
          <ErrorState title={t('system.loadError')} />
        ) : !data ? (
          <LoadingState label={t('system.loading')} />
        ) : data.entries.length === 0 ? (
          <EmptyState title={t('system.noAuditLogs')} />
        ) : (
          <>
            <DataList ariaLabel={t('system.auditLogs')}>
              {data.entries.map((entry) => (
                <DataListItem key={entry.id}>
                  <div className="font-medium">{entry.actionType}</div>
                  <div className="text-sm text-ink-muted">
                    {entry.actorName ?? '—'} · {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </DataListItem>
              ))}
            </DataList>
            {data.nextCursor && (
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() => void loadMore()}
              >
                {t('system.loadMore')}
              </button>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
