'use client';

import type { CurrentUserResponse, TeamMemberSummary, TeamMembership } from '@soccer/contracts';
import { formatDate } from '@soccer/i18n';
import {
  Calendar,
  Copy,
  Home,
  KeyRound,
  Search,
  ShieldCheck,
  ShieldMinus,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Field,
  FormError,
  buttonClassName,
  dangerButtonClassName,
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

type RoleFilter = 'all' | 'parent' | 'admin';
type MemberAction = 'promote' | 'demote' | 'remove';

interface PendingAction {
  kind: MemberAction;
  member: TeamMemberSummary;
}

function adminMembershipsOf(memberships: TeamMembership[]): TeamMembership[] {
  return memberships.filter((membership) => membership.role === 'admin');
}

export default function AdminMembersPage() {
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
  const activeAdminMembership =
    adminMemberships.find((m) => m.teamId === navTeamId) ?? firstAdminMembership;
  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    notificationsNavItem(navTeamId, t),
    swapsNavItem(navTeamId, t),
    settingsNavItem(t),
    ...adminNavItems(navTeamId, t, 'members'),
  ];

  return (
    <AppShell
      brand={t('common.appName')}
      navItems={navItems}
      accentColor={activeAdminMembership.primaryColor}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('adminMembers.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('adminMembers.subtitle')}</p>
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

        {activeTeamId && (
          <MembersWorkspace
            key={activeTeamId}
            teamId={activeTeamId}
            currentUserId={session.user.id}
          />
        )}
      </div>
    </AppShell>
  );
}

function MembersWorkspace({ teamId, currentUserId }: { teamId: string; currentUserId: string }) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const { showToast } = useToast();
  const [members, setMembers] = useState<TeamMemberSummary[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [inviteContact, setInviteContact] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [onboardingCode, setOnboardingCode] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const [addParentName, setAddParentName] = useState('');
  const [addParentContact, setAddParentContact] = useState('');
  const [addParentPassword, setAddParentPassword] = useState('');
  const [addParentPasswordConfirmation, setAddParentPasswordConfirmation] = useState('');
  const [addParentError, setAddParentError] = useState<string | null>(null);
  const [isAddingParent, setIsAddingParent] = useState(false);

  const [passwordTarget, setPasswordTarget] = useState<TeamMemberSummary | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const [setPasswordError, setSetPasswordError] = useState<string | null>(null);
  const [isSettingPassword, setIsSettingPassword] = useState(false);

  const fetchMembers = useCallback(() => api.listTeamMembers(teamId), [teamId]);

  useEffect(() => {
    let cancelled = false;
    fetchMembers()
      .then((data) => {
        if (cancelled) return;
        setMembers(data.members);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [fetchMembers]);

  const reload = useCallback(() => {
    setLoadState('loading');
    fetchMembers()
      .then((data) => {
        setMembers(data.members);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }, [fetchMembers]);

  const filteredMembers = useMemo(() => {
    if (!members) return [];
    const query = search.trim().toLocaleLowerCase(locale);
    return members.filter((member) => {
      const matchesRole = roleFilter === 'all' || member.role === roleFilter;
      const matchesSearch =
        query.length === 0 ||
        [member.name, member.phone, member.email].some((value) =>
          value?.toLocaleLowerCase(locale).includes(query),
        );
      return matchesRole && matchesSearch;
    });
  }, [locale, members, roleFilter, search]);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    const contact = inviteContact.trim();
    if (!contact) return;

    setInviteError(null);
    // Never leave a prior person's invite link beside a new request. If the
    // new request fails, the admin must not accidentally share the stale link.
    setInviteCode(null);
    setOnboardingCode(null);
    setIsInviting(true);
    try {
      const invite = await api.createInvite(
        teamId,
        contact.includes('@') ? { email: contact } : { phone: contact },
      );
      setInviteCode(invite.code);
      setOnboardingCode(invite.onboardingCode ?? null);
      setInviteContact('');
    } catch (error) {
      setInviteError(error instanceof ApiError ? error.message : t('common.somethingWentWrong'));
    } finally {
      setIsInviting(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteCode) return;
    const url = `${window.location.origin}/invite/${inviteCode}`;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(url);
      showToast(t('adminMembers.inviteCopied'), 'success');
    } catch {
      showToast(t('adminMembers.inviteCopyFailed'), 'error');
    }
  }

  async function handleAddParent(event: FormEvent) {
    event.preventDefault();
    setAddParentError(null);
    setIsAddingParent(true);
    try {
      const contact = addParentContact.trim();
      const added = await api.addParent(teamId, {
        name: addParentName,
        language: locale,
        password: addParentPassword,
        passwordConfirmation: addParentPasswordConfirmation,
        ...(contact.includes('@') ? { email: contact } : { phone: contact }),
      });
      setMembers((current) => (current ? [...current, added] : [added]));
      setAddParentName('');
      setAddParentContact('');
      setAddParentPassword('');
      setAddParentPasswordConfirmation('');
      showToast(t('adminMembers.addParentSuccess', { name: added.name }), 'success');
    } catch (error) {
      setAddParentError(error instanceof ApiError ? error.message : t('common.somethingWentWrong'));
    } finally {
      setIsAddingParent(false);
    }
  }

  async function handleSetPassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordTarget) return;
    setSetPasswordError(null);
    setIsSettingPassword(true);
    try {
      await api.setMemberPassword(teamId, passwordTarget.userId, {
        password: newPassword,
        passwordConfirmation: newPasswordConfirmation,
      });
      showToast(t('adminMembers.setPasswordSuccess', { name: passwordTarget.name }), 'success');
      setPasswordTarget(null);
      setNewPassword('');
      setNewPasswordConfirmation('');
    } catch (error) {
      setSetPasswordError(
        error instanceof ApiError ? error.message : t('common.somethingWentWrong'),
      );
    } finally {
      setIsSettingPassword(false);
    }
  }

  async function handleConfirmAction() {
    if (!pendingAction) return;
    const { kind, member } = pendingAction;
    setIsMutating(true);

    try {
      if (kind === 'remove') {
        await api.removeTeamMember(teamId, member.userId);
        setMembers((current) => current?.filter((item) => item.userId !== member.userId) ?? null);
        showToast(t('adminMembers.removed', { name: member.name }), 'success');
      } else {
        const role = kind === 'promote' ? 'admin' : 'parent';
        const updated = await api.updateTeamMemberRole(teamId, member.userId, { role });
        setMembers(
          (current) =>
            current?.map((item) =>
              item.userId === updated.userId ? { ...item, role: updated.role } : item,
            ) ?? null,
        );
        showToast(
          t(kind === 'promote' ? 'adminMembers.promoted' : 'adminMembers.demoted', {
            name: member.name,
          }),
          'success',
        );
      }

      setPendingAction(null);
      if (member.userId === currentUserId && kind !== 'promote') {
        router.replace('/home');
      }
    } catch (error) {
      setPendingAction(null);
      showToast(
        error instanceof ApiError ? error.message : t('common.somethingWentWrong'),
        'error',
      );
      // 409 means the target changed (e.g. a concurrent last-admin conflict); 403
      // can mean the acting admin's own role was just changed by someone else.
      // Either way, the member list and disabled-control state may now be stale.
      if (error instanceof ApiError && (error.status === 409 || error.status === 403)) reload();
    } finally {
      setIsMutating(false);
    }
  }

  const confirmation = pendingAction
    ? {
        title: t(`adminMembers.${pendingAction.kind}ConfirmTitle`, {
          name: pendingAction.member.name,
        }),
        body: t(`adminMembers.${pendingAction.kind}ConfirmBody`),
        button: t(`adminMembers.${pendingAction.kind}ConfirmButton`),
      }
    : null;

  if (loadState === 'loading') return <LoadingState label={t('adminMembers.loading')} />;
  if (loadState === 'error' || !members) {
    return (
      <ErrorState
        title={t('adminMembers.loadError')}
        action={
          <button type="button" className={buttonClassName} onClick={reload}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  const adminCount = members.filter((member) => member.role === 'admin').length;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="invite-parent-title" className="flex flex-col gap-3">
        <h2 id="invite-parent-title" className="text-lg font-semibold">
          {t('adminMembers.inviteSectionTitle')}
        </h2>
        <form
          onSubmit={handleInvite}
          className="rounded-xl border border-surface-border bg-surface p-4 shadow-raised"
        >
          <Field label={t('adminMembers.inviteContactLabel')}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                required
                type="text"
                autoComplete="off"
                value={inviteContact}
                onChange={(event) => setInviteContact(event.target.value)}
                className={`${inputClassName} flex-1`}
                placeholder={t('adminMembers.inviteContactPlaceholder')}
                dir="ltr"
              />
              <button
                type="submit"
                disabled={isInviting}
                className={`${buttonClassName} gap-2 whitespace-nowrap`}
              >
                <UserPlus className="size-4" aria-hidden="true" />
                {isInviting ? t('adminMembers.inviteSubmitting') : t('adminMembers.inviteSubmit')}
              </button>
            </div>
          </Field>
          {inviteError && <FormError>{inviteError}</FormError>}
          {inviteCode && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-status-mine-on">
              <span>
                {t('adminMembers.inviteLinkLabel')}{' '}
                <code className="break-all" dir="ltr">
                  /invite/{inviteCode}
                </code>
              </span>
              <IconButton
                label={t('adminMembers.copyInviteLinkAriaLabel')}
                icon={<Copy className="size-4" aria-hidden="true" />}
                onClick={handleCopyInviteLink}
              />
              {onboardingCode && (
                <span>
                  {t('adminMembers.inviteCodeLabel')} <code dir="ltr">{onboardingCode}</code>
                </span>
              )}
            </div>
          )}
        </form>
      </section>

      <section aria-labelledby="add-parent-title" className="flex flex-col gap-3">
        <h2 id="add-parent-title" className="text-lg font-semibold">
          {t('adminMembers.addParentSectionTitle')}
        </h2>
        <form
          onSubmit={handleAddParent}
          className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface p-4 shadow-raised"
        >
          <Field label={t('adminMembers.addParentNameLabel')}>
            <input
              required
              value={addParentName}
              onChange={(event) => setAddParentName(event.target.value)}
              className={inputClassName}
              placeholder="Avi Levi"
            />
          </Field>
          <Field label={t('adminMembers.addParentContactLabel')}>
            <input
              required
              type="text"
              autoComplete="off"
              value={addParentContact}
              onChange={(event) => setAddParentContact(event.target.value)}
              className={inputClassName}
              placeholder={t('adminMembers.inviteContactPlaceholder')}
              dir="ltr"
            />
          </Field>
          <Field label={t('adminMembers.addParentPasswordLabel')}>
            <input
              required
              type="password"
              minLength={15}
              maxLength={128}
              autoComplete="new-password"
              value={addParentPassword}
              onChange={(event) => setAddParentPassword(event.target.value)}
              className={inputClassName}
            />
          </Field>
          <Field label={t('adminMembers.addParentPasswordConfirmationLabel')}>
            <input
              required
              type="password"
              minLength={15}
              maxLength={128}
              autoComplete="new-password"
              value={addParentPasswordConfirmation}
              onChange={(event) => setAddParentPasswordConfirmation(event.target.value)}
              className={inputClassName}
            />
          </Field>
          {addParentError && <FormError>{addParentError}</FormError>}
          <button
            type="submit"
            disabled={isAddingParent}
            className={`${buttonClassName} self-start gap-2`}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            {isAddingParent
              ? t('adminMembers.addParentSubmitting')
              : t('adminMembers.addParentSubmit')}
          </button>
        </form>
      </section>

      <section aria-labelledby="team-members-title" className="flex flex-col gap-4">
        <h2 id="team-members-title" className="text-lg font-semibold">
          {t('adminMembers.membersSectionTitle', { count: members.length })}
        </h2>

        {members.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label={t('adminMembers.searchLabel')}>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className={`${inputClassName} w-full ps-10`}
                  placeholder={t('adminMembers.searchPlaceholder')}
                />
              </div>
            </Field>
            <Field label={t('adminMembers.roleFilterLabel')}>
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                className={inputClassName}
              >
                <option value="all">{t('adminMembers.filterAll')}</option>
                <option value="parent">{t('adminMembers.filterParents')}</option>
                <option value="admin">{t('adminMembers.filterAdmins')}</option>
              </select>
            </Field>
          </div>
        )}

        {members.length === 0 ? (
          <EmptyState title={t('adminMembers.empty')} />
        ) : filteredMembers.length === 0 ? (
          <EmptyState title={t('adminMembers.noMatches')} />
        ) : (
          <DataList ariaLabel={t('adminMembers.membersSectionTitle', { count: members.length })}>
            {filteredMembers.map((member) => {
              const isOnlyAdmin = member.role === 'admin' && adminCount === 1;
              const isCurrentUser = member.userId === currentUserId;
              return (
                <DataListItem key={member.userId} className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {member.name}
                        {isCurrentUser && (
                          <span className="ms-2 text-xs font-normal text-ink-muted">
                            ({t('adminMembers.you')})
                          </span>
                        )}
                      </p>
                      {member.phone && (
                        <p className="mt-1 break-all text-sm text-ink-muted" dir="ltr">
                          {member.phone}
                        </p>
                      )}
                      {member.email && (
                        <p className="break-all text-sm text-ink-muted" dir="ltr">
                          {member.email}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-ink-muted">
                        {t('adminMembers.joined', {
                          date: formatDate(locale, new Date(member.joinedAt), {
                            dateStyle: 'medium',
                          }),
                        })}
                      </p>
                    </div>
                    <span className="rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {t(
                        member.role === 'admin'
                          ? 'adminMembers.roleAdmin'
                          : 'adminMembers.roleParent',
                      )}
                    </span>
                  </div>

                  {isOnlyAdmin && (
                    <p className="text-sm text-ink-muted">{t('adminMembers.onlyAdminHint')}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {member.role === 'parent' ? (
                      <button
                        type="button"
                        disabled={isMutating}
                        className={`${secondaryButtonClassName} gap-2`}
                        onClick={() => setPendingAction({ kind: 'promote', member })}
                      >
                        <ShieldCheck className="size-4" aria-hidden="true" />
                        {t('adminMembers.promote')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isOnlyAdmin || isMutating}
                        className={`${secondaryButtonClassName} gap-2`}
                        onClick={() => setPendingAction({ kind: 'demote', member })}
                      >
                        <ShieldMinus className="size-4" aria-hidden="true" />
                        {t('adminMembers.demote')}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isOnlyAdmin || isMutating}
                      className={`${dangerButtonClassName} gap-2`}
                      onClick={() => setPendingAction({ kind: 'remove', member })}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t('adminMembers.remove')}
                    </button>
                    <button
                      type="button"
                      className={`${secondaryButtonClassName} gap-2`}
                      onClick={() => setPasswordTarget(member)}
                    >
                      <KeyRound className="size-4" aria-hidden="true" />
                      {t('adminMembers.setPassword')}
                    </button>
                  </div>
                </DataListItem>
              );
            })}
          </DataList>
        )}
      </section>

      <ConfirmDialog
        open={pendingAction !== null}
        title={confirmation?.title ?? ''}
        description={confirmation?.body}
        confirmLabel={confirmation?.button ?? ''}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        danger={pendingAction?.kind === 'remove'}
        confirmDisabled={isMutating}
        cancelDisabled={isMutating}
        onConfirm={handleConfirmAction}
        onCancel={() => {
          if (!isMutating) setPendingAction(null);
        }}
      />

      <Dialog
        open={passwordTarget !== null}
        onClose={() => {
          if (!isSettingPassword) {
            setPasswordTarget(null);
            setSetPasswordError(null);
            setNewPassword('');
            setNewPasswordConfirmation('');
          }
        }}
        closeDisabled={isSettingPassword}
        title={t('adminMembers.setPasswordTitle', { name: passwordTarget?.name ?? '' })}
        closeLabel={t('common.close')}
      >
        <form onSubmit={handleSetPassword} className="flex flex-col gap-3">
          <Field label={t('adminMembers.setPasswordNewLabel')}>
            <input
              required
              type="password"
              minLength={15}
              maxLength={128}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={inputClassName}
            />
          </Field>
          <Field label={t('adminMembers.setPasswordConfirmLabel')}>
            <input
              required
              type="password"
              minLength={15}
              maxLength={128}
              autoComplete="new-password"
              value={newPasswordConfirmation}
              onChange={(event) => setNewPasswordConfirmation(event.target.value)}
              className={inputClassName}
            />
          </Field>
          {setPasswordError && <FormError>{setPasswordError}</FormError>}
          <button type="submit" disabled={isSettingPassword} className={buttonClassName}>
            {isSettingPassword
              ? t('adminMembers.setPasswordSubmitting')
              : t('adminMembers.setPasswordSubmit')}
          </button>
        </form>
      </Dialog>
    </div>
  );
}
