// jest is pinned to ^29.7.0 (package.json), not the monorepo-wide-adjacent
// latest — jest-expo@57.0.4's own dependencies (@jest/globals, jest-snapshot,
// babel-jest, jest-environment-jsdom) are all pinned to ^29.2.1 and it
// throws at runtime (`clearMocksOnScope is not a function`) against jest 30.
//
// No custom `transformIgnorePatterns` needed: our workspace packages
// (@soccer/contracts, @soccer/i18n, @soccer/ui-tokens) are pnpm-symlinked
// from apps/mobile/node_modules straight to packages/*/src — outside any
// node_modules directory once the symlink resolves — so jest-expo's default
// pattern (which only governs what happens *inside* node_modules) never
// applies to them; they're transformed like any other first-party source.
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Official mock from the package itself — real AsyncStorage is backed by
  // native storage that doesn't exist under plain Jest/Node. It's a plain
  // object export (no `jest.mock` side effect of its own), so it has to be
  // wired in via `moduleNameMapper`, not `setupFiles`.
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
  },
};
