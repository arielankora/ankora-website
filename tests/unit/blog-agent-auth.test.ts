import { describe, it, expect } from "vitest";
import {
  agentForToken,
  agentWriteRefusal,
  authorFor,
  hashAgentToken,
  parseAgentTokens,
  type BlogWriter,
} from "@/lib/blog-agent-auth";

const ARIEL = "ankb_ariel-test-token-0000000000000000000000000";
const HADAS = "ankb_hadas-test-token-0000000000000000000000000";
const ENV = `ariel:draft:${hashAgentToken(ARIEL)}, hadas:publish:${hashAgentToken(HADAS)}`;

describe("parseAgentTokens", () => {
  it("reads well-formed entries", () => {
    expect(parseAgentTokens(ENV).map((e) => [e.person, e.scope])).toEqual([
      ["ariel", "draft"],
      ["hadas", "publish"],
    ]);
  });

  it("drops entries that are malformed or name nobody, instead of half-trusting them", () => {
    const h = hashAgentToken(ARIEL);
    expect(parseAgentTokens(`ariel:admin:${h}`)).toEqual([]);
    expect(parseAgentTokens(`ariel:draft:not-a-hash`)).toEqual([]);
    expect(parseAgentTokens(`mallory:publish:${h}`)).toEqual([]);
    expect(parseAgentTokens(undefined)).toEqual([]);
    expect(parseAgentTokens("")).toEqual([]);
  });
});

describe("agentForToken", () => {
  it("names the token's owner and sets the author in both languages", () => {
    const writer = agentForToken(HADAS, ENV);
    expect(writer).toEqual({
      kind: "agent",
      person: "hadas",
      scope: "publish",
      author: { he: "הדס וינוגורה", en: "Hadas Vinogura" },
    });
  });

  it("refuses an unknown token, and every token when nothing is configured", () => {
    expect(agentForToken("ankb_someone-else-000000000000000000000000000", ENV)).toBeNull();
    expect(agentForToken(ARIEL, undefined)).toBeNull();
  });

  it("does not accept the stored hash as the token", () => {
    expect(agentForToken(hashAgentToken(ARIEL), ENV)).toBeNull();
  });
});

describe("agentWriteRefusal", () => {
  const admin: BlogWriter = { kind: "admin" };
  const drafter = agentForToken(ARIEL, ENV)!;
  const publisher = agentForToken(HADAS, ENV)!;

  it("never refuses the admin", () => {
    expect(agentWriteRefusal(admin, { requestedDraft: false, existingDraft: false })).toBeNull();
  });

  it("lets a draft token create and edit drafts", () => {
    expect(agentWriteRefusal(drafter, { requestedDraft: true })).toBeNull();
    expect(agentWriteRefusal(drafter, { requestedDraft: true, existingDraft: true })).toBeNull();
  });

  it("stops a draft token from publishing", () => {
    expect(agentWriteRefusal(drafter, { requestedDraft: false })).toMatch(/only save drafts/);
    expect(agentWriteRefusal(drafter, { requestedDraft: false, existingDraft: true })).toMatch(/only save drafts/);
  });

  it("stops a draft token from touching a live post, even to turn it back into a draft", () => {
    expect(agentWriteRefusal(drafter, { requestedDraft: true, existingDraft: false })).toMatch(/published post/);
  });

  it("lets a publish token publish", () => {
    expect(agentWriteRefusal(publisher, { requestedDraft: false })).toBeNull();
    expect(agentWriteRefusal(publisher, { requestedDraft: false, existingDraft: false })).toBeNull();
  });
});

describe("authorFor", () => {
  it("ignores the author an agent sends and uses the token's owner", () => {
    const drafter = agentForToken(ARIEL, ENV)!;
    expect(authorFor(drafter, "he", "Someone Else")).toBe("אריאל אוטניק");
    expect(authorFor(drafter, "en", "Someone Else")).toBe("Ariel Utnik");
  });

  it("keeps what the admin typed", () => {
    expect(authorFor({ kind: "admin" }, "he", "Ankora")).toBe("Ankora");
  });
});
