'use client';

import type { SystemTeamMember, TeamRole } from '@soccer/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocale } from '@/components/locale-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { Dialog } from '@/components/ui/dialog';
import { AppShell } from '@/components/ui/shell';
import { ErrorState, LoadingState } from '@/components/ui/states';
import {
  Field,
  FormError,
  buttonClassName,
  inputClassName,
  secondaryButtonClassName,
} from '@/components/form-controls';
import { ApiError, api } from '@/lib/api';
import { systemNavItems } from '@/lib/system-nav';

export default function SystemTeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const router = useRouter();
  const { locale, t } = useLocale();
  const [members, setMembers] = useState<SystemTeamMember[] | null>(null);
  const [pending, setPending] = useState<SystemTeamMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const [addRole, setAddRole] = useState<TeamRole>('parent');
  const [addName, setAddName] = useState('');
  const [addContact, setAddContact] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addPasswordConfirmation, setAddPasswordConfirmation] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const [passwordTarget, setPasswordTarget] = useState<SystemTeamMember | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const [setPasswordError, setSetPasswordError] = useState<string | null>(null);
  const [isSettingPassword, setIsSettingPassword] = useState(false);

  // Guards every setState this component makes from its own async calls —
  // load() is invoked both from the mount effect below and from the
  // mutation handlers (changeRole/handleAddMember/handleSetPassword), so a
  // single ref covers all of them rather than only the mount-time call.
  const isMountedRef = useRef(true);
  useEffect(() => {
    // Strict Mode's dev-time phantom mount→cleanup→mount cycle runs the
    // cleanup below once even though the component never really unmounted —
    // without resetting the ref back to true here, that phantom cleanup
    // would permanently block every later setState this component makes.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const me = await api.me();
      if (!isMountedRef.current) return;
      if (me.systemRole !== 'system_admin') {
        router.replace('/home');
        return;
      }
      const response = await api.listSystemTeamMembers(teamId);
      if (isMountedRef.current) setMembers(response.members);
    } catch {
      if (isMountedRef.current) setError(true);
    }
  }, [router, teamId]);

  useEffect(() => {
    // Loading external system data on mount is the synchronization this effect performs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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

  async function handleAddMember(event: FormEvent) {
    event.preventDefault();
    setAddError(null);
    setIsAdding(true);
    try {
      const contact = addContact.trim();
      await api.systemAddMember(teamId, {
        role: addRole,
        name: addName,
        language: locale,
        password: addPassword,
        passwordConfirmation: addPasswordConfirmation,
        ...(contact.includes('@') ? { email: contact } : { phone: contact }),
      });
      setAddName('');
      setAddContact('');
      setAddPassword('');
      setAddPasswordConfirmation('');
      await load();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleSetPassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordTarget) return;
    setSetPasswordError(null);
    setIsSettingPassword(true);
    try {
      await api.systemSetPassword(passwordTarget.id, {
        password: newPassword,
        passwordConfirmation: newPasswordConfirmation,
      });
      setPasswordTarget(null);
      setNewPassword('');
      setNewPasswordConfirmation('');
    } catch (err) {
      setSetPasswordError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSettingPassword(false);
    }
  }

  return (
    <AppShell brand={t('common.appName')} navItems={systemNavItems(t)} hideChatBubble>
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
          <>
            <section aria-labelledby="add-member-title" className="flex flex-col gap-3">
              <h2 id="add-member-title" className="text-lg font-semibold">
                {t('system.addMemberTitle')}
              </h2>
              <form
                onSubmit={handleAddMember}
                className="grid gap-3 rounded-xl border border-surface-border bg-surface p-4 shadow-raised sm:grid-cols-2"
              >
                <Field label={t('system.addMemberRoleLabel')}>
                  <select
                    value={addRole}
                    onChange={(event) => setAddRole(event.target.value as TeamRole)}
                    className={inputClassName}
                  >
                    <option value="parent">{t('system.addMemberRoleParent')}</option>
                    <option value="admin">{t('system.addMemberRoleAdmin')}</option>
                  </select>
                </Field>
                <Field label={t('system.addMemberNameLabel')}>
                  <input
                    required
                    value={addName}
                    onChange={(event) => setAddName(event.target.value)}
                    className={inputClassName}
                    placeholder="Avi Levi"
                  />
                </Field>
                <Field label={t('system.addMemberContactLabel')}>
                  <input
                    required
                    type="text"
                    autoComplete="off"
                    value={addContact}
                    onChange={(event) => setAddContact(event.target.value)}
                    className={inputClassName}
                    dir="ltr"
                  />
                </Field>
                <Field label={t('teamsNew.passwordLabel')}>
                  <input
                    required
                    type="password"
                    minLength={15}
                    maxLength={128}
                    autoComplete="new-password"
                    value={addPassword}
                    onChange={(event) => setAddPassword(event.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <Field label={t('teamsNew.passwordConfirmationLabel')}>
                  <input
                    required
                    type="password"
                    minLength={15}
                    maxLength={128}
                    autoComplete="new-password"
                    value={addPasswordConfirmation}
                    onChange={(event) => setAddPasswordConfirmation(event.target.value)}
                    className={inputClassName}
                  />
                </Field>
                {addError && (
                  <div className="sm:col-span-2">
                    <FormError>{addError}</FormError>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isAdding}
                  className={`${buttonClassName} self-start sm:col-span-2`}
                >
                  {isAdding ? t('system.addMemberSubmitting') : t('system.addMemberSubmit')}
                </button>
              </form>
            </section>

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
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={secondaryButtonClassName}
                        onClick={() => setPasswordTarget(member)}
                      >
                        {t('system.setPassword')}
                      </button>
                      <button
                        type="button"
                        className={
                          member.role === 'admin' ? secondaryButtonClassName : buttonClassName
                        }
                        onClick={() => setPending(member)}
                      >
                        {member.role === 'admin' ? t('system.demote') : t('system.promote')}
                      </button>
                    </div>
                  </div>
                </DataListItem>
              ))}
            </DataList>
          </>
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
        title={t('system.setPasswordTitle', { name: passwordTarget?.name ?? '' })}
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
    </AppShell>
  );
}
