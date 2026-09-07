// The renderer seam (ADR-0003, plan §4). DOM-coupled by nature, so it lives
// outside the framework-free core; a CanvasHexRenderer could slot in behind the
// same interface without touching the data layer.

export type { HexGridView, HexRowRenderer, HexRowView, SelectionView } from './HexRowRenderer'
export { DomHexRenderer } from './DomHexRenderer'
