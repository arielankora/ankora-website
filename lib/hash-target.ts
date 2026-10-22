// The element a URL's hash points at, as an id. Pure, for HashScroll.
// The hash is input from the address bar: only a plain id is accepted,
// bounded, so nothing else reaches getElementById.

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,119}$/;

export function hashTargetId(hash: string | null | undefined): string | null {
  if (!hash) return null;
  let raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return ID.test(raw) ? raw : null;
}
