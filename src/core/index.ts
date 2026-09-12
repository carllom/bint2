// src/core — the framework-free core.
//
// Everything hard (paging, the page cache, coordinate math, formatting) lives
// here as plain TypeScript with no Vue / Pinia / vue-router import, so it is
// unit-testable in isolation and a worker/main-thread split would be invisible
// to the UI. The rule is enforced mechanically, not by convention:
//   - the eslint override for `src/core/**` in eslint.config.ts, and
//   - src/core/__tests__/framework-free.spec.ts
//
// Phase 2 trips ADR-0001's Derived-work trigger (ADR-0013): derived-work.worker.ts
// is the real Web Worker, DerivedWorkClient its main-thread client. ByteSource
// and PageCache stay frozen and untouched by either.

export type {
  BitmapOffsetAtParams,
  BitOrder,
  EofByteSlotsParams,
  PackBitmapParams,
  PackedBitmap,
  PackOrder,
  RowByteSpanParams,
} from './bitmap'
export { bitmapOffsetAt, eofByteSlots, packBitmap, rowByteSpan } from './bitmap'
export type { ByteSource, ByteSourceErrorCode } from './ByteSource'
export { ByteSourceError, FileByteSource } from './FileByteSource'
export type { CodePage } from './codepages'
export type {
  DerivedWorkErrorCode,
  DerivedWorkJobKind,
  DerivedWorkRequestMessage,
  DerivedWorkResponseMessage,
  SearchParams,
  SearchProgressExtra,
  SearchResult,
  StatsParams,
  StatsResult,
} from './DerivedWork'
export type {
  DerivedWorkClientDeps,
  DerivedWorkJobHandle,
  DerivedWorkWorkerLike,
  SearchProgress,
  StatsProgress,
} from './DerivedWorkClient'
export { DerivedWorkCancelled, DerivedWorkClient, DerivedWorkError } from './DerivedWorkClient'
export { buildReverseTable, charFor, CODE_PAGES, PLACEHOLDER_GLYPH } from './codepages'
export { PageCache } from './PageCache'
export type { FetchRange, PageCacheDeps, PageCacheOptions, PageCacheStats } from './PageCache'
export {
  addressWidthFor,
  describeSelection,
  parseHexPattern,
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
export type { DecodeOptions, InspectorRow } from './inspector'
export { decodeInspectorRow, INSPECTOR_READ_LENGTH, INSPECTOR_ROWS } from './inspector'
export type { MatchScopeRange, MatchStep, SearchDirection } from './searchMatches'
export { parseTextPattern, scopeMatches, stepMatch } from './searchMatches'
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
