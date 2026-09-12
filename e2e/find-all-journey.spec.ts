import { expect, test } from '@playwright/test'
import { FIXTURE_PATH } from './support/fixture'
import { gotoOffset } from './support/goto'

// Find All (#106, ADR-0014, docs/plan-phase2.md §3.5-3.6): the capped
// (500-result) whole-file scan and the persistent Search results panel it
// populates. The shared fixture (`support/fixture.ts`) already is the
// pathological repeated-byte case this needs: byte `i` holds `i & 0xff`, so
// the single hex byte `00` recurs every 256 bytes — 32768 times across the
// ~8 MiB fixture, far past the cap — while the find-journey e2e (#103)
// already covers Find Next/Previous end to end against a real Worker, so
// this journey stays scoped to what only Find All exercises: the cap, the
// partial label, and a Search results row driving the Cursor.

test('Find All on a pathological repeated-byte fixture → capped labeled list → click a row → Cursor jumps', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH)
  await expect(page.locator('[data-field="file-name"]')).not.toBeEmpty()

  const cursorOffset = page.locator('[data-field="cursor-offset"]')

  // Open the Search results section before Find All runs, so its content
  // repaints in place as the store populates — no need to fight the Find
  // box's own focus-trapping by clicking the sidebar while it is still open.
  await page.getByRole('button', { name: 'Search results' }).click()
  await expect(page.locator('[data-region="search-results"]')).toContainText(/find all/i)

  await page.locator('.hex-viewer__row-area').click() // `/` only opens Find while the grid has focus
  await page.keyboard.press('/')
  await expect(page.locator('.find-box')).toBeVisible()
  await page.locator('#find-box-input').fill('00')
  await page.locator('.find-box__find-all').click()

  const partialNote = page.locator('[data-field="search-results-partial"]')
  await expect(partialNote).toHaveText(/first 500 shown — narrow your search/i)

  const hits = page.locator('[data-field="search-result-hit"]')
  await expect(hits).toHaveCount(500)
  await expect(page.locator('[data-field="search-result-offset"]').first()).toHaveText('0x00')

  await page.keyboard.press('Escape') // the panel stays populated after the Find box closes
  await expect(page.locator('.find-box')).toBeHidden()

  // Move the Cursor well away first, so the row click's effect is unambiguous.
  await gotoOffset(page, '0x123456')
  await expect(cursorOffset).toContainText('0x123456')

  await hits.nth(1).click() // the second hit — offset 0x100, not the first (0x0)
  await expect(cursorOffset).toContainText('0x100')
})
