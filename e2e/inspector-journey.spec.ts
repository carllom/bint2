import { expect, test } from '@playwright/test'
import { FIXTURE_PATH } from './support/fixture'
import { gotoOffset } from './support/goto'

// Phase 1.5's one added end-to-end journey (plan §8, seam 3), deliberately thin
// in the same spirit as the phase-1 keyboard journey. Byte `i` of the fixture
// holds `i & 0xff`, so the numbers below are predictable: at offset 0x1000 the
// eight bytes are 0x00..0x07.
//
//   open → move the Cursor → read an Inspector row → press `b`, see it change
//        → switch the code page, see the char column change

test('inspector row re-decodes on `b`; the code page re-glyphs the char column', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH)
  await expect(page.locator('[data-field="file-name"]')).not.toBeEmpty()

  // Move the Cursor to an exact offset with the keyboard path.
  await gotoOffset(page, '0x1000')
  await expect(page.locator('[data-field="cursor-offset"]')).toContainText('0x1000')

  // The Inspector is visible and decodes the bytes at the Cursor. u16 of
  // 0x00 0x01 little-endian is 0x0100 = 256.
  const u16 = page.locator('[data-field="inspector-u16"]')
  await expect(u16).toHaveText('256')
  await expect(page.locator('[data-field="inspector-u8"]')).toHaveText('0')

  // Press `b` with the grid focused — byte order flips to big-endian and the
  // multi-byte row re-decodes to 0x0001 = 1. The width-1 rows do not move.
  await page.locator('.hex-viewer__row-area').focus()
  await page.keyboard.press('b')
  await expect(page.locator('[data-field="action-live-region"]')).toHaveText(
    'Byte order: big-endian',
  )
  await expect(u16).toHaveText('1')
  await expect(page.locator('[data-field="inspector-u8"]')).toHaveText('0')

  // Switch the code page: the top row starts at 0x1000, so the char cell for
  // offset 0x1001 holds byte 0x01 — "." under ASCII, the CP437 hardware glyph
  // "☺" under CP437. Nothing else about the grid moves.
  const charCell = page.locator('.hex-row__char[data-offset="4097"]') // 0x1001
  await expect(charCell).toHaveText('.')
  await page.locator('.code-page-control__select').selectOption('cp437')
  await expect(charCell).toHaveText('☺')
})
