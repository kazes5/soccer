import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@soccer/contracts', '@soccer/i18n', '@soccer/ui-tokens'],
  // The dev-mode indicator overlay has no production equivalent and, at
  // small viewports, its fixed-position badge sits on top of the bottom
  // navigation and intercepts real clicks — breaks Playwright's mobile
  // project for no benefit outside local development.
  devIndicators: false,
};

export default nextConfig;
