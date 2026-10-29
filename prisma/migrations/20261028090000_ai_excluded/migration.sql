-- 28.10.2026: a client can ask that a task, a document or everything of
-- theirs stay away from AI. Nothing is marked by this migration: until now
-- such requests were handled by hand, and the operations manager marks
-- them in the app.
ALTER TABLE "clients" ADD COLUMN "aiExcluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "aiExcluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_documents" ADD COLUMN "aiExcluded" BOOLEAN NOT NULL DEFAULT false;
