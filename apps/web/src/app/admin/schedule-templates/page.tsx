'use client';

import type {
  CollectionPoint,
  CreateScheduleTemplateRequest,
  CurrentUserResponse,
  ScheduleTemplate,
  TeamMembership,
  UpdateScheduleTemplateRequest,
} from '@soccer/contracts';
import { formatDate, type Locale, type MessageKey } from '@soccer/i18n';
import { focusRingClassName } from '@soccer/ui-tokens';
import { Calendar, Home, Pencil, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { Dialog } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TeamSwitcher } from '@/components/ui/team-switcher';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import {
  WEEKDAY_CODES,
  buildRecurrenceRule,
  parseRecurrenceRule,
  type WeekdayCode,
} from './recurrence';

/** Only `admin` memberships apply to this page — kept as one helper so the
 * initial-team-pick effect and the render-time filter can never disagree. */
function adminMembershipsOf(memberships: TeamMembership[]): TeamMembership[] {
  return memberships.filter((m) => m.role === 'admin');
}

/** `null` for blank, non-integer, or out of the server's accepted 1-52 range. */
function parseHorizonWeeks(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 52 ? parsed : null;
}

export default function AdminScheduleTemplatesPage() {
  const router = useRouter();
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
      router.replace('/login');
    }
  }, [authStatus, router]);

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
  if (adminMemberships.length === 0) {
    return null;
  }

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
  ];

  return (
    <AppShell brand={t('common.appName')} navItems={navItems}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {t('adminScheduleTemplates.title')}
        </h1>

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
        {activeTeamId && <ScheduleTemplatesWorkspace key={activeTeamId} teamId={activeTeamId} />}
      </div>
    </AppShell>
  );
}

function summarizeRecurrence(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  rule: string,
): string {
  const parsed = parseRecurrenceRule(rule);
  if (!parsed) return rule;
  const orderedDays = WEEKDAY_CODES.filter((code) => parsed.days.includes(code));
  const days = orderedDays.map((code) => t(`adminScheduleTemplates.day.${code}`)).join(', ');
  const key =
    parsed.frequency === 'biweekly'
      ? 'adminScheduleTemplates.summaryEveryTwoWeeks'
      : 'adminScheduleTemplates.summaryEveryWeek';
  return t(key, { days });
}

