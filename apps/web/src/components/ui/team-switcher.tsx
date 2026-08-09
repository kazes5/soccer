'use client';

import { focusRingClassName } from '@soccer/ui-tokens';
import { isRtl } from '@soccer/i18n';
import { useRef, type KeyboardEvent } from 'react';
import { useLocale } from '@/components/locale-provider';

export interface TeamSwitcherOption {
  id: string;
  label: string;
}

/**
 * Scopes the visible schedule/shifts to one team at a time for multi-team
 * households (CLAUDE.md §3.15). Renders nothing for single-team accounts,
 * since there's nothing to switch between.
 */
export function TeamSwitcher({
  options,
  activeId,
  onChange,
  ariaLabel,
}: {
  options: TeamSwitcherOption[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  const { locale } = useLocale();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (options.length <= 1) {
    return null;
  }

  function focusAndSelect(index: number) {
    const wrapped = (index + options.length) % options.length;
    const option = options[wrapped];
    if (!option) return;
    onChange(option.id);
    tabRefs.current[wrapped]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const [nextKey, prevKey] = isRtl(locale)
      ? ['ArrowLeft', 'ArrowRight']
      : ['ArrowRight', 'ArrowLeft'];
    if (event.key === nextKey) {
      event.preventDefault();
      focusAndSelect(index + 1);
    } else if (event.key === prevKey) {
      event.preventDefault();
      focusAndSelect(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAndSelect(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAndSelect(options.length - 1);
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1 rounded-full bg-surface-soft p-1"
    >
      {options.map((option, index) => {
        const active = option.id === activeId;
        return (
          <button
            key={option.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`min-h-11 rounded-full px-4 text-sm font-medium transition-colors ${
              active ? 'bg-surface text-ink shadow-raised' : 'text-ink-muted hover:text-ink'
            } ${focusRingClassName}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
