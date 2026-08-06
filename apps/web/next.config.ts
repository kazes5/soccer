import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@soccer/contracts', '@soccer/ui-tokens'],
};

export default nextConfig;
