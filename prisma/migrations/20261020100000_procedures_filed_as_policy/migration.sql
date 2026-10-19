-- Procedures filed before 20.10.2026 as POLICY, which the screens show as
-- an insurance policy ("פוליסה"), move to their own kind, PROCEDURE ("נוהל").
-- Chosen by title, with the same words the closing check reads
-- (lib/procedure-to-file.ts, looksLikeProcedure). An insurance policy has
-- none of them in its name, so it stays POLICY.
UPDATE "client_documents"
SET "kind" = 'PROCEDURE', "updatedAt" = NOW()
WHERE "kind" = 'POLICY'
  AND "title" ~* '(נוהל|נהלים|תהליך|\ySOP\y|procedure|playbook|runbook)';
