/**
 * AKAI sampler character set (#56, plan §5.1).
 *
 * The AKAI S1000 / S3000 samplers store program and sample names as codes
 * 0-40: digits 0-9 (0x00-0x09), space (0x0A), A-Z (0x0B-0x24), then `#` (0x25),
 * `+` (0x26), `-` (0x27), and a genuine `.` (0x28). Every byte past 0x28 is
 * unmapped and renders the shared placeholder `.` — the same glyph as 0x28,
 * different meaning.
 *
 * Source of truth: the requester's C# implementation of the AKAI name codec,
 * which uses exactly this 0-40 map (confirmed).
 */
export const AKAI: readonly string[] = Object.freeze(
  Array.from(
    "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ#+-........................................................................................................................................................................................................................",
  ),
)
