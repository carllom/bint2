import { expect, test } from '@playwright/test'
import { FIXTURE_PATH } from './support/fixture'
import { gotoOffset } from './support/goto'

// Search (#103, docs/plan-phase2.md §3): deliberately thin, in the same spirit
// as the other phase journeys — open → open Find (`/`) → search → Next →
// wrap. Byte `i` of the fixture holds `i & 0xff` (`support/fixture.ts`), so the
// two-byte pattern `00 01` recurs at every 256-byte boundary. The last one
// before the fixture's end sits at 0x800000 (8_388_608): the next multiple of
// 256, 8_388_864, is past `FIXTURE_SIZE` (8 MiB + 5). Starting the Cursor
// exactly there means the first Next below has nothing left forward to find
// and must wrap to the first occurrence, at 0x0 — this also runs the search
// against a real Worker end to end, the one thing the component/unit suites
// (which substitute a fake worker) cannot exercise.

test('open → Find (/) → search → Next → wraps to the first match, then Next walks on', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH)
  await expect(page.locator('[data-field="file-name"]')).not.toBeEmpty()

  const cursorOffset = page.locator('[data-field="cursor-offset"]')
  const status = page.locator('#find-box-status')

  await gotoOffset(page, '0x800000')
  await expect(cursorOffset).toContainText('0x800000')

  // `/` opens Find while the grid has focus (Goto's confirm already returned
  // focus there).
  await page.keyboard.press('/')
  await expect(page.locator('.find-box')).toBeVisible()

  await page.locator('#find-box-input').fill('0001')
  await page.keyboard.press('Enter')

  await expect(cursorOffset).toContainText('0x00')
  await expect(status).toHaveText(/wrapped to start of file/i)

  // The wrap was a one-time boundary crossing, not a stuck state — a further
  // Next for the same term (served from the cached result, no second scan)
  // walks forward again with no wrap message.
  await page.keyboard.press('Enter')
  await expect(cursorOffset).toContainText('0x100')
  await expect(status).not.toHaveText(/wrapped/i)

  await page.keyboard.press('Escape')
  await expect(page.locator('.find-box')).toBeHidden()
})
