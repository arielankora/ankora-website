-- 15.10.2026: onboarding and offboarding tasks, linked to the employee
-- they are about so the system can find them again.
CREATE TYPE "EmployeeLifecycleKind" AS ENUM ('ONBOARDING', 'OFFBOARDING');

ALTER TABLE "tasks" ADD COLUMN "subjectUserId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "lifecycleKind" "EmployeeLifecycleKind";

CREATE INDEX "tasks_subjectUserId_lifecycleKind_idx" ON "tasks"("subjectUserId", "lifecycleKind");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
