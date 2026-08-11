'use client';

import type {
  CurrentUserResponse,
  PlayerSummary,
  PracticeSession,
  ShiftDirection,
  ShiftSummary,
  TeamRosterEntry,
} from '@soccer/contracts';
import type { Locale } from '@soccer/i18n';
import type { StatusTone } from '@soccer/ui-tokens';
import { focusRingClassName } from '@soccer/ui-tokens';
import { Ban, Calendar, Home, Pencil, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Field,
  FieldsetGroup,
  FormError,
  buttonClassName,
  inputClassName,
  secondaryButtonClassName,
} from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { Dialog } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { TeamSwitcher } from '@/components/ui/team-switcher';
import { useToast } from '@/components/ui/toast';
import { adminNavItems } from '@/lib/admin-nav';
import { ApiError, api } from '@/lib/api';
import {
  formatSessionStartsAt,
  updateSessionInSessions,
  updateShiftInSessions,
} from '@/lib/sessions';

function toneFor(shift: ShiftSummary, currentUserId: string): StatusTone {
  if (shift.status === 'open') return 'open';
  return shift.assignedUserId === currentUserId ? 'mine' : 'covered';
}

/** A session is a read-only historical record once its start time has passed —
 * mirrors the API's own `assertSessionNotPast` guard, so admin controls never
 * show for an action the server would reject anyway. */
function isSessionPast(startsAt: string): boolean {
  return new Date(startsAt).getTime() <= Date.now();
}

/** Combines separate date/time inputs into the literal-UTC-wall-clock ISO string
 * this codebase's session times are stored as (see the API's `combineDateAndTime`
 * doc comment) — not a true timezone-aware instant. */
function buildStartsAt(date: string, time: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new Error(`Invalid date/time: ${date} ${time}`);
  }
  const [, year, month, day] = dateMatch;
  const [, hours, minutes] = timeMatch;
  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)),
  ).toISOString();
}

export default function SchedulePage() {
  const router = useRouter();
  // Lets a link from another page (e.g. Home's "+N more" under a specific
  // team's help-needed list) open the schedule already scoped to that team,
  // instead of always defaulting to the user's first membership.
  const requestedTeamId = useSearchParams().get('team');
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
        const requestedMembership = data.teamMemberships.find(
          (membership) => membership.teamId === requestedTeamId,
        );
        setActiveTeamId(requestedMembership?.teamId ?? data.teamMemberships[0]?.teamId ?? null);
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
      router.replace('/login');
    }
  }, [authStatus, router]);

  if (authStatus !== 'ready' || !session) {
    return null;
  }

  const activeMembership =
    session.teamMemberships.find((membership) => membership.teamId === activeTeamId) ??
    session.teamMemberships[0];

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    {
      href: '/schedule',
      label: t('nav.schedule'),
      icon: <Calendar className="size-full" />,
      active: true,
    },
    ...(activeMembership?.role === 'admin' ? adminNavItems(activeMembership.teamId, t) : []),
  ];

  return (
    <AppShell brand={t('common.appName')} navItems={navItems}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('schedule.title')}</h1>

        {session.teamMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={session.teamMemberships.map((membership) => ({
              id: membership.teamId,
              label: membership.teamName,
            }))}
            activeId={activeTeamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}

        {/* Keyed on team so switching teams remounts this subtree and fetches
            fresh — avoids a synchronous setState-on-dependency-change effect. */}
        {activeTeamId && (
          <ScheduleSessions
            key={activeTeamId}
            teamId={activeTeamId}
            currentUserId={session.user.id}
            isAdmin={activeMembership?.role === 'admin'}
          />
        )}
      </div>
    </AppShell>
  );
}

