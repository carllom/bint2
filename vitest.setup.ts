import { beforeEach } from 'vitest'

// Node 26 ships an experimental global `localStorage` that is inert unless the
// process is started with `--localstorage-file`, and it is non-configurable
// enough that vitest's happy-dom environment cannot shadow it — a bare
// `localStorage` reference resolves to the broken built-in rather than a working
// Storage (`sessionStorage`, which Node does not define, comes through fine).
// happy-dom's own `Storage` is a method-binding Proxy that `vi.spyOn` cannot
// cleanly restore between cases, so install a plain in-memory `Storage` under
// the global name instead: the `preferences` store still talks to the real
// global `localStorage` with no injected seam (plan §2), and its methods live on
// a normal prototype that spies can stub and restore per test.
class MemoryStorage implements Storage {
  #data = new Map<string, string>()

  get length(): number {
    return this.#data.size
  }

  key(index: number): string | null {
    return [...this.#data.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.#data.has(key) ? this.#data.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.#data.set(String(key), String(value))
  }

  removeItem(key: string): void {
    this.#data.delete(key)
  }

  clear(): void {
    this.#data.clear()
  }

  [name: string]: unknown
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
})

// The one MemoryStorage lives for the whole test file; clear it between cases so
// persisted `preferences` never leak from one test into the next.
beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    // A test may have stubbed `clear` to throw — its own concern, not ours.
  }
})
