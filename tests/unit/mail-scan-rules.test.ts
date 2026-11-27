import { describe, expect, it } from "vitest";
import {
  blockStateOf,
  decideEmail,
  isTeamAddress,
  matchClients,
  parseBlockTarget,
  participantsOf,
  suggestMailboxKind,
  threadBlockState,
  topSenders,
  type BlockLike,
  type ClientLookup,
  type Team,
} from "@/lib/mail-scan/rules";

// "התיבות שלי" (27.11.2026): what is recorded of an email is decided by
// these rules alone, so they are held here without a database.

const team: Team = { domains: ["ankora.co.il"], emails: new Set(["anna.private@gmail.com"]) };
const lookup: ClientLookup = {
  byDomain: new Map([
    ["grantor.co.il", ["c_grantor"]],
    ["nextage.co.il", ["c_nux", "c_rimed"]],
  ]),
  byAddress: new Map([["dana.levi@gmail.com", ["c_levi"]]]),
};
const none: BlockLike[] = [];

describe("mail-scan: parsing a \"do not read\" entry", () => {
  it("takes an address or a domain in the forms people type", () => {
    expect(parseBlockTarget(" Mom@Gmail.com ")).toEqual({ kind: "ADDRESS", value: "mom@gmail.com" });
    expect(parseBlockTarget("bank-hapoalim.co.il")).toEqual({ kind: "DOMAIN", value: "bank-hapoalim.co.il" });
    expect(parseBlockTarget("@Bank.co.il")).toEqual({ kind: "DOMAIN", value: "bank.co.il" });
    expect(parseBlockTarget("https://www.bank.co.il/login")).toEqual({ kind: "DOMAIN", value: "bank.co.il" });
  });

  it("refuses what is neither", () => {
    expect(parseBlockTarget("")).toBeNull();
    expect(parseBlockTarget("my bank")).toBeNull();
    expect(parseBlockTarget("localhost")).toBeNull();
  });
});

describe("mail-scan: what a block covers", () => {
  const blocks: BlockLike[] = [
    { kind: "DOMAIN", value: "bank.co.il", status: "APPROVED" },
    { kind: "ADDRESS", value: "mom@gmail.com", status: "PENDING" },
    { kind: "ADDRESS", value: "old@x.com", status: "REVOKED" },
    { kind: "ADDRESS", value: "no@x.com", status: "REJECTED" },
  ];

  it("an approved block blocks, a pending one holds, the others say nothing", () => {
    expect(blockStateOf(blocks, "service@bank.co.il")).toBe("blocked");
    expect(blockStateOf(blocks, "alerts@mail.bank.co.il")).toBe("blocked");
    expect(blockStateOf(blocks, "MOM@gmail.com")).toBe("held");
    expect(blockStateOf(blocks, "old@x.com")).toBe("none");
    expect(blockStateOf(blocks, "no@x.com")).toBe("none");
    expect(blockStateOf(blocks, "someone@notbank.co.il")).toBe("none");
  });

  it("a thread is blocked if anyone in it is, held if anyone is held", () => {
    expect(threadBlockState(blocks, ["a@grantor.co.il", "service@bank.co.il", "mom@gmail.com"])).toBe("blocked");
    expect(threadBlockState(blocks, ["a@grantor.co.il", "mom@gmail.com"])).toBe("held");
    expect(threadBlockState(blocks, ["a@grantor.co.il"])).toBe("none");
  });
});

describe("mail-scan: the team", () => {
  it("is the team's domain and the staff's own addresses", () => {
    expect(isTeamAddress("hadas@ankora.co.il", team)).toBe(true);
    expect(isTeamAddress("anna.private@gmail.com", team)).toBe(true);
    expect(isTeamAddress("nadav@grantor.co.il", team)).toBe(false);
    expect(isTeamAddress("not an address", team)).toBe(false);
  });
});

describe("mail-scan: reading an email's participants", () => {
  it("collects from, to, cc, bcc and reply-to once each, lower case", () => {
    const email = {
      from: [{ email: "Nadav@Grantor.co.il" }],
      to: [{ email: "anna@ankora.co.il" }, { email: "nadav@grantor.co.il" }],
      cc: [{ email: "office@grantor.co.il" }],
      bcc: [{ display_name: "no address" }],
      reply_to: [{ email: "billing@grantor.co.il" }],
    };
    expect(participantsOf(email)).toEqual(["nadav@grantor.co.il", "anna@ankora.co.il", "office@grantor.co.il", "billing@grantor.co.il"]);
    expect(participantsOf({})).toEqual([]);
  });
});

