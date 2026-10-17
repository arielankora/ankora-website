-- Org brain, phase 3: a client's rule in a form the server can check
-- (lib/policy-params.ts). Both default to empty: every existing rule stays
-- text only until someone adds what can be checked.
ALTER TABLE "client_policies" ADD COLUMN "params" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "client_policies" ADD COLUMN "interimParams" JSONB NOT NULL DEFAULT '{}';
