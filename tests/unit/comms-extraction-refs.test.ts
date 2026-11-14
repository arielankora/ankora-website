import { describe, expect, it } from "vitest";
import { parseWhatsappRef, processedComms, whatsappRefId } from "@/lib/comms/extraction-refs";

describe("extraction refs for communications", () => {
  it("writes and reads a WhatsApp stretch", () => {
    const id = whatsappRefId("conv1", "2026-11-01", "2026-11-10");
    expect(parseWhatsappRef(id)).toEqual({ conversationId: "conv1", from: "2026-11-01", to: "2026-11-10" });
    expect(parseWhatsappRef("conv1:2026-11-10:2026-11-01")).toBeNull();
    expect(parseWhatsappRef("conv1:yesterday:today")).toBeNull();
    expect(parseWhatsappRef("just-an-id")).toBeNull();
  });

  it("keeps the last day read per conversation, and the calls read", () => {
    const p = processedComms([
      { system: "WHATSAPP", id: "a:2026-11-01:2026-11-05" },
      { system: "WHATSAPP", id: "a:2026-11-06:2026-11-12" },
      { system: "WHATSAPP", id: "b:2026-10-01:2026-10-02" },
      { system: "CALL", id: "call1" },
      { system: "FIREFLIES", id: "x" },
      { system: "WHATSAPP", id: "bad" },
    ]);
    expect([...p.whatsappReadThrough]).toEqual([
      ["a", "2026-11-12"],
      ["b", "2026-10-02"],
    ]);
    expect([...p.calls]).toEqual(["call1"]);
  });
});
