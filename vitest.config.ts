import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // JSX through esbuild rather than @vitejs/plugin-react.
  //
  // The plugin is a dependency here and would do this too, but its type
  // declarations use syntax newer than this repo's TypeScript, and
  // importing it into this file puts those declarations in front of
  // `tsc --noEmit` - which then fails on a file that has nothing to do
  // with the product. Component tests need a JSX transform, not fast
  // refresh, and the bundler's own transform already does that.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/__mocks__/server-only.ts"),
      // ADR 0006: server actions and route handlers tested outside a Next
      // request get the dictionary directly; see the file for why.
      "next-intl/server": path.resolve(__dirname, "tests/__mocks__/next-intl-server.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Integration tests share ONE database and tests/integration/setup.ts
    // truncates every table in beforeEach. With vitest's default file-level
    // parallelism, several files run at once against that database and each
    // one's truncate deletes the rows another file just seeded - which
    // surfaces as a scatter of foreign-key errors, empty result sets and
    // "expected 0 to be 1", all of them looking like product bugs and none
    // of them real. It went unnoticed because the suite was never actually
    // executed in CI (preflight's database probe reported it unreachable).
    //
    // Set globally rather than only for tests/integration: it costs the unit
    // suite nothing measurable (13.2s vs 14.0s over 40 files, inside the
    // noise), and a per-directory setting would not protect someone running
    // `npx vitest run tests/integration` by hand.
    fileParallelism: false,
    // tests/integration/setup.ts truncates every table before each test. On
    // a loaded CI runner that took more than the default 10 seconds once
    // (scheduled run 714, 3.11.2026: "Hook timed out in 10000ms" in
    // client-contacts, with "lock not available" all over the database
    // log), and a test that never ran failed the whole night. 30 seconds is
    // room for a slow runner; a reset that needs longer is a real problem.
    hookTimeout: 30_000,
  },
});
