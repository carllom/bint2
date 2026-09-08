/**
 * PETSCII, shifted (lowercase / uppercase) set (#56, plan §5.1).
 *
 * The Commodore 64 shifted character ROM: 0x41-0x5A are lowercase a-z and
 * 0x61-0x7A are uppercase A-Z, with the same control-range treatment and the
 * same graphics approximations as the unshifted table — see petscii.ts.
 */
export const PETSCII_LOWER: readonly string[] = Object.freeze(
  Array.from(
    "................................ !\"#$%&'()*+,-./0123456789:;<=>?@abcdefghijklmnopqrstuvwxyz[£]↑← ABCDEFGHIJKLMNOPQRSTUVWXYZ┼🮌│π◥................................█ABCDEFGHIJKLMNOPQRSTUVWXYZ┼🮌│π◥ ABCDEFGHIJKLMNOPQRSTUVWXYZ┼🮌│π◥█ABCDEFGHIJKLMNOPQRSTUVWXYZ┼🮌│ππ",
  ),
)
