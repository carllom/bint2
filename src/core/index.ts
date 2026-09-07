// src/core — the framework-free core.
//
// Everything hard (paging, the page cache, coordinate math, formatting) lives
// here as plain TypeScript with no Vue / Pinia / vue-router import, so it is
// unit-testable in isolation and a worker/main-thread split would be invisible
// to the UI. The rule is enforced mechanically, not by convention:
//   - the eslint override for `src/core/**` in eslint.config.ts, and
//   - src/core/__tests__/framework-free.spec.ts
//
// Phase 1 builds no Web Worker (ADR-0001) — no stub worker module lives here.

export type { ByteSource, ByteSourceErrorCode } from './ByteSource'
export { ByteSourceError, FileByteSource } from './FileByteSource'
export { PageCache } from './PageCache'
export type { FetchRange, PageCacheDeps, PageCacheOptions, PageCacheStats } from './PageCache'
export {
  addressWidthFor,
  parseOffset,
  toAddress,
  toAsciiChar,
  toBinary,
  toByteSize,
  toHex,
  toSignedByte,
} from './format'
export type { Selection, SelectionRange } from './selection'
export { cursorAt, extendTo, isCollapsed, rangeOf } from './selection'
export type { ThumbGeometry, ViewportMetrics } from './viewport'
export {
  clampTopOffset,
  maxFirstRow,
  offsetFromThumbPixel,
  offsetOfRow,
  rowCount,
  rowOfOffset,
  thumbGeometry,
  visibleRows,
} from './viewport'
