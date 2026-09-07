import { ensureFixture } from './support/fixture'

/**
 * Playwright global setup: materialise the ~8 MiB fixture before any project
 * runs. Referenced by path string from `playwright.config.ts` so the config's
 * own type-check program does not pull the e2e sources in.
 */
export default function globalSetup(): void {
  ensureFixture()
}
