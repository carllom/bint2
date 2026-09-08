/**
 * PETSCII, unshifted (uppercase / graphics) set (#56, plan §5.1).
 *
 * Commodore 64 unshifted character ROM. The control ranges 0x00-0x1F and
 * 0x80-0x9F render the shared placeholder `.`. 0x20-0x3F are ASCII; 0x40-0x5F
 * are `@` A-Z `[` £ `]` ↑ ←; 0x60-0x7F is the graphics block;
 * 0xC0-0xDF duplicate 0x60-0x7F, 0xE0-0xFE duplicate 0xA0-0xBE, and 0xFF is
 * π. Graphics glyphs use the closest standard Unicode (box-drawing, block
 * elements, and the "Symbols for Legacy Computing" block); exact pixel shapes
 * beyond the specs pinned entries are approximate (plan §8).
 *
 * Source of truth: the "PETSCII" chart (Wikipedia), unshifted column,
 * reconstructed from the Commodore character ROM.
 */
export const PETSCII: readonly string[] = Object.freeze(
  Array.from(
    "................................ !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[£]↑← ♠│─🭷🭶🭺🭱🭴╮╰╯🭼╲╱🭽🭾╭─♥🭻│✕○♣🭵♦┼🮌│π◥................................█♠│─🭷🭶🭺🭱🭴╮╰╯🭼╲╱🭽🭾╭─♥🭻│✕○♣🭵♦┼🮌│π◥ ♠│─🭷🭶🭺🭱🭴╮╰╯🭼╲╱🭽🭾╭─♥🭻│✕○♣🭵♦┼🮌│π◥█♠│─🭷🭶🭺🭱🭴╮╰╯🭼╲╱🭽🭾╭─♥🭻│✕○♣🭵♦┼🮌│ππ",
  ),
)
