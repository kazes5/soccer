'use client';

import type {
  AuditLogEntry,
  AuditLogFilter,
  CurrentUserResponse,
  TeamMembership,
} from '@soccer/contracts';
import { formatDate } from '@soccer/i18n';
import { Calendar, Download, Home, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Field,
  buttonClassName,
  inputClassName,
  secondaryButtonClassName,
} from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { Dialog } from '@/components/ui/dialog';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TeamSwitcher } from '@/components/ui/team-switcher';
import { useToast } from '@/components/ui/toast';
import {
  adminNavItems,
  notificationsNavItem,
  settingsNavItem,
  swapsNavItem,
} from '@/lib/admin-nav';
import { ApiError, api } from '@/lib/api';
import { buildLoginRedirect } from '@/lib/safe-redirect';

interface FilterForm {
  actor: string;
  action: string;
  target: string;
  source: '' | 'app' | 'ai_chat';
  from: string;
  to: string;
  search: string;
}

const emptyFilters: FilterForm = {
  actor: '',
  action: '',
  target: '',
  source: '',
  from: '',
  to: '',
  search: '',
};

function adminMembershipsOf(memberships: TeamMembership[]): TeamMembership[] {
  return memberships.filter((membership) => membership.role === 'admin');
}

function filterRequest(filters: FilterForm): AuditLogFilter {
  return {
    ...(filters.actor.trim() ? { actor: filters.actor.trim() } : {}),
    ...(filters.action.trim() ? { action: filters.action.trim() } : {}),
    ...(filters.target.trim() ? { target: filters.target.trim() } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.from ? { from: new Date(`${filters.from}T00:00:00`).toISOString() } : {}),
    ...(filters.to ? { to: new Date(`${filters.to}T23:59:59.999`).toISOString() } : {}),
    ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
  };
}

function stateText(value: unknown): string {
  return value === null ? '—' : JSON.stringify(value, null, 2);
}

