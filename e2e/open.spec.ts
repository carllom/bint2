import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  FINAL_BYTE_OFFSET,
  FIXTURE_NAME,
  FIXTURE_PATH,
  FIXTURE_SIZE,
  LAST_ROW_BYTE_COUNT,
  LAST_ROW_OFFSET,
} from './support/fixture'
import { dropFileOnWindow } from './support/drop'

// M8's automated half (issue #31): a deliberately thin pass over the things the
// component and unit seams can only fake — a real browser, a real File, the
// production build. Nothing here re-tests logic already covered below the shell.
//
// No dead-source flow is exercised here, on purpose (plan §11): moving a fixture
// out from under a live browser session tests the harness, not the app. That
// behaviour is component-tested against a rejecting source and unit-tested at
// the latch.
//
// The default is 16 bytes per row; every offset assertion below assumes it.

const fileName = (page: Page) => page.locator('[data-field="file-name"]')
const fileSize = (page: Page) => page.locator('[data-field="file-size"]')
const cursorOffset = (page: Page) => page.locator('[data-field="cursor-offset"]')
const visibleRows = (page: Page) => page.locator('.hex-row:not([hidden])')

// The app renders exact byte counts with `Number.toLocaleString()`; the test
// browser runs the en-US locale, so grouping is commas. Match that, not the
// Node process locale.
const grouped = (n: number) => n.toLocaleString('en-US')

async function openViaButton(page: Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH)
  await expect(fileName(page)).toHaveText(FIXTURE_NAME)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('opens the fixture from the Open-file button', async ({ page }) => {
  await openViaButton(page)

  await expect(fileSize(page)).toContainText(grouped(FIXTURE_SIZE))
  // The grid painted real bytes, not just placeholder rows.
  await expect(visibleRows(page).first().locator('.hex-row__addr')).toHaveText('00000000')
  await expect(visibleRows(page).first().locator('.hex-row__byte').first()).toHaveText('00')
})

test('opens the fixture from a window drop', async ({ page }) => {
  await dropFileOnWindow(page, { name: FIXTURE_NAME, size: FIXTURE_SIZE })

  await expect(fileName(page)).toHaveText(FIXTURE_NAME)
  await expect(fileSize(page)).toContainText(grouped(FIXTURE_SIZE))
  await expect(visibleRows(page).first().locator('.hex-row__addr')).toHaveText('00000000')
})

test('the wheel scrolls the Viewport off the first row', async ({ page }) => {
  await openViaButton(page)
  const firstAddr = visibleRows(page).first().locator('.hex-row__addr')
  await expect(firstAddr).toHaveText('00000000')

  await page.locator('[data-region="viewport"]').hover()
  await page.mouse.wheel(0, 6000)

  await expect(firstAddr).not.toHaveText('00000000')
})

test('Ctrl+End lands on the final byte above a short last row', async ({ page }) => {
  await openViaButton(page)
  await page.locator('[data-region="viewport"]').click() // focus the Viewport
  // The first cursor key only reveals the Cursor at the top of the view when
  // there is no Selection yet (HexViewer.onKeyDown); the second one navigates.
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Control+End')

  const finalHex = `0x${FINAL_BYTE_OFFSET.toString(16).toUpperCase()}`
  await expect(cursorOffset(page)).toContainText(finalHex)
  await expect(cursorOffset(page)).toContainText(String(FINAL_BYTE_OFFSET))

  const lastRow = visibleRows(page).last()
  await expect(lastRow.locator('.hex-row__addr')).toHaveText(
    LAST_ROW_OFFSET.toString(16).toUpperCase().padStart(8, '0'),
  )
  // Five real byte cells, not a padded-out full row.
  await expect(lastRow.locator('.hex-row__byte')).toHaveCount(LAST_ROW_BYTE_COUNT)
})

test('Ctrl+G jumps the Cursor to a mid-file offset', async ({ page }) => {
  await openViaButton(page)

  await page.keyboard.press('Control+g')
  const gotoInput = page.locator('#goto-box-input')
  await expect(gotoInput).toBeFocused()
  await gotoInput.fill('0x400000')
  await page.keyboard.press('Enter')

  await expect(cursorOffset(page)).toContainText('0x400000')
  await expect(cursorOffset(page)).toContainText(String(0x400000))
})
