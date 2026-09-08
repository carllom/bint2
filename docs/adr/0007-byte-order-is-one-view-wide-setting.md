# Byte order is one view-wide setting

Phase 1.5's [inspector](../../CONTEXT.md) decodes the bytes at the cursor into
`u16`/`i16` … `f64`, each of which needs a **byte order**
([#55](https://github.com/carllom/bint2/issues/55)). We decided byte order is a
**single little-endian-by-default setting** that spans the whole view — persisted
through the `preferences` store, toggled from a toolbar control or the `b`
hotkey, announced through ADR-0005's action region — and that it governs *every*
multi-byte numeric decode of the document (the inspector now; the element grid
and later decode features by the same rule), while **never** touching the char
column or a raw-byte copy, which have no order to choose. Little-endian is the
default because the comparable-tools survey
([#52](https://github.com/carllom/bint2/issues/52)) found it near-universal.

## Considered options

- **Per-row endianness in the inspector** (ImHex-style) — rejected: it makes byte
  order an inspector detail, with nowhere to stand for the element grid, and
  doubles every inspector row.
- **A panel-local toggle** owned by the inspector — rejected for the same reason;
  the setting outlives the panel.
- **Bind byte order to a detected file endianness** — rejected: bint2 views
  arbitrary binary with no format knowledge, so there is nothing to detect.

## Consequences

A reader watching the inspector's numbers change with no local cause is seeing
this setting; the toolbar control and the `b` hotkey are the only things that
move it, and the char column / offset column / `u8` / `i8` / `bin` / hex-copy /
raw-text copy are all deliberately unaffected.

The [code page](../../CONTEXT.md) ([#56](https://github.com/carllom/bint2/issues/56))
follows this same shape for the same reasons — one persisted, view-wide setting,
not per-selection or per-file — as the mirror image: it governs only the char
column's glyphs and touches no numeric decode, where byte order governs every
numeric decode and never the char column.
