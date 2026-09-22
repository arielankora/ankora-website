import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 22.9.2026 regression. Anna's invite email arrived carrying
// https://ankora-website-l8j0t8tba-ankora-website.vercel.app/app/reset-password?token=...
// - the production deployment's own immutable URL. The project runs
// Vercel SSO protection in "all except custom domains" mode, so every
// *.vercel.app host answers with a Vercel login wall. The invite was
// valid, the token was valid, and the new employee still could not get
// in: she never reached Ankora at all.
//
// Nothing in the suite looked at the ORIGIN of an emailed link. The
// screens were tested, the tokens were tested, the email bodies were
// rendered - and the one part that decides whether a stranger can open
// the link was environment-dependent and unexamined. These tests hold
// that origin.

const ENV_KEYS = ["VERCEL_ENV", "VERCEL_URL", "NEXTAUTH_URL"] as const;
const SITE = "https://www.ankora.co.il";

async function baseUrl(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  vi.resetModules();
  const { appBaseUrl } = await import("@/lib/email-templates");
  return appBaseUrl();
}

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

describe("appBaseUrl", () => {
  describe("in production", () => {
    it("uses the canonical domain when nothing is configured", async () => {
      expect(await baseUrl({ VERCEL_ENV: "production" })).toBe(SITE);
    });

    // The actual bug: VERCEL_URL in production is the deployment's own
    // immutable hostname, not the domain people can reach.
    it("ignores VERCEL_URL rather than emailing the deployment URL", async () => {
      const url = await baseUrl({
        VERCEL_ENV: "production",
        VERCEL_URL: "ankora-website-l8j0t8tba-ankora-website.vercel.app",
      });
      expect(url).toBe(SITE);
    });

    // The same failure could return through an env edit, so the guard is
    // not just "prefer SITE_URL" - a protected host is refused outright.
    it("refuses a configured NEXTAUTH_URL that points at a protected host", async () => {
      const url = await baseUrl({
        VERCEL_ENV: "production",
        NEXTAUTH_URL: "https://ankora-website-git-main-ankora-website.vercel.app",
      });
      expect(url).toBe(SITE);
    });

    it("honours a configured NEXTAUTH_URL on a real domain", async () => {
      const url = await baseUrl({ VERCEL_ENV: "production", NEXTAUTH_URL: "https://app.ankora.co.il/" });
      expect(url).toBe("https://app.ankora.co.il");
    });
  });

  describe("outside production", () => {
    // The original intent of the VERCEL_URL branch, kept: a preview must
    // not email links that operate on production data.
    it("a preview links to itself, not to production", async () => {
      const url = await baseUrl({
        VERCEL_ENV: "preview",
        VERCEL_URL: "ankora-website-git-portal-phase2-ankora-website.vercel.app",
      });
      expect(url).toBe("https://ankora-website-git-portal-phase2-ankora-website.vercel.app");
    });

    it("local development honours NEXTAUTH_URL", async () => {
      expect(await baseUrl({ NEXTAUTH_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    });

    it("falls back to the canonical domain with no signal at all", async () => {
      expect(await baseUrl({})).toBe(SITE);
    });
  });
});

// The guard above is only worth anything if the two emails people
// actually receive are built from it. Both of these went out broken.
describe("every link that reaches a person's inbox", () => {
  it("is built from appBaseUrl, in both the invite and the sign-in link", async () => {
    const fs = await import("node:fs/promises");
    const sources = {
      "lib/app-domain/users.ts": "/app/reset-password?token=",
      "lib/app-auth/login-link.ts": "/app/login-link?token=",
    };

    for (const [file, path] of Object.entries(sources)) {
      const src = await fs.readFile(file, "utf-8");
      const line = src.split("\n").find((l) => l.includes(path));
      expect(line, `${file} no longer builds ${path}`).toBeDefined();
      expect(line, `${file} builds ${path} from something other than appBaseUrl()`).toContain("appBaseUrl()");
    }
  });
});
