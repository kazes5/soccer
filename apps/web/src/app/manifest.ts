import type { MetadataRoute } from 'next';

/**
 * Makes the web app installable ("Add to Home Screen"). On iPhone and iPad
 * this isn't optional polish: iOS (16.4+) only allows web push for a web app
 * opened from the Home Screen, so without a manifest iOS parents can't get
 * push at all — see lib/push.ts's `needsHomeScreenInstall`. Icons live in
 * public/icons (drawn as SVG, rendered to PNG); the green is the default
 * brand color (`--color-brand` in globals.css).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Soccer Carpool Coordinator',
    short_name: 'Carpool',
    description: 'Coordinate youth soccer team carpool pickups and drop-offs.',
    start_url: '/home',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1f7a4d',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Full-bleed background with the ball inside the central safe zone,
      // so the same artwork survives Android's maskable crop.
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
