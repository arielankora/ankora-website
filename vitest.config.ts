import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/__mocks__/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
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
  },
});
