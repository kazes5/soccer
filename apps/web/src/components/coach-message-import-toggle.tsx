'use client';

import { focusRingClassName } from '@soccer/ui-tokens';
import { useEffect, useState } from 'react';
import { useLocale } from '@/components/locale-provider';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';

/**
 * The team-wide on/off switch for pasting coach messages into the schedule —
 * shared by a team admin's /admin/team-settings and a system admin's
 * /system/teams/[teamId], which hit the same endpoint (team-admin or
 * system-admin only, see apps/api/src/routes/schedule-import.ts).
 */
export function CoachMessageImportToggle({ teamId }: { teamId: string }) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getCoachMessageImport(teamId)
      .then((settings) => {
        if (!cancelled) setEnabled(settings.enabled);
      })
      .catch(() => {
        // Stays hidden; nothing to toggle without the current value.
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  if (enabled === null) return null;

  async function handleChange(next: boolean) {
    setIsSaving(true);
    try {
      const settings = await api.updateCoachMessageImport(teamId, { enabled: next });
      setEnabled(settings.enabled);
      showToast(t('adminTeamSettings.coachImportSaved'), 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section aria-labelledby={`coach-import-${teamId}`} className="flex flex-col gap-2">
      <h2 id={`coach-import-${teamId}`} className="text-sm font-medium text-ink">
        {t('adminTeamSettings.coachImportTitle')}
      </h2>
      <p className="text-sm text-ink-muted">{t('adminTeamSettings.coachImportDescription')}</p>
      <label className="inline-flex min-h-11 items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={isSaving}
          onChange={(e) => handleChange(e.target.checked)}
          className={`size-5 ${focusRingClassName}`}
        />
        {t('adminTeamSettings.coachImportToggle')}
      </label>
    </section>
  );
}
