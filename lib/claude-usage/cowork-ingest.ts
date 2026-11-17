import "server-only";
import { prisma } from "@/lib/prisma";
import type { CoworkEventRow } from "@/lib/claude-usage/otlp";

// Claude usage measurement, stage 2 (17.11.2026): writes the rows that
// lib/claude-usage/otlp.ts read from Cowork's telemetry. Each event is
// matched to an Ankora user by email when it arrives; an address with no
// user (a guest, a typo in the workspace) keeps its email and no user.

export async function ingestCoworkEvents(rows: CoworkEventRow[]): Promise<{ stored: number; duplicates: number }> {
  if (rows.length === 0) return { stored: 0, duplicates: 0 };

  const emails = [...new Set(rows.map((r) => r.userEmail).filter((e): e is string => !!e))];
  const users = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails, mode: "insensitive" } }, select: { id: true, email: true } })
    : [];
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

  const { count } = await prisma.coworkEvent.createMany({
    data: rows.map((r) => ({ ...r, userId: r.userEmail ? (byEmail.get(r.userEmail) ?? null) : null })),
    // The exporter retries a batch it thinks failed; dedupeKey is unique.
    skipDuplicates: true,
  });
  return { stored: count, duplicates: rows.length - count };
}
