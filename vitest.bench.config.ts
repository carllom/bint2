import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

/**
 * Runner for the issue #96 derived-work scan benchmark
 * (`src/core/__prototype__/derived-work-scan.bench.ts`) — a manual pass, not
 * part of `vitest.config.ts` / `npm run test:unit` / CI, on purpose: a
 * multi-second full-file scan has no business running on every commit (same
 * status as `docs/manual-passes.md`'s Pass 1). Kept as its own config, rather
 * than an entry in the main `exclude` list, so it stays fully separate from the
 * suite vue-tsc / CI actually run.
 *
 * `environment: 'node'` (not the project-wide `happy-dom`) so the harness
 * measures Node's native `File` / `Blob`, not a DOM polyfill.
 *
 * Run: `npx vitest run --config vitest.bench.config.ts`
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/core/__prototype__/**/*.bench.ts'],
      testTimeout: 180_000,
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
