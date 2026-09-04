// Vitest runs outside Next.js's build pipeline, which is the only place
// that treats the real "server-only" package specially (it no-ops it for
// genuine Server Components and throws for anything reachable from a
// Client Component bundle). Under Vitest that distinction doesn't apply,
// so this stub keeps `import "server-only"` a harmless no-op for tests.
export {};
