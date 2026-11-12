/// The folded "everyone else" slot of the home page's hours chart. Its own
/// file because the chart is a client component and lib/app-domain/
/// overview-trend.ts is server-only; the chart names the slot in the
/// reader's language (ADR 0006).
export const OTHER_KEY = "__other__";
