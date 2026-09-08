/**
 * Windows-1252 (#56, plan §5.1).
 *
 * The WHATWG / Unicode windows-1252 index. Its five genuinely unassigned slots
 * — 0x81 0x8D 0x8F 0x90 0x9D — render the shared placeholder `.`, as do the C0
 * range (0x00-0x1F), 0x7F, and the non-visible 0xA0 (NBSP) / 0xAD (SHY). Every
 * other byte is its code-point-equal CP1252 / Latin-1 glyph.
 *
 * Source of truth: the WHATWG Encoding Standard windows-1252 index.
 */
export const WINDOWS_1252: readonly string[] = Object.freeze(
  Array.from(
    "................................ !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~.€.‚ƒ„…†‡ˆ‰Š‹Œ.Ž..‘’“”•–—˜™š›œ.žŸ.¡¢£¤¥¦§¨©ª«¬.®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
  ),
)
