// Minimal ambient declaration for the `lunar-javascript` package (Phase 10:
// Important Dates holiday catalog - Chinese Lunar New Year computation).
// The package ships no types of its own. Deliberately scoped to only the
// surface actually used by lib/app-domain/important-dates-holidays.ts
// (Lunar.fromYmd(...).getSolar()), not a full re-declaration of the
// library's much larger real API - narrower and easier to keep correct.
declare module "lunar-javascript" {
  export class Solar {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
  }

  export class Lunar {
    static fromYmd(lunarYear: number, lunarMonth: number, lunarDay: number): Lunar;
    getSolar(): Solar;
  }
}
