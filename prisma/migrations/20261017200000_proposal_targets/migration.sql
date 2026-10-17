-- Org brain (spec 3.12): proposals for every item in the file, not only
-- facts, people, suppliers, systems, request types and rules.
ALTER TYPE "ProposalTarget" ADD VALUE 'ENTITY';
ALTER TYPE "ProposalTarget" ADD VALUE 'NARRATIVE';
ALTER TYPE "ProposalTarget" ADD VALUE 'PROCESS';
ALTER TYPE "ProposalTarget" ADD VALUE 'DOMAIN';
