// The "חיפוש לקוח" box on the clients screen (ClientsGrid).
//
// Case-insensitive (3.11.2026): "g" and "G" both find "Grantor". Hebrew has
// no case, so it matches exactly as before. toLowerCase rather than
// toLocaleLowerCase on purpose: the result must not depend on the viewer's
// browser locale (in Turkish, "I" lowercases to a dotless i and "info"
// would stop finding "INFO").
export function clientNameMatches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return name.toLowerCase().includes(q);
}