function ScheduleTemplatesWorkspace({ teamId }: { teamId: string }) {
  const { t, locale } = useLocale();
  const { showToast } = useToast();
  const [templates, setTemplates] = useState<ScheduleTemplate[] | null>(null);
  const [points, setPoints] = useState<CollectionPoint[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | 'new' | null>(null);

  const fetchAll = useCallback(
    () => Promise.all([api.listScheduleTemplates(teamId), api.listCollectionPoints(teamId)]),
    [teamId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then(([templatesRes, pointsRes]) => {
        if (cancelled) return;
        setTemplates(templatesRes.templates);
        setPoints(pointsRes.points);
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
      .then(([templatesRes, pointsRes]) => {
        setTemplates(templatesRes.templates);
        setPoints(pointsRes.points);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }, [fetchAll]);

  function handleSaved(saved: ScheduleTemplate, sessionsCreated: number) {
    setTemplates((prev) => {
      if (!prev) return prev;
      return prev.some((template) => template.id === saved.id)
        ? prev.map((template) => (template.id === saved.id ? saved : template))
        : [saved, ...prev];
    });
    setEditingTemplate(null);
    showToast(
      t('adminScheduleTemplates.sessionsCreatedToast', { count: sessionsCreated }),
      'success',
    );
  }

  if (loadState === 'loading') {
    return <LoadingState label={t('adminScheduleTemplates.loading')} />;
  }

  if (loadState === 'error' || !templates || !points) {
    return (
      <ErrorState
        title={t('adminScheduleTemplates.loadError')}
        action={
          <button type="button" className={buttonClassName} onClick={reload}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  const pointsById = new Map(points.map((point) => [point.id, point]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={points.length === 0}
          className={`${buttonClassName} self-start`}
          onClick={() => setEditingTemplate('new')}
        >
          <Plus className="me-1.5 -ms-0.5 inline size-4" aria-hidden="true" />
          {t('adminScheduleTemplates.addButton')}
        </button>
        {points.length === 0 && (
          <p className="text-sm text-ink-muted">{t('adminScheduleTemplates.noCollectionPoints')}</p>
        )}
      </div>

      {templates.length === 0 ? (
        <EmptyState title={t('adminScheduleTemplates.empty')} />
      ) : (
        <DataList ariaLabel={t('adminScheduleTemplates.title')}>
          {templates.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              pointsById={pointsById}
              locale={locale}
              onEdit={() => setEditingTemplate(template)}
            />
          ))}
        </DataList>
      )}

      {editingTemplate && (
        <TemplateFormDialog
          teamId={teamId}
          template={editingTemplate === 'new' ? null : editingTemplate}
          points={points}
          onClose={() => setEditingTemplate(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function TemplateRow({
  template,
  pointsById,
  locale,
  onEdit,
}: {
  template: ScheduleTemplate;
  pointsById: Map<string, CollectionPoint>;
  locale: Locale;
  onEdit: () => void;
}) {
  const { t } = useLocale();
  const summary = summarizeRecurrence(t, template.recurrenceRule);
  const startDate = formatDate(locale, new Date(`${template.startDate}T00:00:00.000Z`), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const pointNames = template.collectionPointIds
    .map((id) => pointsById.get(id)?.name)
    .filter((name): name is string => Boolean(name))
    .join(', ');

  return (
    <DataListItem className="flex items-start justify-between gap-3">
      <div>
        <p className="font-medium">{summary}</p>
        <p className="text-sm text-ink-muted">
          {startDate} · {template.defaultTime} · {template.defaultFieldLocation}
        </p>
        <p className="text-sm text-ink-muted">
          {t('adminScheduleTemplates.horizonWeeksSummary', { count: template.horizonWeeks })}
          {pointNames && ` · ${pointNames}`}
        </p>
      </div>
      <IconButton
        label={t('adminScheduleTemplates.editAriaLabel', { summary })}
        icon={<Pencil className="size-4" aria-hidden="true" />}
        onClick={onEdit}
      />
    </DataListItem>
  );
}

interface TemplateFormState {
  frequency: 'weekly' | 'biweekly';
  days: WeekdayCode[];
  startDate: string;
  defaultTime: string;
  defaultFieldLocation: string;
  horizonWeeks: string;
  collectionPointIds: string[];
}

function TemplateFormDialog({
  teamId,
  template,
  points,
  onClose,
  onSaved,
}: {
  teamId: string;
  template: ScheduleTemplate | null;
  points: CollectionPoint[];
  onClose: () => void;
  onSaved: (saved: ScheduleTemplate, sessionsCreated: number) => void;
}) {
  const { t } = useLocale();
  const initialRecurrence = template ? parseRecurrenceRule(template.recurrenceRule) : null;
  // Create always uses the picker; editing only offers it when the existing rule
  // is one this picker actually built (see recurrence.ts's parseRecurrenceRule).
  const isRecurrenceEditable = !template || initialRecurrence !== null;

  const [form, setForm] = useState<TemplateFormState>({
    frequency: initialRecurrence?.frequency ?? 'weekly',
    days: initialRecurrence?.days ?? [],
    startDate: template?.startDate ?? '',
    defaultTime: template?.defaultTime ?? '18:00',
    defaultFieldLocation: template?.defaultFieldLocation ?? '',
    horizonWeeks: String(template?.horizonWeeks ?? 8),
    collectionPointIds: template?.collectionPointIds ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleDay(code: WeekdayCode) {
    setForm((f) => ({
      ...f,
      days: f.days.includes(code) ? f.days.filter((d) => d !== code) : [...f.days, code],
    }));
  }

  function togglePoint(id: string) {
    setForm((f) => ({
      ...f,
      collectionPointIds: f.collectionPointIds.includes(id)
        ? f.collectionPointIds.filter((p) => p !== id)
        : [...f.collectionPointIds, id],
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (isRecurrenceEditable && form.days.length === 0) {
      setError(t('adminScheduleTemplates.selectAtLeastOneDay'));
      return;
    }
    if (form.collectionPointIds.length === 0) {
      setError(t('adminScheduleTemplates.selectAtLeastOnePoint'));
      return;
    }
    const horizonWeeks = parseHorizonWeeks(form.horizonWeeks);
    if (horizonWeeks === null) {
      setError(t('adminScheduleTemplates.invalidHorizonWeeks'));
      return;
    }

    setIsSubmitting(true);
    try {
      const recurrenceRule = isRecurrenceEditable
        ? buildRecurrenceRule({ frequency: form.frequency, days: form.days })
        : undefined;

      const result = template
        ? await api.updateScheduleTemplate(teamId, template.id, {
            ...(recurrenceRule ? { recurrenceRule } : {}),
            defaultTime: form.defaultTime,
            defaultFieldLocation: form.defaultFieldLocation,
            horizonWeeks,
            collectionPointIds: form.collectionPointIds,
          } satisfies UpdateScheduleTemplateRequest)
        : await api.createScheduleTemplate(teamId, {
            recurrenceRule: recurrenceRule!,
            startDate: form.startDate,
            defaultTime: form.defaultTime,
            defaultFieldLocation: form.defaultFieldLocation,
            horizonWeeks,
            collectionPointIds: form.collectionPointIds,
          } satisfies CreateScheduleTemplateRequest);
      onSaved(result.template, result.sessionsCreated);
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
        template
          ? t('adminScheduleTemplates.formTitleEdit')
          : t('adminScheduleTemplates.formTitleCreate')
      }
      closeLabel={t('common.close')}
    >
      <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
        {isRecurrenceEditable ? (
          <>
            <Field label={t('adminScheduleTemplates.frequencyLabel')}>
              <div className="flex gap-4">
                <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="frequency"
                    checked={form.frequency === 'weekly'}
                    onChange={() => setForm((f) => ({ ...f, frequency: 'weekly' }))}
                    className={focusRingClassName}
                  />
                  {t('adminScheduleTemplates.frequencyWeekly')}
                </label>
                <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="frequency"
                    checked={form.frequency === 'biweekly'}
                    onChange={() => setForm((f) => ({ ...f, frequency: 'biweekly' }))}
                    className={focusRingClassName}
                  />
                  {t('adminScheduleTemplates.frequencyBiweekly')}
                </label>
              </div>
            </Field>
            <Field label={t('adminScheduleTemplates.daysLabel')}>
              <div className="flex flex-wrap gap-3">
                {WEEKDAY_CODES.map((code) => (
                  <label key={code} className="inline-flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.days.includes(code)}
                      onChange={() => toggleDay(code)}
                      className={focusRingClassName}
                    />
                    {t(`adminScheduleTemplates.day.${code}`)}
                  </label>
                ))}
              </div>
            </Field>
          </>
        ) : (
          <p className="text-sm text-ink-muted">{t('adminScheduleTemplates.customRuleNotice')}</p>
        )}

        {template ? (
          <Field
            label={t('adminScheduleTemplates.startDateLabel')}
            hint={t('adminScheduleTemplates.startDateNotEditable')}
          >
            <p className="text-sm">{template.startDate}</p>
          </Field>
        ) : (
          <Field label={t('adminScheduleTemplates.startDateLabel')}>
            <input
              required
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              className={inputClassName}
            />
          </Field>
        )}

        <Field label={t('adminScheduleTemplates.defaultTimeLabel')}>
          <input
            required
            type="time"
            value={form.defaultTime}
            onChange={(e) => setForm((f) => ({ ...f, defaultTime: e.target.value }))}
            className={inputClassName}
          />
        </Field>

        <Field label={t('adminScheduleTemplates.defaultFieldLocationLabel')}>
          <input
            required
            value={form.defaultFieldLocation}
            onChange={(e) => setForm((f) => ({ ...f, defaultFieldLocation: e.target.value }))}
            className={inputClassName}
          />
        </Field>

        <Field label={t('adminScheduleTemplates.horizonWeeksLabel')}>
          <input
            required
            type="number"
            min={1}
            max={52}
            value={form.horizonWeeks}
            onChange={(e) => setForm((f) => ({ ...f, horizonWeeks: e.target.value }))}
            className={inputClassName}
          />
        </Field>

        <Field label={t('adminScheduleTemplates.collectionPointsLabel')}>
          <div className="flex flex-col gap-2">
            {points.map((point) => (
              <label key={point.id} className="inline-flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.collectionPointIds.includes(point.id)}
                  onChange={() => togglePoint(point.id)}
                  className={focusRingClassName}
                />
                {point.name}
              </label>
            ))}
          </div>
        </Field>

        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={isSubmitting} className={`${buttonClassName} self-end`}>
          {isSubmitting ? t('adminScheduleTemplates.saving') : t('adminScheduleTemplates.save')}
        </button>
      </form>
    </Dialog>
  );
}
