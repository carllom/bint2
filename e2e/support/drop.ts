import type { Page } from '@playwright/test'

/**
 * Open a file the way a window drop does — the path `setInputFiles` cannot
 * exercise. Playwright has no file-drop primitive, so the `DataTransfer` is
 * built in page context: generate the bytes there with the same `i & 0xff`
 * pattern as the disk fixture (so both open paths see byte-identical content),
 * attach them as a `File`, and dispatch `dragover` then `drop` on `window` —
 * exactly the two events `FileDropZone` listens for.
 *
 * A plain `Event` with `dataTransfer` defined on it is used rather than
 * `new DragEvent(...)`: only Chromium honours a `dataTransfer` passed to the
 * `DragEvent` constructor, and the app only ever reads `event.dataTransfer`.
 */
export async function dropFileOnWindow(
  page: Page,
  file: { name: string; size: number },
): Promise<void> {
  await page.evaluate(({ name, size }) => {
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
      bytes[i] = i & 0xff
    }
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File([bytes], name, { type: 'application/octet-stream' }))
    for (const type of ['dragover', 'drop']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      window.dispatchEvent(event)
    }
  }, file)
}
