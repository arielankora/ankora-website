// bidi-js (Phase 9 gap-fix, lib/pdf.ts) ships no bundled TypeScript types
// and no `@types/bidi-js` package exists on npm (confirmed via `npm view
// @types/bidi-js` - 404). Minimal ambient declaration covering only the
// API surface lib/pdf.ts actually calls, per TS's own suggested fix
// ("add a new declaration (.d.ts) file containing `declare module
// 'bidi-js'`").
declare module "bidi-js" {
  export interface EmbeddingLevelsResult {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }

  export interface BidiEngine {
    getEmbeddingLevels(text: string, baseDirection?: "ltr" | "rtl" | "auto"): EmbeddingLevelsResult;
    getReorderedString(text: string, embeddingLevels: EmbeddingLevelsResult, start?: number, end?: number): string;
    getReorderedIndices(text: string, embeddingLevels: EmbeddingLevelsResult, start?: number, end?: number): number[];
    getReorderSegments(text: string, embeddingLevels: EmbeddingLevelsResult, start?: number, end?: number): number[][];
  }

  export default function bidiFactory(): BidiEngine;
}