function ScheduleSessions({
  teamId,
  currentUserId,
  isAdmin,
}: {
  teamId: string;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const { t, locale } = useLocale();
  const { showToast } = useToast();
  const [sessions, setSessions] = useState<PracticeSession[] | null>(null);
  const [players, setPlayers] = useState<PlayerSummary[] | null>(null);
  const [roster, setRoster] = useState<TeamRosterEntry[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pendingShiftId, setPendingShiftId] = useState<string | null>(null);
  const [editingSession, setEditingSession] = useState<PracticeSession | null>(null);
  const [cancellingSession, setCancellingSession] = useState<PracticeSession | null>(null);
  const [managingPoint, setManagingPoint] = useState<{
    session: PracticeSession;
    pointId: string;
    direction: ShiftDirection;
    pointLabel: string;
    playerIds: string[];
  } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const fetchAll = useCallback(
    () =>
      Promise.all([api.listSessions(teamId), api.listPlayers(teamId), api.listTeamRoster(teamId)]),
    [teamId],
  );

  // The mount effect below fetches without an eager `setLoadState('loading')` —
  // `loadState` already starts as 'loading' via useState, so there's nothing to
  // reset on first mount, and every setState here happens inside the promise
  // continuation rather than synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then(([sessionsRes, playersRes, rosterRes]) => {
        if (cancelled) return;
        setSessions(sessionsRes.sessions);
        setPlayers(playersRes.players);
        setRoster(rosterRes.members);
        setLoadState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  // Used for the retry button and for re-syncing after a claim/release conflict —
  // both are event-driven (not inside an effect body), so the eager
  // `setLoadState('loading')` here is fine.
  const reload = useCallback(() => {
    setLoadState('loading');
    fetchAll()
      .then(([sessionsRes, playersRes, rosterRes]) => {
        setSessions(sessionsRes.sessions);
        setPlayers(playersRes.players);
        setRoster(rosterRes.members);
        setLoadState('ready');
      })
      .catch(() => {
        setLoadState('error');
      });
  }, [fetchAll]);

  const playersById = useMemo(
    () => new Map((players ?? []).map((player) => [player.id, player.name])),
    [players],
  );

  async function handleClaim(shiftId: string) {
    setPendingShiftId(shiftId);
    try {
      const updated = await api.claimShift(teamId, shiftId);
      setSessions((prev) => (prev ? updateShiftInSessions(prev, shiftId, updated) : prev));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const holderName =
          typeof err.details?.holderName === 'string' ? err.details.holderName : null;
        showToast(
          holderName
            ? t('schedule.claimConflictWithName', { name: holderName })
            : t('schedule.claimConflictUnknown'),
          'error',
        );
        reload();
      } else {
        showToast(t('common.somethingWentWrong'), 'error');
      }
    } finally {
      setPendingShiftId(null);
    }
  }

  async function handleRelease(shiftId: string) {
    setPendingShiftId(shiftId);
    try {
      const updated = await api.releaseShift(teamId, shiftId);
      setSessions((prev) => (prev ? updateShiftInSessions(prev, shiftId, updated) : prev));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast(t('schedule.releaseConflict'), 'error');
        reload();
      } else {
        showToast(t('common.somethingWentWrong'), 'error');
      }
    } finally {
      setPendingShiftId(null);
    }
  }

  function handleSessionSaved(updated: PracticeSession) {
    setSessions((prev) => (prev ? updateSessionInSessions(prev, updated) : prev));
    setEditingSession(null);
  }

  async function handleCancelConfirmed() {
    if (!cancellingSession) return;
    setIsCancelling(true);
    try {
      const updated = await api.cancelSession(teamId, cancellingSession.id);
      setSessions((prev) => (prev ? updateSessionInSessions(prev, updated) : prev));
      setCancellingSession(null);
    } catch (err) {
      setCancellingSession(null);
      showToast(err instanceof ApiError ? err.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setIsCancelling(false);
    }
  }

  function handlePlayersSaved(updated: PracticeSession) {
    setSessions((prev) => (prev ? updateSessionInSessions(prev, updated) : prev));
    setManagingPoint(null);
  }

  if (loadState === 'loading') {
    return <LoadingState label={t('schedule.loading')} />;
  }

  if (loadState === 'error' || !sessions || !players || !roster) {
    return (
      <ErrorState
        title={t('schedule.loadError')}
        action={
          <button type="button" className={secondaryButtonClassName} onClick={reload}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {sessions.length === 0 ? (
        <EmptyState title={t('schedule.empty')} />
      ) : (
        <DataList ariaLabel={t('schedule.title')}>
          {sessions.map((practiceSession) => (
            <SessionCard
              key={practiceSession.id}
              practiceSession={practiceSession}
              currentUserId={currentUserId}
              locale={locale}
              isAdmin={isAdmin}
              playersById={playersById}
              pendingShiftId={pendingShiftId}
              onClaim={handleClaim}
              onRelease={handleRelease}
              onEdit={setEditingSession}
              onCancelRequest={setCancellingSession}
              onManagePlayers={(point) => setManagingPoint(point)}
            />
          ))}
        </DataList>
      )}

      <TeamRosterSection roster={roster} />

      {editingSession && (
        <SessionEditDialog
          teamId={teamId}
          practiceSession={editingSession}
          onClose={() => setEditingSession(null)}
          onSaved={handleSessionSaved}
        />
      )}

      <ConfirmDialog
        open={cancellingSession !== null}
        title={t('schedule.cancelSessionConfirmTitle')}
        description={t('schedule.cancelSessionConfirmBody')}
        confirmLabel={
          isCancelling ? t('schedule.cancellingSession') : t('schedule.cancelSessionConfirmButton')
        }
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        danger
        onConfirm={handleCancelConfirmed}
        onCancel={() => setCancellingSession(null)}
      />

      {managingPoint && (
        <ManagePlayersDialog
          teamId={teamId}
          sessionId={managingPoint.session.id}
          pointId={managingPoint.pointId}
          direction={managingPoint.direction}
          pointLabel={managingPoint.pointLabel}
          players={players}
          initialPlayerIds={managingPoint.playerIds}
          onClose={() => setManagingPoint(null)}
          onSaved={handlePlayersSaved}
        />
      )}
    </div>
  );
}

function SessionCard({
  practiceSession,
  currentUserId,
  locale,
  isAdmin,
  playersById,
  pendingShiftId,
  onClaim,
  onRelease,
  onEdit,
  onCancelRequest,
  onManagePlayers,
}: {
  practiceSession: PracticeSession;
  currentUserId: string;
  locale: Locale;
  isAdmin: boolean;
  playersById: Map<string, string>;
  pendingShiftId: string | null;
  onClaim: (shiftId: string) => void;
  onRelease: (shiftId: string) => void;
  onEdit: (session: PracticeSession) => void;
  onCancelRequest: (session: PracticeSession) => void;
  onManagePlayers: (point: {
    session: PracticeSession;
    pointId: string;
    direction: ShiftDirection;
    pointLabel: string;
    playerIds: string[];
  }) => void;
}) {
  const { t } = useLocale();
  const formatted = formatSessionStartsAt(locale, practiceSession.startsAt);
  const canManage =
    isAdmin && practiceSession.status === 'scheduled' && !isSessionPast(practiceSession.startsAt);

  return (
    <DataListItem className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{formatted}</p>
          <p className="text-sm text-ink-muted">{practiceSession.fieldLocation}</p>
        </div>
        <div className="flex items-center gap-2">
          {practiceSession.status === 'cancelled' && (
            <span className="rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t('schedule.cancelled')}
            </span>
          )}
          {canManage && (
            <>
              <IconButton
                label={t('schedule.editSessionAriaLabel', { date: formatted })}
                icon={<Pencil className="size-4" aria-hidden="true" />}
                onClick={() => onEdit(practiceSession)}
              />
              <IconButton
                label={t('schedule.cancelSessionAriaLabel', { date: formatted })}
                icon={<Ban className="size-4" aria-hidden="true" />}
                variant="danger"
                onClick={() => onCancelRequest(practiceSession)}
              />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {practiceSession.points.map((point) => {
          const tone = toneFor(point.shift, currentUserId);
          const label =
            tone === 'mine'
              ? t('schedule.statusMine')
              : tone === 'covered'
                ? t('schedule.statusCoveredBy', { name: point.shift.assignedUserName ?? '' })
                : t('schedule.statusOpen');
          const isPending = pendingShiftId === point.shift.id;
          const canClaim = practiceSession.status === 'scheduled' && point.shift.status === 'open';
          const canRelease = practiceSession.status === 'scheduled' && tone === 'mine';
          const directionLabel =
            point.direction === 'to_practice'
              ? t('schedule.toPractice')
              : t('schedule.fromPractice');
          const pointLabel = `${directionLabel} · ${point.pointName}`;
          const playerNames = point.playerIds
            .map((id) => playersById.get(id))
            .filter((name): name is string => Boolean(name));

          return (
            <div
              key={`${point.pointId}-${point.direction}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-soft p-3"
            >
              <div>
                <p className="text-sm font-medium">{pointLabel}</p>
                <p className="text-xs text-ink-muted">
                  {playerNames.length > 0
                    ? playerNames.join(', ')
                    : t('schedule.noPlayersAssigned')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={tone} label={label} />
                {canManage && (
                  <IconButton
                    label={t('schedule.managePlayersAriaLabel', { point: pointLabel })}
                    icon={<Users className="size-4" aria-hidden="true" />}
                    onClick={() =>
                      onManagePlayers({
                        session: practiceSession,
                        pointId: point.pointId,
                        direction: point.direction,
                        pointLabel,
                        playerIds: point.playerIds,
                      })
                    }
                  />
                )}
                {canClaim && (
                  <button
                    type="button"
                    disabled={isPending}
                    className={`${buttonClassName} text-sm`}
                    onClick={() => onClaim(point.shift.id)}
                  >
                    {isPending ? t('schedule.claiming') : t('schedule.claim')}
                  </button>
                )}
                {canRelease && (
                  <button
                    type="button"
                    disabled={isPending}
                    className={`${secondaryButtonClassName} text-sm`}
                    onClick={() => onRelease(point.shift.id)}
                  >
                    {isPending ? t('schedule.releasing') : t('schedule.release')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </DataListItem>
  );
}

function SessionEditDialog({
  teamId,
  practiceSession,
  onClose,
  onSaved,
}: {
  teamId: string;
  practiceSession: PracticeSession;
  onClose: () => void;
  onSaved: (updated: PracticeSession) => void;
}) {
  const { t } = useLocale();
  const startsAtDate = new Date(practiceSession.startsAt);
  const [date, setDate] = useState(startsAtDate.toISOString().slice(0, 10));
  const [time, setTime] = useState(startsAtDate.toISOString().slice(11, 16));
  const [fieldLocation, setFieldLocation] = useState(practiceSession.fieldLocation);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await api.updateSession(teamId, practiceSession.id, {
        startsAt: buildStartsAt(date, time),
        fieldLocation,
      });
      onSaved(updated);
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
      title={t('schedule.editDialogTitle')}
      closeLabel={t('common.close')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('schedule.dateLabel')}>
          <input
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClassName}
          />
        </Field>
        <Field label={t('schedule.timeLabel')}>
          <input
            required
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={inputClassName}
          />
        </Field>
        <Field label={t('schedule.fieldLocationLabel')}>
          <input
            required
            value={fieldLocation}
            onChange={(e) => setFieldLocation(e.target.value)}
            className={inputClassName}
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={isSubmitting} className={`${buttonClassName} self-end`}>
          {isSubmitting ? t('schedule.saving') : t('schedule.save')}
        </button>
      </form>
    </Dialog>
  );
}

function ManagePlayersDialog({
  teamId,
  sessionId,
  pointId,
  direction,
  pointLabel,
  players,
  initialPlayerIds,
  onClose,
  onSaved,
}: {
  teamId: string;
  sessionId: string;
  pointId: string;
  direction: ShiftDirection;
  pointLabel: string;
  players: PlayerSummary[];
  initialPlayerIds: string[];
  onClose: () => void;
  onSaved: (updated: PracticeSession) => void;
}) {
  const { t } = useLocale();
  const [selectedIds, setSelectedIds] = useState<string[]>(initialPlayerIds);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function togglePlayer(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await api.updateSessionPointPlayers(teamId, sessionId, pointId, {
        direction,
        playerIds: selectedIds,
      });
      onSaved(updated);
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
      title={t('schedule.managePlayersDialogTitle')}
      closeLabel={t('common.close')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">{pointLabel}</p>
        {players.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('schedule.noPlayersOnTeam')}</p>
        ) : (
          <FieldsetGroup legend={t('schedule.playersFieldsetLabel')}>
            <div className="flex flex-col gap-2">
              {players.map((player) => (
                <label key={player.id} className="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(player.id)}
                    onChange={() => togglePlayer(player.id)}
                    className={focusRingClassName}
                  />
                  {player.name}
                </label>
              ))}
            </div>
          </FieldsetGroup>
        )}
        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={isSubmitting} className={`${buttonClassName} self-end`}>
          {isSubmitting ? t('schedule.saving') : t('schedule.save')}
        </button>
      </form>
    </Dialog>
  );
}

function TeamRosterSection({ roster }: { roster: TeamRosterEntry[] }) {
  const { t } = useLocale();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
        {t('schedule.teamSectionTitle')}
      </h2>
      <DataList ariaLabel={t('schedule.teamSectionTitle')}>
        {roster.map((member) => (
          <DataListItem key={member.userId} className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{member.name}</span>
            <span className="rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {member.role === 'admin' ? t('home.roleAdmin') : t('home.roleParent')}
            </span>
          </DataListItem>
        ))}
      </DataList>
    </section>
  );
}
