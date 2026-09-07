import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The single fixture the whole e2e suite opens (issue #31): ~8 MiB of
 * deterministic bytes, byte `i` holding `i & 0xff` — the same synthetic pattern
 * the unit suites use, so an assertion can predict any byte's value from its
 * offset.
 *
 * The size is 8 MiB **plus 5** on purpose. 5 is not a multiple of any
 * bytes-per-row preset (8 / 16 / 24 / 32), so `Ctrl+End` lands on a genuinely
 * short final row of 5 bytes rather than a full one — which is the thing that
 * test needs to observe.
 */
export const FIXTURE_NAME = 'sample.bin'
export const FIXTURE_SIZE = 8 * 1024 * 1024 + 5

/** Offset the final row starts at (FIXTURE_SIZE aligned down to a 16-byte row). */
export const LAST_ROW_OFFSET = 8 * 1024 * 1024
/** Bytes in that final row — 5, the deliberately short tail. */
export const LAST_ROW_BYTE_COUNT = FIXTURE_SIZE - LAST_ROW_OFFSET
/** The last addressable byte — where `Ctrl+End` puts the Cursor. */
export const FINAL_BYTE_OFFSET = FIXTURE_SIZE - 1

const here = dirname(fileURLToPath(import.meta.url))
/** Absolute path to the materialised fixture, for `setInputFiles`. */
export const FIXTURE_PATH = join(here, '..', '.fixtures', FIXTURE_NAME)

/**
 * Fill `bytes` with the fixture pattern in place. The window-drop helper
 * (`support/drop.ts`) repeats this loop inline in page context, where this
 * module cannot be imported — keep the two in step.
 */
export function fillFixturePattern(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = i & 0xff
  }
}

/**
 * Materialise the fixture on disk unless a correct one is already there.
 * Idempotent, and called once from Playwright's global setup — a warm checkout
 * regenerates nothing.
 */
export function ensureFixture(): void {
  try {
    if (statSync(FIXTURE_PATH).size === FIXTURE_SIZE) {
      return
    }
  } catch {
    // Not present (or unreadable) — fall through and write it.
  }
  const bytes = new Uint8Array(FIXTURE_SIZE)
  fillFixturePattern(bytes)
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true })
  writeFileSync(FIXTURE_PATH, bytes)
}
