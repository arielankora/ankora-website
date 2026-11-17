import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";
import { parseOtlpLogs } from "@/lib/claude-usage/otlp";
import { ingestCoworkEvents } from "@/lib/claude-usage/cowork-ingest";
import { COWORK_EVENTS_RETENTION_DAYS, pruneClaudeUsage } from "@/lib/claude-usage/record";
import { coworkExport, SECRET_PROMPT } from "../unit/claude-usage/otlp-fixture";

// Claude usage measurement, stage 2 (17.11.2026): Cowork events reach
// cowork_events matched to the Ankora user by email, land once when the
// exporter sends them twice, keep no content, and leave after 180 days.

describe("Cowork events", () => {
  it("are stored once, matched to the user by email whatever its case, with no content", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "hadas@ankora.co.il" });
    const { rows } = parseOtlpLogs(coworkExport());

    expect(await ingestCoworkEvents(rows)).toEqual({ stored: 4, duplicates: 0 });
    // The exporter retries the same batch.
    expect(await ingestCoworkEvents(rows)).toEqual({ stored: 0, duplicates: 4 });

    const stored = await prisma.coworkEvent.findMany({ orderBy: { eventName: "asc" } });
    expect(stored).toHaveLength(4);
    expect(stored.every((r) => r.userId === user.id)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(SECRET_PROMPT);
    const api = stored.find((r) => r.eventName === "api_request")!;
    expect(api.costUsd?.toString()).toBe("0.0421");
    expect(api.cacheReadTokens).toBe(50000);
  });

  it("keep the email and no user when nobody in Ankora has that address", async () => {
    const { rows } = parseOtlpLogs(coworkExport());
    await ingestCoworkEvents(rows);
    const row = await prisma.coworkEvent.findFirstOrThrow();
    expect(row.userId).toBeNull();
    expect(row.userEmail).toBe("hadas@ankora.co.il");
  });

  it("leave after their retention, and not before", async () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const old = new Date(now.getTime() - (COWORK_EVENTS_RETENTION_DAYS + 1) * 86_400_000);
    const recent = new Date(now.getTime() - (COWORK_EVENTS_RETENTION_DAYS - 1) * 86_400_000);
    await prisma.coworkEvent.createMany({
      data: [
        { dedupeKey: "old", eventName: "api_request", occurredAt: old },
        { dedupeKey: "recent", eventName: "api_request", occurredAt: recent },
      ],
    });
    expect(await pruneClaudeUsage(now)).toEqual({ toolCalls: 0, promptCopies: 0, coworkEvents: 1 });
    expect((await prisma.coworkEvent.findMany()).map((r) => r.dedupeKey)).toEqual(["recent"]);
  });
});
