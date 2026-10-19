import { describe, expect, it } from "vitest";
import { itemExtrasFrom } from "@/app/(product)/app/(authenticated)/clients/item-extras";

// Spec 3.1, 6.1: the item fields every form shares, read one way.
const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("itemExtrasFrom", () => {
  it("reads 'not to tell' only from a form that shows the field", () => {
    expect(itemExtrasFrom(form([["itemExtras", "1"], ["doNotDisclose", "עובדי הלקוח"]]))).not.toHaveProperty("doNotDisclose");
    expect(itemExtrasFrom(form([["itemExtras", "1"], ["itemDisclose", "1"], ["doNotDisclose", " עובדי הלקוח "]]))).toMatchObject({ doNotDisclose: "עובדי הלקוח" });
    expect(itemExtrasFrom(form([["itemExtras", "1"], ["itemDisclose", "1"], ["doNotDisclose", ""]]))).toMatchObject({ doNotDisclose: null });
  });
});

describe("audiencePeopleFrom", () => {
  it("names the people of a restricted item, with whoever saved it", async () => {
    const { audiencePeopleFrom } = await import("@/app/(product)/app/(authenticated)/clients/item-extras");
    expect(audiencePeopleFrom(form([["audience", "RESTRICTED"], ["audiencePeople", "1"], ["audienceUserIds", "u2"]]), "me").audienceUserIds?.sort()).toEqual(["me", "u2"]);
    expect(audiencePeopleFrom(form([["audience", "ACCOUNT_TEAM"], ["audiencePeople", "1"], ["audienceUserIds", "u2"]]), "me")).toEqual({ audienceUserIds: ["u2"] });
    expect(audiencePeopleFrom(form([["audience", "ALL_STAFF"], ["audienceUserIds", "u2"]]), "me")).toEqual({ audienceUserIds: [] });
    expect(audiencePeopleFrom(form([["audience", "RESTRICTED"]]), "me")).toEqual({});
  });
});
