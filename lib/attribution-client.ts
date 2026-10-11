/// The browser half of lib/attribution.ts: remembers how this browser arrived
/// and which pages it saw, and hands that to the contact form.
///
/// One localStorage entry, first-party, no cookie, never sent anywhere except
/// with a contact request the person chose to send. If storage is blocked
/// (private mode, strict settings) every call quietly does nothing and the
/// form is sent without history: a lead is never lost to this.

import {
  type Attribution,
  type Touch,
  MAX_PAGES,
  SESSION_IDLE_MS,
  isNewArrival,
  parseGaClientId,
  parseGaSessionId,
  sanitizePath,
  touchFrom,
} from "@/lib/attribution";

const KEY = "ankora.attribution.v1";
const GA_MEASUREMENT_COOKIE = "_ga_XZ1T8Z0NDY";

interface Stored {
  firstTouch: Touch;
  visitNumber: number;
  session: { touch: Touch; lastActivityAt: string; pages: { p: string; t: string }[] };
}

function load(): Stored | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function save(s: Stored) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked. Nothing to do.
  }
}

// The referrer and the URL parameters describe how this document was
// reached. After the first client-side navigation they describe nothing new.
let documentArrivalRecorded = false;

/// Called on every page view of the marketing site, client navigations included.
export function recordPageView(now = new Date()) {
  try {
    const href = window.location.href;
    const arrival = documentArrivalRecorded ? null : touchFrom(href, document.referrer, now);
    documentArrivalRecorded = true;

    const page = { p: sanitizePath(href), t: now.toISOString() };
    const prev = load();

    if (!prev) {
      const touch = arrival ?? touchFrom(href, "", now);
      save({ firstTouch: touch, visitNumber: 1, session: { touch, lastActivityAt: page.t, pages: [page] } });
      return;
    }

    const idle = now.getTime() - Date.parse(prev.session.lastActivityAt) > SESSION_IDLE_MS;
    if (idle || (arrival && isNewArrival(arrival))) {
      const touch = arrival ?? touchFrom(href, "", now);
      save({ ...prev, visitNumber: prev.visitNumber + 1, session: { touch, lastActivityAt: page.t, pages: [page] } });
      return;
    }

    const pages = [...prev.session.pages, page].slice(-MAX_PAGES);
    save({ ...prev, session: { ...prev.session, lastActivityAt: page.t, pages } });
  } catch {
    // Attribution must never break a page.
  }
}

function cookie(name: string): string | undefined {
  try {
    const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
  } catch {
    return undefined;
  }
}

/// What the contact form sends along with the request.
export function readAttribution(): Attribution {
  const s = load();
  const out: Attribution = {
    gaClientId: parseGaClientId(cookie("_ga")) || undefined,
    gaSessionId: parseGaSessionId(cookie(GA_MEASUREMENT_COOKIE)) || undefined,
  };
  if (!s) return out;
  return {
    ...out,
    firstTouch: s.firstTouch,
    sessionTouch: s.session.touch,
    visitNumber: s.visitNumber,
    pages: s.session.pages,
  };
}
