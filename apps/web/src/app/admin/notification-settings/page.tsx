'use client';

import {
  ADMIN_ALERT_LEAD_MINUTES,
  ESCALATION_LEAD_MINUTES_MAX,
  REMINDER_OFFSET_MINUTES_MAX_COUNT,
  SWAP_EXPIRY_HOURS_MAX,
  SWAP_EXPIRY_HOURS_MIN,
  type CoordinationSettings,
  type CurrentUserResponse,
  type TeamMembership,
  type TeamNotificationSettings,
} from '@soccer/contracts';
import { Calendar, Home, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
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
import { buildLoginRedirect } from '@/lib/safe-redirect';

/** Only `admin` memberships apply to this page — kept as one helper so the
 * initial-team-pick effect and the render-time filter can never disagree. */
function adminMembershipsOf(memberships: TeamMembership[]): TeamMembership[] {
  return memberships.filter((m) => m.role === 'admin');
}

export default function AdminNotificationSettingsPage() {
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
    ...adminNavItems(navTeamId, t, 'notification-settings'),
  ];

  return (
    <AppShell
      brand={t('common.appName')}
      navItems={navItems}
      accentColor={activeAdminMembership.primaryColor}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {t('adminNotificationSettings.title')}
        </h1>

        {adminMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={adminMemberships.map((m) => ({ id: m.teamId, label: m.teamName }))}
            activeId={activeTeamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}

        {activeTeamId && <SettingsWorkspace key={activeTeamId} teamId={activeTeamId} />}
      </div>
    </AppShell>
  );
}

function SettingsWorkspace({ teamId }: { teamId: string }) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [coordination, setCoordination] = useState<CoordinationSettings | null>(null);
  const [notification, setNotification] = useState<TeamNotificationSettings | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(
    () => Promise.all([api.getCoordinationSettings(teamId), api.getNotificationSettings(teamId)]),
    [teamId],
  );

  useEffect(() => {
    let cancelled = false;
    load()
      .then(([coordinationData, notificationData]) => {
        if (cancelled) return;
        setCoordination(coordinationData);
        setNotification(notificationData);
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
      .then(([coordinationData, notificationData]) => {
        setCoordination(coordinationData);
        setNotification(notificationData);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }

  if (loadState === 'loading') {
    return <LoadingState label={t('adminNotificationSettings.loading')} />;
  }

  if (loadState === 'error' || !coordination || !notification) {
    return (
      <ErrorState
        title={t('adminNotificationSettings.loadError')}
        action={
          <button type="button" className={buttonClassName} onClick={reload}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  return (
    <SettingsForm
      teamId={teamId}
      coordination={coordination}
      notification={notification}
      onSaved={(c, n) => {
        setCoordination(c);
        setNotification(n);
        showToast(t('adminNotificationSettings.saved'), 'success');
      }}
    />
  );
}

function SettingsForm({
  teamId,
  coordination,
  notification,
  onSaved,
}: {
  teamId: string;
  coordination: CoordinationSettings;
  notification: TeamNotificationSettings;
  onSaved: (c: CoordinationSettings, n: TeamNotificationSettings) => void;
}) {
  const { t } = useLocale();
  const [swapExpiryHours, setSwapExpiryHours] = useState(String(coordination.swapExpiryHours));
  const [reminderOffsets, setReminderOffsets] = useState<string[]>(
    coordination.reminderOffsetMinutes.map(String),
  );
  const [escalationLeadMinutes, setEscalationLeadMinutes] = useState(
    String(coordination.escalationLeadMinutes),
  );
  const [quietHoursStart, setQuietHoursStart] = useState(notification.quietHoursStart);
  const [quietHoursEnd, setQuietHoursEnd] = useState(notification.quietHoursEnd);
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

    const parsedOffsets = reminderOffsets.map((v) => Number(v));
    if (
      parsedOffsets.length === 0 ||
      parsedOffsets.some((v) => !Number.isFinite(v) || v <= 0 || !Number.isInteger(v))
    ) {
      setError(t('adminNotificationSettings.invalidReminderOffsets'));
      return;
    }

    setIsSubmitting(true);
    try {
      const [savedCoordination, savedNotification] = await Promise.all([
        api.updateCoordinationSettings(teamId, {
          swapExpiryHours: Number(swapExpiryHours),
          reminderOffsetMinutes: parsedOffsets,
          escalationLeadMinutes: Number(escalationLeadMinutes),
        }),
        api.updateNotificationSettings(teamId, { quietHoursStart, quietHoursEnd }),
      ]);
      onSaved(savedCoordination, savedNotification);
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
          {t('adminNotificationSettings.coordinationSectionTitle')}
        </legend>

        <Field
          label={t('adminNotificationSettings.swapExpiryLabel')}
          hint={t('adminNotificationSettings.swapExpiryHint')}
        >
          <input
            type="number"
            required
            min={SWAP_EXPIRY_HOURS_MIN}
            max={SWAP_EXPIRY_HOURS_MAX}
            value={swapExpiryHours}
            onChange={(e) => setSwapExpiryHours(e.target.value)}
            className={inputClassName}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">
            {t('adminNotificationSettings.reminderOffsetsLabel')}
          </p>
          <p className="text-xs text-ink-muted">
            {t('adminNotificationSettings.reminderOffsetsHint')}
          </p>
          {reminderOffsets.map((value, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="number"
                required
                min={1}
                value={value}
                onChange={(e) => updateOffset(index, e.target.value)}
                className={inputClassName}
                aria-label={t('adminNotificationSettings.reminderOffsetAriaLabel', {
                  index: index + 1,
                })}
              />
              <IconButton
                label={t('adminNotificationSettings.removeReminderOffsetAriaLabel', {
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
              {t('adminNotificationSettings.addReminderOffset')}
            </button>
          )}
        </div>

        <Field
          label={t('adminNotificationSettings.escalationLeadLabel')}
          hint={t('adminNotificationSettings.escalationLeadHint', {
            minutes: ADMIN_ALERT_LEAD_MINUTES,
          })}
        >
          <input
            type="number"
            required
            min={ADMIN_ALERT_LEAD_MINUTES + 1}
            max={ESCALATION_LEAD_MINUTES_MAX}
            value={escalationLeadMinutes}
            onChange={(e) => setEscalationLeadMinutes(e.target.value)}
            className={inputClassName}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold text-ink">
          {t('adminNotificationSettings.quietHoursSectionTitle')}
        </legend>
        <p className="text-xs text-ink-muted">{t('adminNotificationSettings.quietHoursHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('adminNotificationSettings.quietHoursStartLabel')}>
            <input
              type="time"
              required
              value={quietHoursStart}
              onChange={(e) => setQuietHoursStart(e.target.value)}
              className={inputClassName}
            />
          </Field>
          <Field label={t('adminNotificationSettings.quietHoursEndLabel')}>
            <input
              type="time"
              required
              value={quietHoursEnd}
              onChange={(e) => setQuietHoursEnd(e.target.value)}
              className={inputClassName}
            />
          </Field>
        </div>
      </fieldset>

      {error && <FormError>{error}</FormError>}
      <button type="submit" disabled={isSubmitting} className={`${buttonClassName} self-end`}>
        {isSubmitting ? t('adminNotificationSettings.saving') : t('adminNotificationSettings.save')}
      </button>
    </form>
  );
}
