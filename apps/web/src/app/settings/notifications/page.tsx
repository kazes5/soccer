'use client';

import { WebAuthnError, browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import {
  REMINDER_OFFSET_MINUTES_MAX_COUNT,
  notificationCategorySchema,
  type CurrentUserResponse,
  type MemberNotificationPreferences,
  type NotificationCategory,
  type TeamNotificationSettings,
} from '@soccer/contracts';
import { focusRingClassName } from '@soccer/ui-tokens';
import { Calendar, Home, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Field,
  FieldsetGroup,
  FormError,
  buttonClassName,
  inputClassName,
  secondaryButtonClassName,
} from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { IconButton } from '@/components/ui/icon-button';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { TeamSwitcher } from '@/components/ui/team-switcher';
import { useToast } from '@/components/ui/toast';
import {
  adminNavItems,
  notificationsNavItem,
  settingsNavItem,
  swapsNavItem,
} from '@/lib/admin-nav';
import { ApiError, api } from '@/lib/api';
import { disablePush, enablePush, getPushStatus, type PushStatus } from '@/lib/push';
import { buildLoginRedirect } from '@/lib/safe-redirect';

export default function NotificationPreferencesPage() {
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
        const requested = data.teamMemberships.find((m) => m.teamId === requestedTeamId);
        setActiveTeamId(requested?.teamId ?? data.teamMemberships[0]?.teamId ?? null);
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

  if (authStatus !== 'ready' || !session) {
    return null;
  }

  const activeMembership =
    session.teamMemberships.find((m) => m.teamId === activeTeamId) ?? session.teamMemberships[0];

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    ...(activeMembership ? [notificationsNavItem(activeMembership.teamId, t)] : []),
    ...(activeMembership ? [swapsNavItem(activeMembership.teamId, t)] : []),
    settingsNavItem(t, true),
    ...(activeMembership?.role === 'admin' ? adminNavItems(activeMembership.teamId, t) : []),
  ];

  return (
    <AppShell brand={t('common.appName')} navItems={navItems}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('settingsNotifications.title')}</h1>

        <PasskeySection
          authMethod={session.authMethod}
          onUpgraded={() =>
            setSession((current) => (current ? { ...current, authMethod: 'passkey' } : current))
          }
        />

        {session.teamMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={session.teamMemberships.map((m) => ({ id: m.teamId, label: m.teamName }))}
            activeId={activeTeamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}

        {activeTeamId && <PreferencesWorkspace key={activeTeamId} teamId={activeTeamId} />}
      </div>
    </AppShell>
  );
}

