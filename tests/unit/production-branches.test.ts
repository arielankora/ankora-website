import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile } from "node:fs/promises";

// 22.9.2026, the general case behind the invite incident.
//
// Eight places in product code behaved differently in production. The
// suite ran in exactly one environment, and it was not that one. So every
// test stood on the permissive half of every fork - the half that hands
// back a raw token, omits the Secure flag, and names whatever host it
// happens to be running on - and nothing anywhere asserted what the other
// half did. One of those halves was wrong for weeks and only a new
// employee locked out of her first day made it visible.
//
// The eight branches now live behind lib/env.ts. This file stands on both
// sides of it, and qa/checks/static.mjs refuses a ninth branch written
// anywhere else.

const ENV_KEYS = ["NODE_ENV", "VERCEL_ENV", "VERCEL_URL", "NEXTAUTH_URL", "RESEND_API_KEY"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

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

async function withEnv<T>(env: Partial<Record<EnvKey, string>>, use: () => Promise<T>): Promise<T> {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  vi.resetModules();
  return use();
}

const env = () => import("@/lib/env");

describe("the two questions are not the same question", () => {
  // Conflating them is half of what produced the incident: the code asked
  // "am I production?" when it meant "which address do I answer to?".
  it("a preview deployment is a production BUILD but not the production DEPLOYMENT", async () => {
    await withEnv({ NODE_ENV: "production", VERCEL_ENV: "preview" }, async () => {
      const { isProductionBuild, isProductionDeployment } = await env();
      expect(isProductionBuild(), "a preview must be as tight-lipped as production").toBe(true);
      expect(isProductionDeployment(), "a preview must not speak in production's name").toBe(false);
    });
  });

  it("the real thing is both", async () => {
    await withEnv({ NODE_ENV: "production", VERCEL_ENV: "production" }, async () => {
      const { isProductionBuild, isProductionDeployment } = await env();
      expect(isProductionBuild()).toBe(true);
      expect(isProductionDeployment()).toBe(true);
    });
  });

  it("a test run is neither, which is exactly why this file exists", async () => {
    await withEnv({ NODE_ENV: "test" }, async () => {
      const { isProductionBuild, isProductionDeployment } = await env();
      expect(isProductionBuild()).toBe(false);
      expect(isProductionDeployment()).toBe(false);
    });
  });
});

describe("devOnly", () => {
  // Governs three call sites that hand back credentials: the raw sign-in
  // token, the raw password-reset link, and nothing else may join them
  // without passing through here.
  it("withholds the value in a production build", async () => {
    await withEnv({ NODE_ENV: "production" }, async () => {
      const { devOnly } = await env();
      expect(devOnly("raw-token-material")).toBeUndefined();
    });
  });

  it("withholds it on a preview too, not just on production", async () => {
    await withEnv({ NODE_ENV: "production", VERCEL_ENV: "preview" }, async () => {
      const { devOnly } = await env();
      expect(devOnly("raw-token-material")).toBeUndefined();
    });
  });

  it("returns it locally, so a flow stays walkable end to end", async () => {
    await withEnv({ NODE_ENV: "development" }, async () => {
      const { devOnly } = await env();
      expect(devOnly("raw-token-material")).toBe("raw-token-material");
    });
  });

  it("treats a falsy value as a value, not as an absence", async () => {
    await withEnv({ NODE_ENV: "development" }, async () => {
      const { devOnly } = await env();
      expect(devOnly("")).toBe("");
      expect(devOnly(0)).toBe(0);
    });
  });
});

describe("isDevelopment", () => {
  it("is true only in development, and in particular not in test", async () => {
    await withEnv({ NODE_ENV: "development" }, async () => {
      expect((await env()).isDevelopment()).toBe(true);
    });
    await withEnv({ NODE_ENV: "test" }, async () => {
      expect((await env()).isDevelopment()).toBe(false);
    });
    await withEnv({ NODE_ENV: "production" }, async () => {
      expect((await env()).isDevelopment()).toBe(false);
    });
  });
});

describe("the host policy", () => {
  it("knows which hosts a recipient cannot open", async () => {
    const { isUnreachableFromOutside } = await import("@/lib/site");
    expect(isUnreachableFromOutside("ankora-website-l8j0t8tba-ankora-website.vercel.app")).toBe(true);
    expect(isUnreachableFromOutside("vercel.app")).toBe(true);
    expect(isUnreachableFromOutside("www.ankora.co.il")).toBe(false);
    // Not a substring match: a host that merely ends in these letters is
    // a different host, and refusing it would be its own outage.
    expect(isUnreachableFromOutside("notvercel.app")).toBe(false);
    expect(isUnreachableFromOutside("vercel.app.ankora.co.il")).toBe(false);
  });

  it("finds such links inside a rendered email body", async () => {
    const { unreachableLinksIn } = await import("@/lib/site");
    const html = `<a href="https://ankora-website-l8j0t8tba-ankora-website.vercel.app/app/reset-password?token=x">בחירת סיסמה</a>
      <a href="https://www.ankora.co.il/app/login">כניסה</a>`;
    expect(unreachableLinksIn(html)).toEqual([
      "https://ankora-website-l8j0t8tba-ankora-website.vercel.app/app/reset-password?token=x",
    ]);
  });

  it("says nothing about a body that is entirely fine", async () => {
    const { unreachableLinksIn } = await import("@/lib/site");
    expect(unreachableLinksIn("היכנסו ב-https://www.ankora.co.il/app/login ותודה")).toEqual([]);
  });
});

describe("the door: sendEmail", () => {
  // RESEND_API_KEY is set to a dummy so the guard is what decides, and
  // absent-key is used as the marker for "got past the guard" - neither
  // case reaches the network.
  const PROD = { NODE_ENV: "production", VERCEL_ENV: "production", RESEND_API_KEY: "test-key" };
  const body = {
    to: ["annam@ankora.co.il"],
    subject: "הזמנה למערכת Ankora",
    text: "בחירת סיסמה: https://ankora-website-l8j0t8tba-ankora-website.vercel.app/app/reset-password?token=x",
  };

  it("refuses to send a production email whose link the recipient cannot open", async () => {
    const result = await withEnv(PROD, async () => {
      const { sendEmail } = await import("@/lib/email");
      return sendEmail(body);
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot open");
    expect(result.error).toContain("vercel.app");
  });

  it("checks the HTML half as well as the plain-text half", async () => {
    const result = await withEnv(PROD, async () => {
      const { sendEmail } = await import("@/lib/email");
      return sendEmail({
        ...body,
        text: "כניסה לפורטל",
        html: `<a href="https://ankora-website-git-main-ankora-website.vercel.app/app/login-link?token=x">כניסה</a>`,
      });
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot open");
  });

  it("lets a production email with a canonical link through to the provider", async () => {
    // No API key, so the send stops at the provider step. Reaching that
    // message at all proves the guard did not fire.
    const result = await withEnv({ NODE_ENV: "production", VERCEL_ENV: "production" }, async () => {
      const { sendEmail } = await import("@/lib/email");
      return sendEmail({ ...body, text: "https://www.ankora.co.il/app/reset-password?token=x" });
    });
    expect(result.error).toBe("RESEND_API_KEY is not set");
  });

  it("leaves previews alone, where a vercel.app link is the correct link", async () => {
    const result = await withEnv({ NODE_ENV: "production", VERCEL_ENV: "preview" }, async () => {
      const { sendEmail } = await import("@/lib/email");
      return sendEmail(body);
    });
    expect(result.error).toBe("RESEND_API_KEY is not set");
  });
});

// The guard above is worth nothing if a call site stops asking through
// it. These pin the shape rather than the behaviour, which is the only
// thing a unit test can do about a branch that lives in someone else's
// file.
describe("every production-dependent branch goes through lib/env.ts", () => {
  const CALL_SITES: Record<string, string[]> = {
    "lib/email-templates.ts": ["isProductionDeployment()"],
    "lib/email.ts": ["isProductionDeployment()"],
    "lib/app-auth/login-link.ts": ["devOnly("],
    "app/(product)/app/forgot-password/actions.ts": ["devOnly("],
    "app/(product)/app/(authenticated)/portal/actions.ts": ["secure: isProductionBuild()"],
    "app/api/mcp/route.ts": ["isProductionBuild()"],
    "lib/prisma.ts": ["isDevelopment()", "isProductionBuild()"],
  };

  for (const [file, expected] of Object.entries(CALL_SITES)) {
    it(`${file} asks lib/env.ts`, async () => {
      const src = await readFile(file, "utf-8");
      expect(src, `${file} no longer imports from lib/env`).toContain('from "@/lib/env"');
      for (const needle of expected) {
        expect(src, `${file} stopped using ${needle}`).toContain(needle);
      }
      expect(src, `${file} reads NODE_ENV/VERCEL_ENV directly again`).not.toMatch(
        /process\.env\.(NODE_ENV|VERCEL_ENV)/
      );
    });
  }

  it("both cookie sites in the portal carry the Secure flag, not just the first", async () => {
    const src = await readFile("app/(product)/app/(authenticated)/portal/actions.ts", "utf-8");
    expect(src.match(/secure: isProductionBuild\(\)/g)?.length).toBe(2);
  });
});
