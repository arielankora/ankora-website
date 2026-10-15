import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// Employee agreements: the registry, and the small pure decisions the
// screens and the domain layer rest on. Prisma is mocked only so the
// module can load; nothing here touches a database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const {
  AGREEMENT_FILES,
  CURRENT_AGREEMENTS,
  SIGN_LINK_TTL_MS,
  agreementBody,
  agreementCode,
  agreementFileName,
  findAgreementByVersionOrCode,
  kindFromParam,
  agreementPath,
  contentHash,
  currentAgreement,
  findAgreement,
  hashSignToken,
  loadAgreementText,
  mustSignConfidentiality,
  namesMatch,
  newSignToken,
  signLinkState,
  unescapeMarkdown,
} = await import("@/lib/agreements");

describe("agreement registry", () => {
  it("has a file for every registered version", () => {
    for (const a of AGREEMENT_FILES) {
      expect(existsSync(agreementPath(a)), a.file).toBe(true);
    }
  });

  it("never registers the same kind and version twice, or one file twice", () => {
    const keys = AGREEMENT_FILES.map((a) => `${a.kind}:${a.version}`);
    expect(new Set(keys).size).toBe(keys.length);
    const files = AGREEMENT_FILES.map((a) => a.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it("points every current version at a registered file", () => {
    for (const [kind, version] of Object.entries(CURRENT_AGREEMENTS)) {
      expect(findAgreement(kind as never, version), `${kind} ${version}`).not.toBeNull();
      expect(currentAgreement(kind as never).version).toBe(version);
    }
  });

  // The version a person signs under is printed inside the text itself.
  // If the file and the registry disagree, the PDF and the row would name
  // a different version from the words on the page.
  it("prints the registered version inside each text", () => {
    for (const a of AGREEMENT_FILES) {
      expect(loadAgreementText(a)).toContain(`**גרסה:** ${a.version}`);
    }
  });

  it("hashes a text the same way every time, as sha256 hex", () => {
    const a = currentAgreement("CONFIDENTIALITY");
    const first = contentHash(loadAgreementText(a));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(loadAgreementText(a))).toBe(first);
    expect(contentHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  // A published version is never edited: signatures carry its hash, and
  // an edited file would leave every one of them pointing at words nobody
  // saw. A change of wording is a new file and a new version. If this
  // fails, revert the file and add a new version instead; add a line here
  // for the new file.
  it("never changes the text of a published version", () => {
    const PUBLISHED: Record<string, string> = {
      "confidentiality-1.0.he.md": "3b7a5aa11779d8898c28f2cfc94862f1ec0667214a4ae91e11ef0a5b859c86c2",
      "deletion-declaration-1.0.he.md": "66b5a10d0daad3abc9e99413a4c5a8e10676c54e91a73ca644cc65f28b655348",
    };
    for (const a of AGREEMENT_FILES) {
      expect(PUBLISHED[a.file], `${a.file} has no pinned hash`).toBeDefined();
      expect(contentHash(loadAgreementText(a)), a.file).toBe(PUBLISHED[a.file]);
    }
  });

  it("keeps no internal notes or byline in the deletion declaration", () => {
    const text = loadAgreementText(currentAgreement("DELETION_DECLARATION"));
    expect(text).not.toContain("הערות פנימיות");
    expect(text).not.toMatch(/^Oct \d+, \d{4}/m);
  });

  it("contains no em or en dash in any text", () => {
    for (const a of AGREEMENT_FILES) {
      const text = readFileSync(agreementPath(a), "utf8");
      expect(text.includes(String.fromCharCode(0x2014)) || text.includes(String.fromCharCode(0x2013)), a.file).toBe(false);
    }
  });
});

describe("agreementBody", () => {
  const sample = [
    "# Title",
    "",
    "**על ידי:** שם מלא \\_\\_\\_",
    "",
    "## 1. מבוא",
    "",
    "1.1. טקסט.",
    "",
    "**חתימות**",
    "",
    "| a | b |",
    "| --- | --- |",
    "",
    "## 4. חתימה",
    "",
    "| שם | |",
  ].join("\n");

  it("starts at the first section and drops paper-only fill-ins and tables", () => {
    const body = agreementBody(sample);
    expect(body.startsWith("## 1. מבוא")).toBe(true);
    expect(body).not.toContain("על ידי");
    expect(body).not.toContain("|");
    expect(body).not.toContain("חתימות");
    expect(body).not.toContain("## 4. חתימה");
    expect(body).toContain("1.1. טקסט.");
  });

  it("unescapes markdown escapes for reading", () => {
    expect(unescapeMarkdown("\\_\\_ a \\* b")).toBe("__ a * b");
  });

  it("keeps every numbered section of the real texts", () => {
    const body = agreementBody(loadAgreementText(currentAgreement("CONFIDENTIALITY")));
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(body).toContain(`## ${n}.`);
  });
});

describe("namesMatch", () => {
  it("ignores surrounding space, repeated inner space and letter case", () => {
    expect(namesMatch("  דנה   כהן ", "דנה כהן")).toBe(true);
    expect(namesMatch("dana COHEN", "Dana Cohen")).toBe(true);
  });

  it("refuses a different name, a partial name and an empty one", () => {
    expect(namesMatch("דנה לוי", "דנה כהן")).toBe(false);
    expect(namesMatch("דנה", "דנה כהן")).toBe(false);
    expect(namesMatch("   ", "")).toBe(false);
  });
});

describe("mustSignConfidentiality (the app gate)", () => {
  const current = { kind: "CONFIDENTIALITY" as const, version: CURRENT_AGREEMENTS.CONFIDENTIALITY, channel: "APP" as const };

  it("never gates a client portal user", () => {
    expect(mustSignConfidentiality("CLIENT_USER", [])).toBe(false);
  });

  it("gates every staff role without a current in-app signature", () => {
    for (const role of ["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE"] as const) {
      expect(mustSignConfidentiality(role, [])).toBe(true);
      expect(mustSignConfidentiality(role, [current])).toBe(false);
    }
  });

  it("does not accept an old version, a PDF signature or another document", () => {
    expect(mustSignConfidentiality("ANKORA_EMPLOYEE", [{ ...current, version: "סודיות-0.9" }])).toBe(true);
    expect(mustSignConfidentiality("ANKORA_EMPLOYEE", [{ ...current, channel: "EMAIL_PDF" }])).toBe(true);
    expect(
      mustSignConfidentiality("ANKORA_EMPLOYEE", [
        { kind: "DELETION_DECLARATION", version: CURRENT_AGREEMENTS.DELETION_DECLARATION, channel: "APP" },
      ])
    ).toBe(true);
  });
});

describe("one-time sign links", () => {
  it("stores only a sha256 of the token, never the token", () => {
    const { raw, tokenHash } = newSignToken();
    expect(raw.length).toBeGreaterThanOrEqual(43);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(raw);
    expect(hashSignToken(raw)).toBe(tokenHash);
    expect(newSignToken().raw).not.toBe(raw);
  });

  it("lives seven days", () => {
    expect(SIGN_LINK_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("is valid only while unused and unexpired", () => {
    const now = new Date("2026-10-15T10:00:00Z");
    const later = new Date(now.getTime() + 1000);
    const earlier = new Date(now.getTime() - 1000);
    expect(signLinkState(null, now)).toBe("missing");
    expect(signLinkState({ usedAt: null, expiresAt: later }, now)).toBe("valid");
    expect(signLinkState({ usedAt: earlier, expiresAt: later }, now)).toBe("used");
    expect(signLinkState({ usedAt: null, expiresAt: earlier }, now)).toBe("expired");
    expect(signLinkState({ usedAt: null, expiresAt: now }, now)).toBe("expired");
  });
});

describe("agreementFileName", () => {
  it("names the file by kind, version, name and Israel date", () => {
    // 22:30 UTC is already the next day in Israel.
    expect(agreementFileName("CONFIDENTIALITY", "סודיות-1.0", "דנה כהן", new Date("2026-10-15T22:30:00Z"))).toBe(
      "CONFIDENTIALITY-סודיות-1.0-דנה כהן-2026-10-16.pdf"
    );
  });

  it("keeps a slash in a name from becoming a path", () => {
    expect(agreementFileName("DELETION_DECLARATION", "מחיקה-1.0", "a/b", new Date("2026-10-15T08:00:00Z"))).toBe(
      "DELETION_DECLARATION-מחיקה-1.0-a_b-2026-10-15.pdf"
    );
  });
});

describe("Latin version codes", () => {
  it("derives ANKORA-CONF-1.0 and ANKORA-DEL-1.0 from kind and version", () => {
    expect(agreementCode("CONFIDENTIALITY", "סודיות-1.0")).toBe("ANKORA-CONF-1.0");
    expect(agreementCode("DELETION_DECLARATION", "מחיקה-1.0")).toBe("ANKORA-DEL-1.0");
    expect(agreementCode("CONFIDENTIALITY", "סודיות-2.1")).toBe("ANKORA-CONF-2.1");
  });

  it("gives every registered version a distinct, Latin-only code", () => {
    const codes = AGREEMENT_FILES.map((a) => agreementCode(a.kind, a.version));
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^ANKORA-[A-Z]+-\d+\.\d+$/);
  });

  it("finds a version by its Hebrew string or its code, but not across kinds", () => {
    expect(findAgreementByVersionOrCode("CONFIDENTIALITY", "סודיות-1.0")?.file).toBe("confidentiality-1.0.he.md");
    expect(findAgreementByVersionOrCode("CONFIDENTIALITY", " ankora-conf-1.0 ")?.file).toBe("confidentiality-1.0.he.md");
    expect(findAgreementByVersionOrCode("DELETION_DECLARATION", "ANKORA-CONF-1.0")).toBeNull();
    expect(findAgreementByVersionOrCode("CONFIDENTIALITY", "ANKORA-CONF-9.9")).toBeNull();
  });

  it("reads a kind from a URL segment", () => {
    expect(kindFromParam("confidentiality")).toBe("CONFIDENTIALITY");
    expect(kindFromParam("DELETION_DECLARATION")).toBe("DELETION_DECLARATION");
    expect(kindFromParam("del")).toBe("DELETION_DECLARATION");
    expect(kindFromParam("nda")).toBeNull();
  });
});
