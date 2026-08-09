import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@soccer/contracts', '@soccer/i18n', '@soccer/ui-tokens'],
};

export default nextConfig;
