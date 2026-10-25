'use client';

import type {
  ScheduleImportApplyResponse,
  ScheduleImportOperation,
  ScheduleImportPreviewResponse,
  ScheduleImportSessionFields,
} from '@soccer/contracts';
import { formatDate, type Locale } from '@soccer/i18n';
import { focusRingClassName } from '@soccer/ui-tokens';
import { useState, type FormEvent } from 'react';
import {
  Field,
  FieldsetGroup,
  FormError,
  buttonClassName,
  inputClassName,
  secondaryButtonClassName,
} from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { Dialog } from '@/components/ui/dialog';
import { ApiError, api } from '@/lib/api';
import { instantToWallClock } from '@/lib/timezone';

/** The operation's fields are already team-local wall-clock values, so they're
 *  formatted as-is (pinned to UTC) rather than converted through a zone. */
function formatLocalFields(locale: Locale, fields: ScheduleImportSessionFields): string {
  return formatDate(locale, new Date(`${fields.date}T${fields.time}:00Z`), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

function formatLocalDate(locale: Locale, date: string): string {
  return formatDate(locale, new Date(`${date}T00:00:00Z`), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
}

/**
 * Paste → review → apply. The first step sends the message to the assistant
 * and gets back a proposal; nothing is saved until the member applies the
 * changes they kept checked (see apps/api/src/routes/schedule-import.ts).
 */
export function ScheduleImportDialog({
  teamId,
  timeZone,
  initialMessage = '',
  onClose,
  onApplied,
}: {
  teamId: string;
  timeZone: string;
  /** Pre-filled from the chat hand-off (coach-import-handoff.ts). */
  initialMessage?: string;
  onClose: () => void;
  onApplied: (result: ScheduleImportApplyResponse) => void;
}) {
  const { t, locale } = useLocale();
  const [message, setMessage] = useState(initialMessage);
  const [replaceWeek, setReplaceWeek] = useState(false);
  const [referenceDate, setReferenceDate] = useState(
    () => instantToWallClock(new Date(), timeZone).date,
  );
  const [proposal, setProposal] = useState<ScheduleImportPreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handlePreview(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      const result = await api.previewScheduleImport(teamId, {
        message,
        referenceDate,
        locale,
        replaceWeek,
      });
      setProposal(result);
      setSelected(new Set(result.operations.map((_, index) => index)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleApply() {
    if (!proposal) return;
    setError(null);
    setIsBusy(true);
    try {
      const result = await api.applyScheduleImport(teamId, {
        message: message.trim(),
        operations: proposal.operations,
        proposalToken: proposal.proposalToken,
        selected: [...selected],
      });
      onApplied(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsBusy(false);
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeDisabled={isBusy}
      title={t('scheduleImport.dialogTitle')}
      description={proposal ? undefined : t('scheduleImport.dialogDescription')}
      closeLabel={t('common.close')}
    >
      {!proposal ? (
        <form onSubmit={handlePreview} className="flex flex-col gap-4">
          <Field label={t('scheduleImport.messageLabel')}>
            <textarea
              required
              dir="auto"
              rows={8}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={`${inputClassName} resize-y`}
            />
          </Field>
          <Field
            label={t('scheduleImport.referenceDateLabel')}
            hint={t('scheduleImport.referenceDateHint')}
          >
            <input
              required
              type="date"
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
              className={inputClassName}
            />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={replaceWeek}
              onChange={(e) => setReplaceWeek(e.target.checked)}
              className={`mt-1 ${focusRingClassName}`}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('scheduleImport.replaceWeekLabel')}</span>
              <span className="text-ink-muted">{t('scheduleImport.replaceWeekHint')}</span>
            </span>
          </label>
          {error && <FormError>{error}</FormError>}
          <button
            type="submit"
            disabled={isBusy || message.trim().length === 0}
            className={`${buttonClassName} self-end`}
          >
            {isBusy ? t('scheduleImport.analyzing') : t('scheduleImport.analyze')}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          {proposal.replacedWeek && (
            <p className="rounded-lg bg-status-attention-subtle p-3 text-sm text-status-attention-on">
              {t('scheduleImport.replacingWeek', {
                start: formatLocalDate(locale, proposal.replacedWeek.start),
                end: formatLocalDate(locale, proposal.replacedWeek.end),
              })}
            </p>
          )}
          {proposal.operations.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('scheduleImport.noChanges')}</p>
          ) : (
            <FieldsetGroup legend={t('scheduleImport.changesLegend')}>
              <ul className="flex flex-col gap-2">
                {proposal.operations.map((operation, index) => (
                  <li key={index}>
                    <OperationRow
                      operation={operation}
                      locale={locale}
                      checked={selected.has(index)}
                      onToggle={() => toggle(index)}
                    />
                  </li>
                ))}
              </ul>
            </FieldsetGroup>
          )}

          {proposal.unresolved.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium text-ink">
                {t('scheduleImport.unresolvedTitle')}
              </h3>
              <ul className="list-disc ps-5 text-sm text-ink-muted">
                {proposal.unresolved.map((line, index) => (
                  <li key={index} dir="auto">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {error && <FormError>{error}</FormError>}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={isBusy}
              className={secondaryButtonClassName}
              onClick={() => {
                setProposal(null);
                setError(null);
              }}
            >
              {t('scheduleImport.back')}
            </button>
            {proposal.operations.length > 0 && (
              <button
                type="button"
                disabled={isBusy || selected.size === 0}
                className={buttonClassName}
                onClick={handleApply}
              >
                {isBusy
                  ? t('scheduleImport.applying')
                  : t('scheduleImport.apply', { count: selected.size })}
              </button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function OperationRow({
  operation,
  locale,
  checked,
  onToggle,
}: {
  operation: ScheduleImportOperation;
  locale: Locale;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const fields = operation.type === 'cancel' ? operation.before : operation.after;
  const typeLabel =
    operation.type === 'create'
      ? t('scheduleImport.opCreate')
      : operation.type === 'update'
        ? t('scheduleImport.opUpdate')
        : t('scheduleImport.opCancel');
  const kindLabel = fields.kind === 'game' ? t('schedule.kindGame') : t('schedule.kindPractice');

  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-surface-border bg-surface-soft p-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className={`mt-1 ${focusRingClassName}`}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">
          {typeLabel} · {kindLabel} · {formatLocalFields(locale, fields)}
        </span>
        {fields.title && <span dir="auto">{fields.title}</span>}
        <span className={operation.type === 'cancel' ? 'line-through' : ''} dir="auto">
          {fields.fieldLocation}
        </span>
        {operation.type !== 'cancel' && fields.notes && (
          <span className="text-ink-muted" dir="auto">
            {fields.notes}
          </span>
        )}
        {operation.type === 'update' && (
          <span className="text-xs text-ink-muted" dir="auto">
            {t('scheduleImport.was', {
              value: `${formatLocalFields(locale, operation.before)} · ${operation.before.fieldLocation}`,
            })}
          </span>
        )}
        {operation.type === 'cancel' && (
          <span className="text-xs text-ink-muted">
            {operation.reason === 'explicit'
              ? t('scheduleImport.cancelReasonExplicit')
              : operation.reason === 'replaced'
                ? t('scheduleImport.cancelReasonReplaced')
                : t('scheduleImport.cancelReasonNotInMessage')}
          </span>
        )}
      </span>
    </label>
  );
}
