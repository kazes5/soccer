'use client';

import type {
  CurrentUserResponse,
  PlayerSummary,
  TeamMembership,
  TeamRosterEntry,
} from '@soccer/contracts';
import { focusRingClassName } from '@soccer/ui-tokens';
import { Calendar, Home, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Field,
  FieldsetGroup,
  FormError,
  buttonClassName,
  inputClassName,
} from '@/components/form-controls';
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

/** Only `admin` memberships apply to this page — same helper as the other
 *  admin pages, kept local rather than shared since each already duplicates
 *  it (see collection-points/page.tsx). */
function adminMembershipsOf(memberships: TeamMembership[]): TeamMembership[] {
  return memberships.filter((m) => m.role === 'admin');
}

export default function AdminPlayersPage() {
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
    ...adminNavItems(navTeamId, t, 'players'),
  ];

  return (
    <AppShell
      brand={t('common.appName')}
      navItems={navItems}
      accentColor={activeAdminMembership.primaryColor}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('adminPlayers.title')}</h1>

        {adminMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={adminMemberships.map((m) => ({ id: m.teamId, label: m.teamName }))}
            activeId={activeTeamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}

        {activeTeamId && <PlayersWorkspace key={activeTeamId} teamId={activeTeamId} />}
      </div>
    </AppShell>
  );
}

function PlayersWorkspace({ teamId }: { teamId: string }) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [players, setPlayers] = useState<PlayerSummary[] | null>(null);
  const [roster, setRoster] = useState<TeamRosterEntry[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editingPlayer, setEditingPlayer] = useState<PlayerSummary | 'new' | null>(null);
  const [deletingPlayer, setDeletingPlayer] = useState<PlayerSummary | null>(null);

  const fetchAll = useCallback(
    () => Promise.all([api.listPlayers(teamId), api.listTeamRoster(teamId)]),
    [teamId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then(([playersData, rosterData]) => {
        if (cancelled) return;
        setPlayers(playersData.players);
        setRoster(rosterData.members);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  const reload = useCallback(() => {
    setLoadState('loading');
    fetchAll()
      .then(([playersData, rosterData]) => {
        setPlayers(playersData.players);
        setRoster(rosterData.members);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }, [fetchAll]);

  async function handleDelete() {
    if (!deletingPlayer) return;
    try {
      await api.deletePlayer(teamId, deletingPlayer.id);
      setPlayers((prev) => (prev ? prev.filter((p) => p.id !== deletingPlayer.id) : prev));
      setDeletingPlayer(null);
    } catch (err) {
      setDeletingPlayer(null);
      showToast(err instanceof ApiError ? err.message : t('common.somethingWentWrong'), 'error');
    }
  }

  function handleSaved(saved: PlayerSummary) {
    setPlayers((prev) => {
      if (!prev) return prev;
      const next = prev.some((p) => p.id === saved.id)
        ? prev.map((p) => (p.id === saved.id ? saved : p))
        : [...prev, saved];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
    setEditingPlayer(null);
  }

  if (loadState === 'loading') {
    return <LoadingState label={t('adminPlayers.loading')} />;
  }

  if (loadState === 'error' || !players) {
    return (
      <ErrorState
        title={t('adminPlayers.loadError')}
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
        onClick={() => setEditingPlayer('new')}
      >
        <Plus className="me-1.5 -ms-0.5 inline size-4" aria-hidden="true" />
        {t('adminPlayers.addButton')}
      </button>

      {players.length === 0 ? (
        <EmptyState title={t('adminPlayers.empty')} />
      ) : (
        <DataList ariaLabel={t('adminPlayers.title')}>
          {players.map((player) => (
            <DataListItem key={player.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {player.name}
                  {player.age !== null && <span className="text-ink-muted"> · {player.age}</span>}
                </p>
                <p className="text-sm text-ink-muted">
                  {player.parentNames.length > 0
                    ? player.parentNames.join(', ')
                    : t('adminPlayers.noParentsLinked')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  label={t('adminPlayers.editAriaLabel', { name: player.name })}
                  icon={<Pencil className="size-4" aria-hidden="true" />}
                  onClick={() => setEditingPlayer(player)}
                />
                <IconButton
                  label={t('adminPlayers.deleteAriaLabel', { name: player.name })}
                  icon={<Trash2 className="size-4" aria-hidden="true" />}
                  variant="danger"
                  onClick={() => setDeletingPlayer(player)}
                />
              </div>
            </DataListItem>
          ))}
        </DataList>
      )}

      {editingPlayer && (
        <PlayerFormDialog
          teamId={teamId}
          player={editingPlayer === 'new' ? null : editingPlayer}
          roster={roster}
          onClose={() => setEditingPlayer(null)}
          onSaved={handleSaved}
        />
      )}

      <ConfirmDialog
        open={deletingPlayer !== null}
        title={t('adminPlayers.deleteConfirmTitle')}
        description={t('adminPlayers.deleteConfirmBody')}
        confirmLabel={t('adminPlayers.deleteConfirmButton')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeletingPlayer(null)}
      />
    </div>
  );
}

function PlayerFormDialog({
  teamId,
  player,
  roster,
  onClose,
  onSaved,
}: {
  teamId: string;
  player: PlayerSummary | null;
  roster: TeamRosterEntry[];
  onClose: () => void;
  onSaved: (saved: PlayerSummary) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(player?.name ?? '');
  const [age, setAge] = useState(
    player?.age !== undefined && player?.age !== null ? String(player.age) : '',
  );
  // A player's currently-linked parents aren't known from PlayerSummary
  // alone (the list response only denormalizes names, not ids) — editing an
  // existing player's parent links starts from nothing selected rather than
  // pre-checked, same as if the admin were re-choosing them fresh. Adding a
  // player has no prior state to lose either way.
  const [parentUserIds, setParentUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleParent(userId: string) {
    setParentUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const body = {
        name,
        age: age.trim() === '' ? undefined : Number(age),
        parentUserIds,
      };
      const saved = player
        ? await api.updatePlayer(teamId, player.id, body)
        : await api.createPlayer(teamId, body);
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
      title={player ? t('adminPlayers.formTitleEdit') : t('adminPlayers.formTitleCreate')}
      closeLabel={t('common.close')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('adminPlayers.nameLabel')}>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClassName}
          />
        </Field>
        <Field label={t('adminPlayers.ageLabel')}>
          <input
            type="number"
            min={0}
            max={25}
            step={1}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className={inputClassName}
          />
        </Field>
        {roster.length > 0 ? (
          <FieldsetGroup legend={t('adminPlayers.parentsFieldsetLabel')}>
            <div className="flex flex-col gap-2">
              {roster.map((member) => (
                <label
                  key={member.userId}
                  className="inline-flex min-h-11 items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={parentUserIds.includes(member.userId)}
                    onChange={() => toggleParent(member.userId)}
                    className={focusRingClassName}
                  />
                  {member.name}
                </label>
              ))}
            </div>
          </FieldsetGroup>
        ) : (
          <p className="text-sm text-ink-muted">{t('adminPlayers.noTeamMembers')}</p>
        )}
        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={isSubmitting} className={`${buttonClassName} self-end`}>
          {isSubmitting ? t('adminPlayers.saving') : t('adminPlayers.save')}
        </button>
      </form>
    </Dialog>
  );
}
