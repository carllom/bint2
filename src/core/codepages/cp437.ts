/**
 * Code page 437 — the IBM PC hardware glyph set (#56, plan §5.1).
 *
 * All 256 values carry a glyph; there is no placeholder in this table ever.
 * 0x01-0x1F are the control-pictures the CGA/EGA/VGA text ROM actually drew
 * (☺☻♥♦♪♫ ...); 0x00 is blank, as on the hardware; 0x7F is ⌂; and 0x80-0xFF are
 * the accented-Latin / box-drawing / Greek / maths range.
 *
 * Source of truth: the Unicode equivalents in the "Code page 437" reference
 * chart (unicode.org CP437.TXT and the Wikipedia table), hand-adjusted so the
 * C0 range shows the hardware glyphs rather than Unicode C0 controls.
 */
export const CP437: readonly string[] = Object.freeze(
  Array.from(
    " ☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ),
)
