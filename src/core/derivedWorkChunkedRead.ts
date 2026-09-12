/**
 * The chunked, depth-N read-ahead pipeline both derived-work forward scans
 * (`searchForward`, `computeStats`) build their pass on — issue #96's
 * validated shape, built directly on `File.slice().arrayBuffer()`, never
 * through ByteSource/PageCache (ADR-0013 §2.2). Extracted once a second scan
 * needed it verbatim, so a future tuning change (chunk size, read-ahead
 * depth) lands in one place for both.
 */

/** #96 Scenario B: 1 MiB chunks were the fastest naive chunk size at scale. */
export const DEFAULT_CHUNK_SIZE = 1024 * 1024

/** #96 Scenarios E/F: depth-4 lookahead captures nearly all of the win. */
export const DEFAULT_READ_AHEAD_DEPTH = 4

/** A concretely `ArrayBuffer`-backed byte array — never `SharedArrayBuffer`. */
export type Bytes = Uint8Array<ArrayBuffer>

export interface Chunk {
  readonly offset: number
  readonly bytes: Bytes
}

export interface ChunkedReadOptions {
  readonly chunkSize?: number
  readonly readAheadDepth?: number
}

async function readChunk(file: File, offset: number, length: number): Promise<Bytes> {
  const buffer = await file.slice(offset, offset + length).arrayBuffer()
  return new Uint8Array(buffer)
}

/**
 * Yields `[start, end)` of `file` as sequential chunks, depth-N prefetched
 * ahead of consumption. A chunk issued ahead of the cursor may never be
 * consumed (a caller that stops early, e.g. on cancellation); its rejection
 * is swallowed here so it can never surface as an unhandled rejection — a
 * consumer that does reach and `await` it still sees the original rejection.
 */
export async function* chunkedReadAhead(
  file: File,
  start: number,
  end: number,
  options: ChunkedReadOptions = {},
): AsyncGenerator<Chunk, void, void> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const depth = options.readAheadDepth ?? DEFAULT_READ_AHEAD_DEPTH

  const inFlight: Array<{ offset: number; bytes: Promise<Bytes> }> = []
  let issueOffset = start
  const topUp = (): void => {
    while (inFlight.length <= depth && issueOffset < end) {
      const length = Math.min(chunkSize, end - issueOffset)
      const bytes = readChunk(file, issueOffset, length)
      bytes.catch((): void => {})
      inFlight.push({ offset: issueOffset, bytes })
      issueOffset += length
    }
  }
  topUp()

  while (inFlight.length > 0) {
    const next = inFlight.shift()!
    const bytes = await next.bytes
    topUp()
    yield { offset: next.offset, bytes }
  }
}