function PreferencesWorkspace({ teamId }: { teamId: string }) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [preferences, setPreferences] = useState<MemberNotificationPreferences | null>(null);
  const [teamDefaults, setTeamDefaults] = useState<TeamNotificationSettings | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(
    () => Promise.all([api.getMemberPreferences(teamId), api.getNotificationSettings(teamId)]),
    [teamId],
  );

  useEffect(() => {
    let cancelled = false;
    load()
      .then(([prefs, defaults]) => {
        if (cancelled) return;
        setPreferences(prefs);
        setTeamDefaults(defaults);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  function reload() {
    setLoadState('loading');
    load()
      .then(([prefs, defaults]) => {
        setPreferences(prefs);
        setTeamDefaults(defaults);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }

  if (loadState === 'loading') {
    return <LoadingState label={t('settingsNotifications.loading')} />;
  }

  if (loadState === 'error' || !preferences || !teamDefaults) {
    return (
      <ErrorState
        title={t('settingsNotifications.loadError')}
        action={
          <button type="button" className={buttonClassName} onClick={reload}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  return (
    <PreferencesForm
      teamId={teamId}
      preferences={preferences}
      teamDefaults={teamDefaults}
      onSaved={(saved) => {
        setPreferences(saved);
        showToast(t('settingsNotifications.saved'), 'success');
      }}
    />
  );
}

function PreferencesForm({
  teamId,
  preferences,
  teamDefaults,
  onSaved,
}: {
  teamId: string;
  preferences: MemberNotificationPreferences;
  teamDefaults: TeamNotificationSettings;
  onSaved: (saved: MemberNotificationPreferences) => void;
}) {
  const { t } = useLocale();
  const [useCustomQuietHours, setUseCustomQuietHours] = useState(
    preferences.quietHoursStart !== null,
  );
  const [quietHoursStart, setQuietHoursStart] = useState(
    preferences.quietHoursStart ?? teamDefaults.quietHoursStart,
  );
  const [quietHoursEnd, setQuietHoursEnd] = useState(
    preferences.quietHoursEnd ?? teamDefaults.quietHoursEnd,
  );
  const [useCustomOffsets, setUseCustomOffsets] = useState(
    preferences.reminderOffsetMinutes.length > 0,
  );
  const [reminderOffsets, setReminderOffsets] = useState<string[]>(
    preferences.reminderOffsetMinutes.length > 0
      ? preferences.reminderOffsetMinutes.map(String)
      : ['120'],
  );
  const [categoryEnabled, setCategoryEnabled] = useState<Record<NotificationCategory, boolean>>(
    Object.fromEntries(
      preferences.categoryPreferences.map((p) => [p.category, p.enabled]),
    ) as Record<NotificationCategory, boolean>,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateOffset(index: number, value: string) {
    setReminderOffsets((current) => current.map((v, i) => (i === index ? value : v)));
  }

  function addOffset() {
    setReminderOffsets((current) => [...current, '']);
  }

  function removeOffset(index: number) {
    setReminderOffsets((current) => current.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    let parsedOffsets: number[] = [];
    if (useCustomOffsets) {
      parsedOffsets = reminderOffsets.map((v) => Number(v));
      if (
        parsedOffsets.length === 0 ||
        parsedOffsets.some((v) => !Number.isFinite(v) || v <= 0 || !Number.isInteger(v))
      ) {
        setError(t('settingsNotifications.invalidReminderOffsets'));
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const saved = await api.updateMemberPreferences({
        teamId,
        quietHoursStart: useCustomQuietHours ? quietHoursStart : null,
        quietHoursEnd: useCustomQuietHours ? quietHoursEnd : null,
        reminderOffsetMinutes: parsedOffsets,
        categoryPreferences: notificationCategorySchema.options.map((category) => ({
          category,
          channel: 'push' as const,
          enabled: categoryEnabled[category] ?? true,
        })),
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold text-ink">
          {t('settingsNotifications.quietHoursSectionTitle')}
        </legend>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useCustomQuietHours}
            onChange={(e) => setUseCustomQuietHours(e.target.checked)}
            className={focusRingClassName}
          />
          {t('settingsNotifications.useCustomQuietHours')}
        </label>
        <p className="text-xs text-ink-muted">
          {t('settingsNotifications.teamDefaultQuietHours', {
            start: teamDefaults.quietHoursStart,
            end: teamDefaults.quietHoursEnd,
          })}
        </p>
        {useCustomQuietHours && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('settingsNotifications.quietHoursStartLabel')}>
              <input
                type="time"
                required
                value={quietHoursStart}
                onChange={(e) => setQuietHoursStart(e.target.value)}
                className={inputClassName}
              />
            </Field>
            <Field label={t('settingsNotifications.quietHoursEndLabel')}>
              <input
                type="time"
                required
                value={quietHoursEnd}
                onChange={(e) => setQuietHoursEnd(e.target.value)}
                className={inputClassName}
              />
            </Field>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold text-ink">
          {t('settingsNotifications.reminderOffsetsSectionTitle')}
        </legend>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useCustomOffsets}
            onChange={(e) => setUseCustomOffsets(e.target.checked)}
            className={focusRingClassName}
          />
          {t('settingsNotifications.useCustomReminderOffsets')}
        </label>
        {useCustomOffsets && (
          <div className="flex flex-col gap-2">
            {reminderOffsets.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="number"
                  required
                  min={1}
                  value={value}
                  onChange={(e) => updateOffset(index, e.target.value)}
                  className={inputClassName}
                  aria-label={t('settingsNotifications.reminderOffsetAriaLabel', {
                    index: index + 1,
                  })}
                />
                <IconButton
                  label={t('settingsNotifications.removeReminderOffsetAriaLabel', {
                    index: index + 1,
                  })}
                  icon={<Trash2 className="size-4" aria-hidden="true" />}
                  variant="danger"
                  onClick={() => removeOffset(index)}
                />
              </div>
            ))}
            {reminderOffsets.length < REMINDER_OFFSET_MINUTES_MAX_COUNT && (
              <button type="button" onClick={addOffset} className={`${buttonClassName} self-start`}>
                <Plus className="me-1.5 -ms-0.5 inline size-4" aria-hidden="true" />
                {t('settingsNotifications.addReminderOffset')}
              </button>
            )}
          </div>
        )}
      </fieldset>

      <FieldsetGroup legend={t('settingsNotifications.categoriesSectionTitle')}>
        <div className="flex flex-col gap-2">
          {notificationCategorySchema.options.map((category) => (
            <label key={category} className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={categoryEnabled[category] ?? true}
                onChange={(e) =>
                  setCategoryEnabled((current) => ({ ...current, [category]: e.target.checked }))
                }
                className={focusRingClassName}
              />
              {t(`settingsNotifications.category.${category}`)}
            </label>
          ))}
        </div>
      </FieldsetGroup>

      {error && <FormError>{error}</FormError>}
      <button type="submit" disabled={isSubmitting} className={`${buttonClassName} self-end`}>
        {isSubmitting ? t('settingsNotifications.saving') : t('settingsNotifications.save')}
      </button>

      <PushNotificationSection />
    </form>
  );
}

/**
 * Lets a password-only session self-service its first passkey — without
 * this, a parent promoted to team-admin has no way to satisfy
 * requirePrivilegedAssurance and is locked out of admin tools. Hidden once
 * the session already carries passkey assurance (nothing to add here; use
 * "Continue with passkey" at login to add another device instead).
 */
function PasskeySection({
  authMethod,
  onUpgraded,
}: {
  authMethod: 'bootstrap' | 'password' | 'passkey' | undefined;
  onUpgraded: () => void;
}) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authMethod !== 'password') return null;

  async function handleAddPasskey() {
    setError(null);
    if (!browserSupportsWebAuthn()) {
      setError(t('settingsSecurity.passkeyNotSupported'));
      return;
    }
    setIsSubmitting(true);
    try {
      const { challengeId, options } = await api.getPasskeyRegisterOptions();
      const response = await startRegistration({
        optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
      });
      await api.verifyPasskeyRegister({ challengeId, response });
      showToast(t('settingsSecurity.passkeyAdded'), 'success');
      onUpgraded();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof WebAuthnError) {
        setError(t('settingsSecurity.passkeyCancelled'));
      } else {
        setError(t('common.somethingWentWrong'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 border-b border-surface-border pb-6">
      <legend className="text-sm font-semibold text-ink">
        {t('settingsSecurity.sectionTitle')}
      </legend>
      <p className="text-sm text-ink-muted">{t('settingsSecurity.passkeyDescription')}</p>
      <button
        type="button"
        disabled={isSubmitting}
        onClick={handleAddPasskey}
        className={`${buttonClassName} self-start`}
      >
        {isSubmitting
          ? t('settingsSecurity.addingPasskey')
          : t('settingsSecurity.addPasskeyButton')}
      </button>
      {error && <FormError>{error}</FormError>}
    </fieldset>
  );
}

/**
 * A separate, immediate-action section, not part of the form's own Save
 * flow — enabling/disabling push happens on click (each requiring its own
 * browser permission prompt / service-worker round trip), not batched with
 * the category/quiet-hours preferences above. `type="button"` throughout so
 * neither action submits the surrounding form.
 */
function PushNotificationSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState<PushStatus | 'loading'>('loading');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPushStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) setStatus('unsupported');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setError(null);
    setIsPending(true);
    try {
      await enablePush();
      setStatus('subscribed');
    } catch {
      setError(t('settingsNotifications.pushError'));
      setStatus(await getPushStatus());
    } finally {
      setIsPending(false);
    }
  }

  async function handleDisable() {
    setError(null);
    setIsPending(true);
    try {
      await disablePush();
      setStatus('granted-not-subscribed');
    } catch {
      setError(t('settingsNotifications.pushError'));
    } finally {
      setIsPending(false);
    }
  }

  if (status === 'loading') return null;

  return (
    <fieldset className="flex flex-col gap-3 border-t border-surface-border pt-6">
      <legend className="text-sm font-semibold text-ink">
        {t('settingsNotifications.pushSectionTitle')}
      </legend>

      {status === 'unsupported' && (
        <p className="text-sm text-ink-muted">{t('settingsNotifications.pushNotSupported')}</p>
      )}
      {status === 'denied' && (
        <p className="text-sm text-ink-muted">{t('settingsNotifications.pushBlocked')}</p>
      )}
      {status === 'subscribed' && (
        <>
          <p className="text-sm text-ink-muted">{t('settingsNotifications.pushEnabledOnDevice')}</p>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDisable}
            className={`${secondaryButtonClassName} self-start`}
          >
            {isPending
              ? t('settingsNotifications.pushDisabling')
              : t('settingsNotifications.disablePushButton')}
          </button>
        </>
      )}
      {(status === 'default' || status === 'granted-not-subscribed') && (
        <>
          <p className="text-sm text-ink-muted">
            {t('settingsNotifications.pushNotEnabledOnDevice')}
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={handleEnable}
            className={`${buttonClassName} self-start`}
          >
            {isPending
              ? t('settingsNotifications.pushEnabling')
              : t('settingsNotifications.enablePushButton')}
          </button>
        </>
      )}
      {error && <FormError>{error}</FormError>}
    </fieldset>
  );
}
