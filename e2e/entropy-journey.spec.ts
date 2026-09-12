import { expect, test } from '@playwright/test'
import { FIXTURE_PATH } from './support/fixture'
import { gotoOffset } from './support/goto'

// The Entropy Panel's Map view (#107, CONTEXT.md's Entropy map, ADR-0012,
// docs/plan-phase2.md §4, §7.3): open → Compute → the heatmap strip renders →
// click a block → the Cursor jumps and the grid reveals it. Deliberately
// thin, in the same spirit as the phase-1.75 Bitmap journey — Compute/Cancel
// and staleness transitions are already covered end to end against a fake
// worker in `EntropyPanel.spec.ts`/`entropy.spec.ts`, which can also assert
// the *precise* claim ("a cancelled job's late result never renders") in a
// way a real, fast-completing scan over an 8 MiB fixture cannot reliably
// race against. A coarse block size keeps the strip's canvas small (~129
// blocks) and its per-block rendering predictable regardless of the panel's
// real, layout-dependent CSS width.

test('Entropy Panel: Compute renders the heatmap strip, and clicking a block moves the Cursor', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH)
  await expect(page.locator('[data-field="file-name"]')).not.toBeEmpty()

  await page.getByRole('button', { name: 'Entropy', exact: true }).click()
  await expect(page.locator('[data-field="entropy-no-result"]')).toBeVisible()

  // Move the Cursor away first, so the click's effect below is unambiguous.
  const cursorOffset = page.locator('[data-field="cursor-offset"]')
  await gotoOffset(page, '0x123456')
  await expect(cursorOffset).toContainText('0x123456')

  const blockSize = page.locator('[data-field="entropy-block-size"]')
  await blockSize.fill('65536') // ~8 MiB fixture / 64 KiB -> ~129 blocks
  await blockSize.dispatchEvent('change')
  await page.locator('[data-field="entropy-compute"]').click()

  const canvas = page.locator('[data-field="entropy-canvas"]')
  await expect(canvas).toBeVisible()
  await expect(page.locator('[data-field="entropy-no-result"]')).toHaveCount(0)
  await expect(page.locator('[data-field="entropy-status"]')).toHaveCount(0) // not stale, nothing pending

  // A click 1px from the strip's left edge lands in block 0 — [0, 65536) —
  // however wide the panel actually renders, since the strip is stretched
  // across many more than one block per pixel and block 0 owns several
  // pixels at any realistic panel width.
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + 1, box.y + box.height / 2)

  await expect(cursorOffset).toContainText('0x00')
})
