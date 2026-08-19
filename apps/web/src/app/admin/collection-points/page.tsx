'use client';

import type {
  CollectionPoint,
  CollectionPointType,
  CurrentUserResponse,
  TeamMembership,
} from '@soccer/contracts';
import { Calendar, Home, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { Dialog } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
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
import { parseOptionalCoordinate } from './coordinates';

interface PointFormState {
  name: string;
  address: string;
  type: CollectionPointType;
  gpsLat: string;
  gpsLng: string;
}

const emptyForm: PointFormState = { name: '', address: '', type: 'pickup', gpsLat: '', gpsLng: '' };

/** Only `admin` memberships apply to this page — kept as one helper so the
 * initial-team-pick effect and the render-time filter can never disagree. */
function adminMembershipsOf(memberships: TeamMembership[]): TeamMembership[] {
  return memberships.filter((m) => m.role === 'admin');
}

export default function AdminCollectionPointsPage() {
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
        const requested = adminMemberships.find((m) => m.teamId === requestedTeamId);
        setActiveTeamId(requested?.teamId ?? adminMemberships[0]?.teamId ?? null);
        setAuthStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setAuthStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, [requestedTeamId]);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace(buildLoginRedirect(pathname, searchParams.toString()));
    }
  }, [authStatus, router, pathname, searchParams]);

  // No team where this user is admin — nothing on this page applies to them.
  useEffect(() => {
    if (
      authStatus === 'ready' &&
      session &&
      adminMembershipsOf(session.teamMemberships).length === 0
    ) {
      router.replace('/home');
    }
  }, [authStatus, session, router]);

  if (authStatus !== 'ready' || !session) {
    return null;
  }

  const adminMemberships = adminMembershipsOf(session.teamMemberships);
  const firstAdminMembership = adminMemberships[0];
  if (!firstAdminMembership) {
    return null;
  }

  const navTeamId = activeTeamId ?? firstAdminMembership.teamId;
  const activeAdminMembership =
    adminMemberships.find((m) => m.teamId === navTeamId) ?? firstAdminMembership;
  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    notificationsNavItem(navTeamId, t),
    swapsNavItem(navTeamId, t),
    settingsNavItem(t),
    ...adminNavItems(navTeamId, t, 'collection-points'),
  ];

  return (
    <AppShell
      brand={t('common.appName')}
      navItems={navItems}
      accentColor={activeAdminMembership.primaryColor}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('adminCollectionPoints.title')}</h1>

        {adminMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={adminMemberships.map((m) => ({ id: m.teamId, label: m.teamName }))}
            activeId={activeTeamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}

        {/* Keyed on team so switching teams remounts this subtree and fetches
            fresh — avoids a synchronous setState-on-dependency-change effect. */}
        {activeTeamId && <CollectionPointsWorkspace key={activeTeamId} teamId={activeTeamId} />}
      </div>
    </AppShell>
  );
}

