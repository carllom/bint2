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
export type { CodePage } from './codepages'
export { charFor, CODE_PAGES, PLACEHOLDER_GLYPH } from './codepages'
export { PageCache } from './PageCache'
export type { FetchRange, PageCacheDeps, PageCacheOptions, PageCacheStats } from './PageCache'
export {
  addressWidthFor,
  describeSelection,
  parseOffset,
  toAddress,
  toAsciiChar,
  toBinary,
  toByteSize,
  toByteSizeDetail,
  toHex,
  toHexString,
  toRawText,
  toSignedByte,
} from './format'
export type { DecodeOptions, InspectorRow, InspectorRowKind } from './inspector'
export { decodeInspectorRow, INSPECTOR_READ_LENGTH, INSPECTOR_ROWS } from './inspector'
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
