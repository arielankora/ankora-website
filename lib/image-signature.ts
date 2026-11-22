/// A blog image's real type, read from its own first bytes (security
/// review 2026-11). The declared contentType alone let an authenticated
/// writer commit an SVG or any other file as ".png" into public/blog,
/// where it becomes a permitted local source for /_next/image
/// (GHSA-7qx7-33qx-rqx2: such a file can reach the SVG decoder even with
/// dangerouslyAllowSVG off). Anything that is not JPEG, PNG or WebP by its
/// bytes is refused, whatever it claims to be.
export type BlogImageType = "image/jpeg" | "image/png" | "image/webp";

export function detectImageType(bytes: Uint8Array): BlogImageType | null {
  const starts = (sig: number[], at = 0) => bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}
