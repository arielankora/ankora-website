import "server-only";
import { PrismaClient } from "@prisma/client";
import { isDevelopment, isProductionBuild } from "@/lib/env";

// Standard Next.js/Prisma singleton pattern: avoids exhausting DB
// connections from hot-reloading in dev, where modules re-evaluate but the
// Node process (and any open connections) persists.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDevelopment() ? ["warn", "error"] : ["error"],
  });

if (!isProductionBuild()) {
  globalForPrisma.prisma = prisma;
}
