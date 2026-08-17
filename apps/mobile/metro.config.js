// Monorepo-aware Metro config: this app resolves workspace packages
// (@soccer/contracts, @soccer/i18n, @soccer/ui-tokens) that live outside
// apps/mobile via pnpm's symlinked node_modules. Metro doesn't understand
// symlinks or workspace layouts by default, so all three settings below are
// required, not optional tuning — https://docs.expo.dev/guides/monorepos/.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
