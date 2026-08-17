// This package pins eslint@^9 (package.json), diverging from the rest of
// the monorepo's eslint@^10.8.0 — eslint-config-expo's eslint-plugin-react
// dependency (7.37.5) only declares support up to eslint ^9.7 and throws
// (`contextOrFilename.getFilename is not a function`) on 10.x. Revisit once
// eslint-config-expo/eslint-plugin-react ship eslint 10 support.
import { defineConfig, globalIgnores } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';
import prettier from 'eslint-config-prettier';

export default defineConfig([
  ...expoConfig,
  prettier,
  globalIgnores(['.expo/**', 'dist/**', 'node_modules/**', 'coverage/**']),
]);
