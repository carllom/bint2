import { expect, test } from '@playwright/test'
import { FIXTURE_PATH } from './support/fixture'

// The copy step writes the real clipboard. Headless Chromium needs the
// permission granted explicitly; Firefox and WebKit reject the grant call
// (unknown permission) and allow the write anyway, so swallow that rejection
// rather than branch on the engine.
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
})

// The keyboard-only journey (issue #31) — the test that actually guards the
// accessibility commitment, because axe cannot see whether the arrow keys move
// the Cursor. From the file being open to bytes on the clipboard, the pointer
// is never touched: `setInputFiles` is a programmatic API call, and every step
// after it is a key press.
//
// Byte `i` of the fixture holds `i & 0xff`, so the copied range below is
// predictable: offsets 0x1012..0x1016 hold 0x12..0x16.

test('open → Ctrl+G → arrows → shift-select → copy, keyboard only', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH)
  await expect(page.locator('[data-field="file-name"]')).not.toBeEmpty()

  const cursorOffset = page.locator('[data-field="cursor-offset"]')

  // Ctrl+G to an exact offset — the fine navigation path Goto exists to provide.
  await page.keyboard.press('Control+g')
  await page.locator('#goto-box-input').fill('0x1000')
  await page.keyboard.press('Enter')
  await expect(cursorOffset).toContainText('0x1000')

  // Walk the Cursor with the arrows: right, right, down → 0x1002 + one row = 0x1012.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect(cursorOffset).toContainText('0x1012')

  // Shift-extend four bytes → [0x1012, 0x1017): a 5-byte Selection.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Shift+ArrowRight')
  }
  await expect(page.locator('[data-field="selection-length"]')).toHaveText('5 B')

  // Copy as hex. The visible copy-status line is the proof the write resolved —
  // a rejected clipboard write would show a failure message here instead.
  await page.keyboard.press('Control+c')
  await expect(page.locator('[data-field="copy-status"]')).toHaveText(
    'Copied 5 bytes to the clipboard as hex.',
  )

  // And the bytes that actually landed on the clipboard are the selected range,
  // spaced-hex — 0x1012..0x1016 hold 0x12..0x16.
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('12 13 14 15 16')
})