function CollectionPointsWorkspace({ teamId }: { teamId: string }) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [points, setPoints] = useState<CollectionPoint[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editingPoint, setEditingPoint] = useState<CollectionPoint | 'new' | null>(null);
  const [deletingPoint, setDeletingPoint] = useState<CollectionPoint | null>(null);

  const fetchPoints = useCallback(() => api.listCollectionPoints(teamId), [teamId]);

  useEffect(() => {
    let cancelled = false;
    fetchPoints()
      .then((data) => {
        if (cancelled) return;
        setPoints(data.points);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPoints]);

  const reload = useCallback(() => {
    setLoadState('loading');
    fetchPoints()
      .then((data) => {
        setPoints(data.points);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }, [fetchPoints]);

  async function handleDelete() {
    if (!deletingPoint) return;
    try {
      await api.deleteCollectionPoint(teamId, deletingPoint.id);
      setPoints((prev) => (prev ? prev.filter((p) => p.id !== deletingPoint.id) : prev));
      setDeletingPoint(null);
    } catch (err) {
      setDeletingPoint(null);
      showToast(err instanceof ApiError ? err.message : t('common.somethingWentWrong'), 'error');
    }
  }

  function handleSaved(saved: CollectionPoint) {
    setPoints((prev) => {
      if (!prev) return prev;
      const next = prev.some((p) => p.id === saved.id)
        ? prev.map((p) => (p.id === saved.id ? saved : p))
        : [...prev, saved];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
    setEditingPoint(null);
  }

  if (loadState === 'loading') {
    return <LoadingState label={t('adminCollectionPoints.loading')} />;
  }

  if (loadState === 'error' || !points) {
    return (
      <ErrorState
        title={t('adminCollectionPoints.loadError')}
        action={
          <button type="button" className={buttonClassName} onClick={reload}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        className={`${buttonClassName} self-start`}
        onClick={() => setEditingPoint('new')}
      >
        <Plus className="me-1.5 -ms-0.5 inline size-4" aria-hidden="true" />
        {t('adminCollectionPoints.addButton')}
      </button>

      {points.length === 0 ? (
        <EmptyState title={t('adminCollectionPoints.empty')} />
      ) : (
        <DataList ariaLabel={t('adminCollectionPoints.title')}>
          {points.map((point) => (
            <DataListItem key={point.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{point.name}</p>
                <p className="text-sm text-ink-muted">{point.address}</p>
                <span className="mt-1 inline-block rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {t(`adminCollectionPoints.type.${point.type}`)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  label={t('adminCollectionPoints.editAriaLabel', { name: point.name })}
                  icon={<Pencil className="size-4" aria-hidden="true" />}
                  onClick={() => setEditingPoint(point)}
                />
                <IconButton
                  label={t('adminCollectionPoints.deleteAriaLabel', { name: point.name })}
                  icon={<Trash2 className="size-4" aria-hidden="true" />}
                  variant="danger"
                  onClick={() => setDeletingPoint(point)}
                />
              </div>
            </DataListItem>
          ))}
        </DataList>
      )}

      {editingPoint && (
        <PointFormDialog
          teamId={teamId}
          point={editingPoint === 'new' ? null : editingPoint}
          onClose={() => setEditingPoint(null)}
          onSaved={handleSaved}
        />
      )}

      <ConfirmDialog
        open={deletingPoint !== null}
        title={t('adminCollectionPoints.deleteConfirmTitle')}
        description={t('adminCollectionPoints.deleteConfirmBody')}
        confirmLabel={t('adminCollectionPoints.deleteConfirmButton')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeletingPoint(null)}
      />
    </div>
  );
}

function PointFormDialog({
  teamId,
  point,
  onClose,
  onSaved,
}: {
  teamId: string;
  point: CollectionPoint | null;
  onClose: () => void;
  onSaved: (saved: CollectionPoint) => void;
}) {
  const { t } = useLocale();
  const [form, setForm] = useState<PointFormState>(
    point
      ? {
          name: point.name,
          address: point.address,
          type: point.type,
          gpsLat: point.gpsLat === null ? '' : String(point.gpsLat),
          gpsLng: point.gpsLng === null ? '' : String(point.gpsLng),
        }
      : emptyForm,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const gpsLat = parseOptionalCoordinate(form.gpsLat);
    const gpsLng = parseOptionalCoordinate(form.gpsLng);
    if (gpsLat === null) {
      setError(t('adminCollectionPoints.invalidLatitude'));
      return;
    }
    if (gpsLng === null) {
      setError(t('adminCollectionPoints.invalidLongitude'));
      return;
    }

    setIsSubmitting(true);
    try {
      const body = { name: form.name, address: form.address, type: form.type, gpsLat, gpsLng };
      const saved = point
        ? await api.updateCollectionPoint(teamId, point.id, body)
        : await api.createCollectionPoint(teamId, body);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        point
          ? t('adminCollectionPoints.formTitleEdit')
          : t('adminCollectionPoints.formTitleCreate')
      }
      closeLabel={t('common.close')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('adminCollectionPoints.nameLabel')}>
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputClassName}
          />
        </Field>
        <Field label={t('adminCollectionPoints.addressLabel')}>
          <input
            required
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            className={inputClassName}
          />
        </Field>
        <Field label={t('adminCollectionPoints.typeLabel')}>
          <select
            value={form.type}
            onChange={(e) =>
              setForm((f) => ({ ...f, type: e.target.value as CollectionPointType }))
            }
            className={inputClassName}
          >
            <option value="pickup">{t('adminCollectionPoints.type.pickup')}</option>
            <option value="dropoff">{t('adminCollectionPoints.type.dropoff')}</option>
            <option value="both">{t('adminCollectionPoints.type.both')}</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('adminCollectionPoints.gpsLatLabel')}>
            <input
              type="number"
              step="any"
              min={-90}
              max={90}
              value={form.gpsLat}
              onChange={(e) => setForm((f) => ({ ...f, gpsLat: e.target.value }))}
              className={inputClassName}
            />
          </Field>
          <Field label={t('adminCollectionPoints.gpsLngLabel')}>
            <input
              type="number"
              step="any"
              min={-180}
              max={180}
              value={form.gpsLng}
              onChange={(e) => setForm((f) => ({ ...f, gpsLng: e.target.value }))}
              className={inputClassName}
            />
          </Field>
        </div>
        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={isSubmitting} className={`${buttonClassName} self-end`}>
          {isSubmitting ? t('adminCollectionPoints.saving') : t('adminCollectionPoints.save')}
        </button>
      </form>
    </Dialog>
  );
}
