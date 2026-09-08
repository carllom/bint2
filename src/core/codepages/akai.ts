/**
 * AKAI sampler character set (#56, plan §5.1).
 *
 * The AKAI S1000 / S3000 samplers store program and sample names as codes
 * 0-40: digits 0-9 (0x00-0x09), space (0x0A), A-Z (0x0B-0x24), then `#` `+`
 * `-` `.` (0x25-0x28). Every other byte is the shared placeholder `.`.
 *
 * Source of truth: the AKAI S1000/S3000 disk-format name-field encoding.
 * TODO: reconcile against the requesters C# implementation when available.
 */
export const AKAI: readonly string[] = Object.freeze(
  Array.from(
    "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ#+-........................................................................................................................................................................................................................",
  ),
)
