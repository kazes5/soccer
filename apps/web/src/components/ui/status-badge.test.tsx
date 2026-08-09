import type { StatusTone } from '@soccer/ui-tokens';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/render';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('renders the label as visible text, not just a color', () => {
    render(<StatusBadge tone="mine" label="Mine" />);
    expect(screen.getByText('Mine')).toBeInTheDocument();
  });

  it('renders an icon for every semantic tone (color is never the only signal)', () => {
    const tones: StatusTone[] = ['mine', 'covered', 'open', 'urgent', 'attention', 'pending'];
    for (const tone of tones) {
      const { container, unmount } = render(<StatusBadge tone={tone} label={tone} />);
      expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
      unmount();
    }
  });
});
