import { describe, expect, it } from 'vitest';
import { render } from '@/test/render';
import { TeamBrandStyle } from './team-brand-style';

describe('TeamBrandStyle', () => {
  it('renders nothing for a null/undefined/green color — globals.css already defaults to green', () => {
    const { container: nullContainer } = render(<TeamBrandStyle color={null} />);
    expect(nullContainer.querySelector('style')).toBeNull();

    const { container: undefinedContainer } = render(<TeamBrandStyle color={undefined} />);
    expect(undefinedContainer.querySelector('style')).toBeNull();

    const { container: greenContainer } = render(<TeamBrandStyle color="green" />);
    expect(greenContainer.querySelector('style')).toBeNull();
  });

  it('renders a style tag overriding --color-brand for both light and dark mode', () => {
    const { container } = render(<TeamBrandStyle color="blue" />);

    const style = container.querySelector('style');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain(':root{--color-brand:#1d4ed8;');
    expect(style?.textContent).toContain(
      '@media (prefers-color-scheme: dark){:root{--color-brand:#60a5fa;',
    );
  });
});
