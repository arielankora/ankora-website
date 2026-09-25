import { describe, expect, it } from "vitest";
import { MESSAGE_KINDS, buildMessage, whatsappDigits } from "@/lib/app-domain/client-messages";

// A person sends. The system never does.
//
// What is worth testing here is not the wording, which is a judgement
// and would just be the file typed twice. It is the three things that
// would put a wrong message in front of a client:
//
//   - a draft that is empty, or signed by nobody,
//   - a draft that pretends to know something it cannot,
//   - and a WhatsApp link built from a number that does not exist,
//     which is worse than no button because it looks like it worked.

const ctx = {
  clientName: "אורביט",
  fromName: "הדס",
  subject: "החלפת ספק ניקיון",
  portalUrl: "https://www.ankora.co.il/app/portal/decisions",
};

describe("every draft is a message somebody could send", () => {
  it("has a label, a subject and a body, and is signed", () => {
    for (const kind of MESSAGE_KINDS) {
      const draft = buildMessage(kind, ctx);
      expect(draft.label.trim(), kind).not.toBe("");
      expect(draft.emailSubject.trim(), kind).not.toBe("");
      expect(draft.body.length, kind).toBeGreaterThan(40);
      // Signed by the person, not by the company. A message from
      // "אנקורה" is a message from a system again.
      expect(draft.body.trimEnd().endsWith("הדס"), kind).toBe(true);
    }
  });

  it("says what it is about, when it was told", () => {
    for (const kind of MESSAGE_KINDS) {
      const draft = buildMessage(kind, ctx);
      // "decision_waiting" is the one that can stand without it, because
      // the portal shows the question itself. Everything else refers to
      // a piece of work and has to name it.
      if (kind !== "decision_waiting") {
        expect(draft.body, kind).toContain("החלפת ספק ניקיון");
      }
    }
  });

  it("still reads as a sentence with nothing to go on", () => {
    // A task with no client-facing title, no outcome and no portal link.
    // The draft has to survive that without leaving "undefined" or a
    // double space where a name should be.
    for (const kind of MESSAGE_KINDS) {
      const draft = buildMessage(kind, { clientName: "אורביט", fromName: "הדס" });
      expect(draft.body, kind).not.toContain("undefined");
      expect(draft.body, kind).not.toContain("null");
      expect(draft.body, kind).not.toMatch(/ {2}/);
    }
  });

  it("uses the outcome sentence when there is one, and asks for it when there is not", () => {
    // The product already refuses to close a client-visible promise
    // without a sentence in the client's language. Re-asking the person
    // to write it a second time is how a good rule turns into busywork.
    const withOutcome = buildMessage("promise_done", { ...ctx, outcome: "הספק הוחלף, החוזה נחתם." });
    expect(withOutcome.body).toContain("הספק הוחלף, החוזה נחתם.");
    expect(withOutcome.body).not.toContain("[מה בדיוק נעשה]");

    const without = buildMessage("promise_done", ctx);
    expect(without.body).toContain("[מה בדיוק נעשה]");
  });

  it("marks what it cannot know, instead of guessing", () => {
    // A draft that invents the reason for a delay is a draft that gets
    // sent with the invention in it.
    expect(buildMessage("delay", ctx).body).toContain("[");
    expect(buildMessage("need_information", ctx).body).toContain("[מה חסר]");
  });
});

describe("the channel the client asked for is read by a person, not parsed", () => {
  it("has no parser to get it wrong", async () => {
    // The first version of this module exported `preferredChannel`,
    // which read the client's free-text preference and returned a
    // channel. This test killed it on its first run: the sentence
    // "וואטסאפ בלבד, לא מיילים" contains the word מייל, so it answered
    // email - on the one sentence that says the opposite as clearly as
    // a person can say it.
    //
    // The composer shows the client's own words to whoever is about to
    // write to them instead. This asserts the parser stayed dead,
    // because the tempting fix is to add it back with one more keyword.
    const mod = await import("@/lib/app-domain/client-messages");
    expect(Object.keys(mod)).not.toContain("preferredChannel");
  });
});

describe("a WhatsApp link that opens the right conversation, or none", () => {
  it("normalises the shapes people actually type", () => {
    expect(whatsappDigits("050-1234567")).toBe("972501234567");
    expect(whatsappDigits("+972 50 123 4567")).toBe("972501234567");
    expect(whatsappDigits("00972501234567")).toBe("972501234567");
    expect(whatsappDigits("972-50-1234567")).toBe("972501234567");
  });

  it("refuses a number that is not one", () => {
    // No button at all beats a button that opens a conversation with
    // somebody else.
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappDigits("")).toBeNull();
    expect(whatsappDigits("050-123")).toBeNull();
    expect(whatsappDigits("לשאול את מיכל")).toBeNull();
  });
});