describe("mail-scan: which clients an email is with", () => {
  it("matches by the client's domain, and a partner domain gives every client that has it", () => {
    expect(matchClients(["nadav@grantor.co.il"], team, lookup)).toEqual(["c_grantor"]);
    expect(matchClients(["einat@nextage.co.il"], team, lookup)).toEqual(["c_nux", "c_rimed"]);
    expect(matchClients(["x@sub.grantor.co.il"], team, lookup)).toEqual(["c_grantor"]);
  });

  it("a public mail address counts only when a client's file has that exact address", () => {
    expect(matchClients(["dana.levi@gmail.com"], team, lookup)).toEqual(["c_levi"]);
    expect(matchClients(["stranger@gmail.com"], team, lookup)).toEqual([]);
  });

  it("the team never decides", () => {
    expect(matchClients(["hadas@ankora.co.il", "anna.private@gmail.com"], team, lookup)).toEqual([]);
  });
});

describe("mail-scan: what is recorded of an email", () => {
  const ankoraBox = { address: "anna@ankora.co.il", clientId: null };

  it("records a thread with a client, with the clients it is with", () => {
    expect(decideEmail({ participants: ["nadav@grantor.co.il", "anna@ankora.co.il"], mailbox: ankoraBox, blocks: none, team, lookup })).toEqual({
      record: true,
      clientIds: ["c_grantor"],
      held: false,
    });
  });

  it("leaves out the team writing to itself, and anyone who is no client's", () => {
    expect(decideEmail({ participants: ["hadas@ankora.co.il", "anna@ankora.co.il"], mailbox: ankoraBox, blocks: none, team, lookup })).toEqual({
      record: false,
      reason: "team",
    });
    expect(decideEmail({ participants: ["shop@store.com", "anna@ankora.co.il"], mailbox: ankoraBox, blocks: none, team, lookup })).toEqual({
      record: false,
      reason: "no-client",
    });
  });

  it("a blocked participant drops the email; a held one records it held", () => {
    const blocks: BlockLike[] = [
      { kind: "DOMAIN", value: "grantor.co.il", status: "APPROVED" },
      { kind: "ADDRESS", value: "dana.levi@gmail.com", status: "PENDING" },
    ];
    expect(decideEmail({ participants: ["nadav@grantor.co.il"], mailbox: ankoraBox, blocks, team, lookup })).toEqual({ record: false, reason: "blocked" });
    expect(decideEmail({ participants: ["dana.levi@gmail.com"], mailbox: ankoraBox, blocks, team, lookup })).toEqual({
      record: true,
      clientIds: ["c_levi"],
      held: true,
    });
  });

  it("every email in a client's mailbox is that client's, even one only the team wrote", () => {
    const box = { address: "office@grantor.co.il", clientId: "c_grantor" };
    expect(decideEmail({ participants: ["anna@ankora.co.il", "office@grantor.co.il"], mailbox: box, blocks: none, team, lookup })).toEqual({
      record: true,
      clientIds: ["c_grantor"],
      held: false,
    });
    expect(decideEmail({ participants: ["shop@store.com"], mailbox: box, blocks: [{ kind: "ADDRESS", value: "shop@store.com", status: "APPROVED" }], team, lookup })).toEqual({
      record: false,
      reason: "blocked",
    });
  });

  it("the mailbox's own address is never what blocks it", () => {
    const box = { address: "office@grantor.co.il", clientId: "c_grantor" };
    const blocks: BlockLike[] = [{ kind: "DOMAIN", value: "grantor.co.il", status: "APPROVED" }];
    expect(decideEmail({ participants: ["office@grantor.co.il", "anna@ankora.co.il"], mailbox: box, blocks, team, lookup }).record).toBe(true);
  });
});

describe("mail-scan: whose mailbox, suggested", () => {
  it("a mailbox on the team's domain is Ankora's; another is offered to the clients with its domain", () => {
    expect(suggestMailboxKind("anna@ankora.co.il", team, lookup.byDomain)).toEqual({ kind: "ANKORA" });
    expect(suggestMailboxKind("office@grantor.co.il", team, lookup.byDomain)).toEqual({ kind: "CLIENT", clientIds: ["c_grantor"] });
    expect(suggestMailboxKind("someone@gmail.com", team, lookup.byDomain)).toEqual({ kind: "CLIENT", clientIds: [] });
  });
});

describe("mail-scan: the senders offered for \"do not read\"", () => {
  it("counts outside senders, most frequent first, without the team or the mailbox", () => {
    const emails = [
      { from: "nadav@grantor.co.il", name: "Nadav" },
      { from: "service@bank.co.il", name: "Bank" },
      { from: "nadav@grantor.co.il", name: null },
      { from: "hadas@ankora.co.il", name: "Hadas" },
      { from: "anna@ankora.co.il", name: "Anna" },
      { from: null, name: null },
    ];
    expect(topSenders(emails, { address: "anna@ankora.co.il", team })).toEqual([
      { address: "nadav@grantor.co.il", name: "Nadav", count: 2 },
      { address: "service@bank.co.il", name: "Bank", count: 1 },
    ]);
    expect(topSenders(emails, { address: "anna@ankora.co.il", team }, 1)).toHaveLength(1);
  });
});
