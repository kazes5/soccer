import { describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithProviders, screen } from '@/test/render';
import { TeamSwitcher } from './team-switcher';

describe('TeamSwitcher', () => {
  it('renders nothing for a single-team account — there is nothing to switch between', () => {
    renderWithProviders(
      <TeamSwitcher
        ariaLabel="Switch team"
        options={[{ id: 'team-1', label: 'Wildcats' }]}
        activeId="team-1"
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('lists every team as a tab and marks the active one selected', () => {
    renderWithProviders(
      <TeamSwitcher
        ariaLabel="Switch team"
        options={[
          { id: 'team-1', label: 'Wildcats' },
          { id: 'team-2', label: 'Strikers' },
        ]}
        activeId="team-2"
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Wildcats' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Strikers' })).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onChange with the selected team id', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TeamSwitcher
        ariaLabel="Switch team"
        options={[
          { id: 'team-1', label: 'Wildcats' },
          { id: 'team-2', label: 'Strikers' },
        ]}
        activeId="team-1"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Strikers' }));

    expect(onChange).toHaveBeenCalledWith('team-2');
  });

  it('only tabs the active option into the tab order (roving tabindex)', () => {
    renderWithProviders(
      <TeamSwitcher
        ariaLabel="Switch team"
        options={[
          { id: 'team-1', label: 'Wildcats' },
          { id: 'team-2', label: 'Strikers' },
        ]}
        activeId="team-1"
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Wildcats' })).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('tab', { name: 'Strikers' })).toHaveAttribute('tabIndex', '-1');
  });

  it('moves selection and focus with ArrowRight/ArrowLeft in LTR', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TeamSwitcher
        ariaLabel="Switch team"
        options={[
          { id: 'team-1', label: 'Wildcats' },
          { id: 'team-2', label: 'Strikers' },
        ]}
        activeId="team-1"
        onChange={onChange}
      />,
      { locale: 'en' },
    );

    const first = screen.getByRole('tab', { name: 'Wildcats' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('team-2');
    expect(screen.getByRole('tab', { name: 'Strikers' })).toHaveFocus();
  });

  it('reverses ArrowRight/ArrowLeft in RTL (Hebrew)', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TeamSwitcher
        ariaLabel="Switch team"
        options={[
          { id: 'team-1', label: 'Wildcats' },
          { id: 'team-2', label: 'Strikers' },
        ]}
        activeId="team-1"
        onChange={onChange}
      />,
      { locale: 'he' },
    );

    const first = screen.getByRole('tab', { name: 'Wildcats' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('team-2');
  });
});
