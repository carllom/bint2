import { expect, test } from '@playwright/test'
import { FIXTURE_NAME, FIXTURE_PATH } from './support/fixture'
import { gotoOffset } from './support/goto'

// Phase 1.75's one added end-to-end journey (plan §7, §8 P1.75-M7, issue #85),
// deliberately thin in the same spirit as the phase-1 and phase-1.5 journeys:
//
//   open → open the Bitmap Panel → move the Cursor, see the pixels track
//        → `L`, move the Cursor, see the image hold and the Extent marker
//          appear → click a pixel, see the Cursor jump and the grid reveal
//          that row → drag the splitter, reload, see `sidebarWidth` persist
//
// Byte `i` of the fixture holds `i & 0xff` (plan §4, `support/fixture.ts`), so
// two Origins that differ by a multiple of 256 pack to pixel-identical images —
// the offsets below are chosen to avoid that by construction.

test('Bitmap Panel: follow tracks the Cursor, lock holds the image, the Extent marker and click-to-cursor link back to the grid, and the splitter width persists', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH)
  await expect(page.locator('[data-field="file-name"]')).toHaveText(FIXTURE_NAME)

  // Open the Bitmap Panel. No Cursor yet, so no canvas.
  await page.getByRole('button', { name: 'Bitmap', exact: true }).click()
  await expect(page.locator('[data-field="bitmap-no-cursor"]')).toBeVisible()

  const canvas = page.locator('[data-field="bitmap-canvas"]')
  const status = page.locator('[data-field="bitmap-status"]')
  const cursorOffset = page.locator('[data-field="cursor-offset"]')

  const dataUrl = (): Promise<string> =>
    canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL())

  // Wait until two consecutive reads agree — the async page-cache read behind
  // the frame has settled, so this is a real painted frame, not a transient one.
  async function stableFrame(): Promise<string> {
    let last = await dataUrl()
    await expect
      .poll(async () => {
        const next = await dataUrl()
        const settled = next === last
        last = next
        return settled
      })
      .toBe(true)
    return last
  }

  // Moving the Cursor gives the Bitmap an Origin. Width 4 / Stride 4 (defaults)
  // / Zoom 2 (default); Height is pinned to 40 here so the canvas geometry used
  // for the click-to-cursor math below does not depend on the Sidebar's
  // measured layout.
  await gotoOffset(page, '0x1000')
  await expect(status).toHaveText('Following cursor')
  const heightInput = page.locator('[data-field="bitmap-height"]')
  await heightInput.fill('40')
  await heightInput.dispatchEvent('change')

  const followFrame1 = await stableFrame()

  // Byte-stepping the Cursor slides the image — 0x1005 is 5 bytes into the same
  // 256-byte pattern cycle as 0x1000, so the packed pixels are genuinely
  // different, not just re-sampled from an identical run.
  await gotoOffset(page, '0x1005')
  await expect.poll(dataUrl).not.toBe(followFrame1)

  // Lock the Origin back at 0x1000, then move the Cursor away — the image holds.
  await gotoOffset(page, '0x1000')
  await page.locator('[data-region="bitmap"]').focus()
  await page.keyboard.press('l')
  await expect(status).toHaveText('Locked · 0x1000')
  const lockedFrame = await stableFrame()

  await gotoOffset(page, '0x400000')
  await expect(cursorOffset).toContainText('0x400000')
  expect(await dataUrl()).toBe(lockedFrame)

  // The Extent marker: the locked Origin (0x1000) is now well above the
  // viewport (scrolled to 0x400000), so the grid shows the off-screen chevron.
  // Clicking it scrolls the grid to the Extent's first row — 0x1000 is already
  // row-aligned at the default 16 bytes/row.
  const chevron = page.locator('[data-field="extent-chevron"]')
  await expect(chevron).toBeVisible()
  await chevron.click()
  await expect(page.locator('.hex-row:not([hidden]) .hex-row__addr').first()).toHaveText(
    '00001000',
  )

  // Click-to-cursor: with Origin 0x1000, Width 4, Stride 4, Zoom 2, a click at
  // canvas-relative (17, 5) → col = floor(17/2) = 8, row = floor(5/2) = 2 →
  // target = 0x1000 + 2·4 + floor(8/8) = 0x1009. The Origin stays locked (it
  // is only nudged by the Bitmap section's own keys); this is purely the Cursor
  // moving, and the grid revealing the row it landed on.
  await canvas.click({ position: { x: 17, y: 5 } })
  await expect(cursorOffset).toContainText('0x1009')
  await expect(page.locator('.hex-row__byte--cursor[data-offset="4105"]')).toBeVisible()

  // The splitter: drag it, then reload and confirm `sidebarWidth` persisted.
  const handle = page.locator('.splitter-resize-handle')
  const box = await handle.boundingBox()
  expect(box, 'splitter handle not found').not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x - 80, box!.y + box!.height / 2)
  await page.mouse.up()

  const readSidebarWidth = (): Promise<number | null> =>
    page.evaluate(() => {
      const raw = localStorage.getItem('bint2:preferences')
      return raw ? (JSON.parse(raw).sidebarWidth as number) : null
    })

  const draggedWidth = await readSidebarWidth()
  expect(draggedWidth).not.toBeNull()
  expect(draggedWidth).not.toBe(320)

  await page.reload()
  expect(await readSidebarWidth()).toBe(draggedWidth)
})
