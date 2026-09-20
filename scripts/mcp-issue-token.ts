// Phase 13 (MCP server, docs/adr/0005): mint a personal access token so
// one employee's Claude Desktop can reach /api/mcp.
//
//   DATABASE_URL="postgresql://..." npx tsx scripts/mcp-issue-token.ts \
//       --email ariel@ankora.co.il --label "MacBook Air"
//
//   # list a user's tokens
//   ... scripts/mcp-issue-token.ts --email ariel@ankora.co.il --list
//
//   # revoke one
//   ... scripts/mcp-issue-token.ts --revoke <tokenId>
//
// Deliberately a script and not a screen, for now. A self-service "create
// token" button on the Profile screen is the right destination, but it is
// a credential-issuing UI - it needs its own rate limit, its own audit
// action and a show-once modal that cannot be re-opened. That is Phase 2
// work; until then issuing is a deliberate act by someone with database
// access, which is the correct amount of friction for a handful of
// internal users.
//
// Follows prisma/seed.ts's conventions: relative imports and its own
// PrismaClient, because this runs under plain tsx rather than inside
// Next.js.
import { PrismaClient } from "@prisma/client";
import { defaultExpiry, generateMcpToken, hashMcpToken } from "../lib/mcp/token";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const revokeId = arg("revoke");
  if (revokeId) {
    const updated = await prisma.mcpAccessToken.update({
      where: { id: revokeId },
      data: { revokedAt: new Date() },
    });
    console.log(`Revoked token ${updated.id} ("${updated.label}").`);
    return;
  }

  const email = arg("email");
  if (!email) {
    console.error(
      "Usage:\n" +
        "  --email <address> --label <text>   issue a token\n" +
        "  --email <address> --list           list that user's tokens\n" +
        "  --revoke <tokenId>                 revoke one token"
    );
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}.`);
    process.exitCode = 1;
    return;
  }

  if (hasFlag("list")) {
    const tokens = await prisma.mcpAccessToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    if (tokens.length === 0) {
      console.log(`${email} has no MCP tokens.`);
      return;
    }
    for (const t of tokens) {
      const state = t.revokedAt
        ? "revoked"
        : t.expiresAt <= new Date()
          ? "expired"
          : t.tokenVersion !== user.tokenVersion
            ? "invalidated by logout-all-sessions"
            : "active";
      console.log(
        `${t.id}  ${state.padEnd(34)} ${t.label}  (expires ${t.expiresAt.toISOString().slice(0, 10)}, last used ${
          t.lastUsedAt ? t.lastUsedAt.toISOString().slice(0, 16).replace("T", " ") : "never"
        })`
      );
    }
    return;
  }

  // Refuse to hand an MCP credential to an account that could not use the
  // app itself. resolveMcpActor() would reject the token at request time
  // anyway; failing here means nobody gets a token that was never going to
  // work and then spends an afternoon debugging their Claude config.
  if (user.status !== "ACTIVE" || user.deletedAt) {
    console.error(`User ${email} is not active (status=${user.status}) - refusing to issue a token.`);
    process.exitCode = 1;
    return;
  }

  const label = arg("label");
  if (!label) {
    console.error("--label is required. Use something that identifies the machine, e.g. \"MacBook Air\".");
    process.exitCode = 1;
    return;
  }

  const raw = generateMcpToken();
  const row = await prisma.mcpAccessToken.create({
    data: {
      userId: user.id,
      label,
      tokenHash: hashMcpToken(raw),
      // Snapshot the current counter so a later "logout all sessions"
      // invalidates this token too - see lib/mcp/auth.ts.
      tokenVersion: user.tokenVersion,
      expiresAt: defaultExpiry(),
    },
  });

  console.log("");
  console.log(`Token issued for ${user.name} <${user.email}>`);
  console.log(`  id:      ${row.id}`);
  console.log(`  label:   ${row.label}`);
  console.log(`  expires: ${row.expiresAt.toISOString().slice(0, 10)}`);
  console.log("");
  console.log("  This value is shown once and is not recoverable:");
  console.log("");
  console.log(`  ${raw}`);
  console.log("");
  console.log("  Put it in the ANKORA_MCP_TOKEN env var of the Claude Desktop");
  console.log("  config entry - see README, \"Claude Desktop (MCP)\".");
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
