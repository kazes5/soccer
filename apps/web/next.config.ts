import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@soccer/contracts', '@soccer/i18n', '@soccer/ui-tokens'],
  // The dev-mode indicator overlay has no production equivalent and, at
  // small viewports, its fixed-position badge sits on top of the bottom
  // navigation and intercepts real clicks — breaks Playwright's mobile
  // project for no benefit outside local development.
  devIndicators: false,
  // Proxies the API through this app's own origin so the browser's session
  // cookie is same-site, not cross-site. In production, web and api sit on
  // two different Railway-generated `*.up.railway.app` domains — that
  // suffix is on the Public Suffix List, so each is its own registrable
  // site, not just a different origin. Mobile Safari (and every other iOS
  // browser, which is WebKit under the hood) unconditionally blocks
  // cross-site cookies via ITP regardless of `SameSite=None; Secure`, which
  // silently discarded the session cookie set by `POST
  // /auth/password/login` on mobile: the login request itself succeeded,
  // but the immediate next request (`/auth/me`) had no cookie to send, 401'd,
  // and bounced back to `/login`. Desktop Chrome doesn't block third-party
  // cookies by default, so the bug was invisible there. Routing browser
  // calls through `/api/*` on this same origin (server-side proxy to the
  // real API, set via `API_PROXY_TARGET`) makes the cookie first-party,
  // sidestepping the restriction entirely — no change needed to
  // `apps/api/src/lib/cookies.ts`'s `SameSite=None; Secure`, which still
  // works correctly once same-site. Local dev leaves `API_PROXY_TARGET`
  // unset (web and api already share a host, differing only by port, so
  // there's nothing cross-site to fix there) and talks to the API directly,
  // same as before.
  async rewrites() {
    const apiProxyTarget = process.env.API_PROXY_TARGET;
    if (!apiProxyTarget) return [];
    return [{ source: '/api/:path*', destination: `${apiProxyTarget}/:path*` }];
  },
};

export default nextConfig;