export default function AdminAuditLogsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTeamId = searchParams.get('team');
  const { t } = useLocale();
  const [session, setSession] = useState<CurrentUserResponse | null>(null);
  const [authStatus, setAuthStatus] = useState<'loading' | 'ready' | 'unauthenticated'>('loading');
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        const adminMemberships = adminMembershipsOf(data.teamMemberships);
        const requested = adminMemberships.find(
          (membership) => membership.teamId === requestedTeamId,
        );
        setActiveTeamId(requested?.teamId ?? adminMemberships[0]?.teamId ?? null);
        setAuthStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setAuthStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, [requestedTeamId]);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace(buildLoginRedirect(pathname, searchParams.toString()));
    }
  }, [authStatus, pathname, router, searchParams]);

  useEffect(() => {
    if (
      authStatus === 'ready' &&
      session &&
      adminMembershipsOf(session.teamMemberships).length === 0
    ) {
      router.replace('/home');
    }
  }, [authStatus, router, session]);

  if (authStatus !== 'ready' || !session) return null;

  const adminMemberships = adminMembershipsOf(session.teamMemberships);
  const firstAdminMembership = adminMemberships[0];
  if (!firstAdminMembership) return null;
  const navTeamId = activeTeamId ?? firstAdminMembership.teamId;
  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    notificationsNavItem(navTeamId, t),
    swapsNavItem(navTeamId, t),
    settingsNavItem(t),
    ...adminNavItems(navTeamId, t, 'audit-logs'),
  ];

  return (
    <AppShell brand={t('common.appName')} navItems={navItems}>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('adminAuditLogs.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('adminAuditLogs.subtitle')}</p>
        </div>
        {adminMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={adminMemberships.map((membership) => ({
              id: membership.teamId,
              label: membership.teamName,
            }))}
            activeId={activeTeamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}
        {activeTeamId && <AuditLogWorkspace key={activeTeamId} teamId={activeTeamId} />}
      </div>
    </AppShell>
  );
}

function AuditLogWorkspace({ teamId }: { teamId: string }) {
  const { locale, t } = useLocale();
  const { showToast } = useToast();
  const [draftFilters, setDraftFilters] = useState<FilterForm>(emptyFilters);
  const [filters, setFilters] = useState<FilterForm>(emptyFilters);
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // `reloadKey` intentionally lets Retry/Apply issue the same query again.
    void reloadKey;
    api
      .listAuditLogs(teamId, { ...filterRequest(filters), limit: 25 })
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries);
        setNextCursor(data.nextCursor);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloadKey, teamId]);

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    setLoadState('loading');
    setFilters(draftFilters);
    setReloadKey((current) => current + 1);
  }

  function clearFilters() {
    setLoadState('loading');
    setDraftFilters(emptyFilters);
    setFilters(emptyFilters);
    setReloadKey((current) => current + 1);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.listAuditLogs(teamId, {
        ...filterRequest(filters),
        cursor: nextCursor,
        limit: 25,
      });
      setEntries((current) => [...(current ?? []), ...data.entries]);
      setNextCursor(data.nextCursor);
    } catch (error) {
      showToast(
        error instanceof ApiError ? error.message : t('common.somethingWentWrong'),
        'error',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await api.exportAuditLogs(teamId, filterRequest(filters));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audit-logs-${teamId}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast(
        error instanceof ApiError ? error.message : t('common.somethingWentWrong'),
        'error',
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={submitFilters}
        className="grid gap-3 rounded-xl border border-surface-border bg-surface p-4 shadow-raised sm:grid-cols-2 lg:grid-cols-3"
      >
        <Field label={t('adminAuditLogs.searchLabel')}>
          <div className="relative">
            <Search className="absolute start-3 top-3.5 size-4 text-ink-muted" aria-hidden="true" />
            <input
              value={draftFilters.search}
              maxLength={200}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, search: event.target.value }))
              }
              className={`${inputClassName} w-full ps-9`}
            />
          </div>
        </Field>
        <Field label={t('adminAuditLogs.actorLabel')}>
          <input
            value={draftFilters.actor}
            maxLength={100}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, actor: event.target.value }))
            }
            className={inputClassName}
          />
        </Field>
        <Field label={t('adminAuditLogs.actionLabel')}>
          <input
            value={draftFilters.action}
            maxLength={100}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, action: event.target.value }))
            }
            className={inputClassName}
          />
        </Field>
        <Field label={t('adminAuditLogs.targetLabel')}>
          <input
            value={draftFilters.target}
            maxLength={100}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, target: event.target.value }))
            }
            className={inputClassName}
          />
        </Field>
        <Field label={t('adminAuditLogs.sourceLabel')}>
          <select
            value={draftFilters.source}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                source: event.target.value as FilterForm['source'],
              }))
            }
            className={inputClassName}
          >
            <option value="">{t('adminAuditLogs.sourceAll')}</option>
            <option value="app">{t('adminAuditLogs.sourceApp')}</option>
            <option value="ai_chat">{t('adminAuditLogs.sourceAi')}</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('adminAuditLogs.fromLabel')}>
            <input
              type="date"
              value={draftFilters.from}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, from: event.target.value }))
              }
              className={inputClassName}
            />
          </Field>
          <Field label={t('adminAuditLogs.toLabel')}>
            <input
              type="date"
              value={draftFilters.to}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, to: event.target.value }))
              }
              className={inputClassName}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
          <button type="submit" className={buttonClassName}>
            {t('adminAuditLogs.applyFilters')}
          </button>
          <button type="button" onClick={clearFilters} className={secondaryButtonClassName}>
            {t('adminAuditLogs.clearFilters')}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting}
            className={`${secondaryButtonClassName} gap-2 sm:ms-auto`}
          >
            <Download className="size-4" aria-hidden="true" />
            {exporting ? t('adminAuditLogs.exporting') : t('adminAuditLogs.exportCsv')}
          </button>
        </div>
      </form>

      {loadState === 'loading' ? (
        <LoadingState label={t('adminAuditLogs.loading')} />
      ) : loadState === 'error' || !entries ? (
        <ErrorState
          title={t('adminAuditLogs.loadError')}
          action={
            <button
              type="button"
              className={buttonClassName}
              onClick={() => {
                setLoadState('loading');
                setReloadKey((current) => current + 1);
              }}
            >
              {t('common.retry')}
            </button>
          }
        />
      ) : entries.length === 0 ? (
        <EmptyState title={t('adminAuditLogs.empty')} />
      ) : (
        <>
          <DataList ariaLabel={t('adminAuditLogs.entriesLabel')}>
            {entries.map((entry) => (
              <DataListItem key={entry.id} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{entry.actionType}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {entry.actor?.name ?? t('adminAuditLogs.systemActor')} · {entry.targetEntity}
                    {entry.targetId ? ` · ${entry.targetId}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {formatDate(locale, new Date(entry.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    ·{' '}
                    {entry.source === 'app'
                      ? t('adminAuditLogs.sourceApp')
                      : t('adminAuditLogs.sourceAi')}
                  </p>
                </div>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => setSelected(entry)}
                >
                  {t('adminAuditLogs.viewDetails')}
                </button>
              </DataListItem>
            ))}
          </DataList>
          {nextCursor && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={loadMore}
              className={`${secondaryButtonClassName} self-center`}
            >
              {loadingMore ? t('adminAuditLogs.loadingMore') : t('adminAuditLogs.loadMore')}
            </button>
          )}
        </>
      )}

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={t('adminAuditLogs.detailsTitle')}
        closeLabel={t('common.close')}
      >
        {selected && (
          <dl className="grid gap-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="font-semibold">{t('adminAuditLogs.dateLabel')}</dt>
                <dd className="mt-1 text-ink-muted">
                  {formatDate(locale, new Date(selected.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">{t('adminAuditLogs.actorLabel')}</dt>
                <dd className="mt-1 text-ink-muted">
                  {selected.actor?.name ?? t('adminAuditLogs.systemActor')}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">{t('adminAuditLogs.actionLabel')}</dt>
                <dd className="mt-1 break-all text-ink-muted">{selected.actionType}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t('adminAuditLogs.sourceLabel')}</dt>
                <dd className="mt-1 text-ink-muted">
                  {selected.source === 'app'
                    ? t('adminAuditLogs.sourceApp')
                    : t('adminAuditLogs.sourceAi')}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">{t('adminAuditLogs.targetLabel')}</dt>
                <dd className="mt-1 break-all text-ink-muted">{selected.targetEntity}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t('adminAuditLogs.targetIdLabel')}</dt>
                <dd className="mt-1 break-all text-ink-muted">{selected.targetId ?? '—'}</dd>
              </div>
            </div>
            <div>
              <dt className="font-semibold">{t('adminAuditLogs.beforeState')}</dt>
              <dd>
                <pre
                  className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-soft p-3 text-xs"
                  dir="auto"
                >
                  {stateText(selected.beforeState)}
                </pre>
              </dd>
            </div>
            <div>
              <dt className="font-semibold">{t('adminAuditLogs.afterState')}</dt>
              <dd>
                <pre
                  className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-soft p-3 text-xs"
                  dir="auto"
                >
                  {stateText(selected.afterState)}
                </pre>
              </dd>
            </div>
            {selected.aiContext !== null && (
              <div>
                <dt className="font-semibold">{t('adminAuditLogs.aiContext')}</dt>
                <dd>
                  <pre
                    className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-soft p-3 text-xs"
                    dir="auto"
                  >
                    {stateText(selected.aiContext)}
                  </pre>
                </dd>
              </div>
            )}
          </dl>
        )}
      </Dialog>
    </div>
  );
}
