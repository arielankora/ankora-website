-- The stalled-promises metric asks client_documents "which of these
-- tasks had a file filed against them today". That is a lookup by
-- taskId, and this table had no index on it: every dashboard load by a
-- manager was a sequential scan of every document in the product.
--
-- Plain CREATE INDEX rather than CONCURRENTLY, because Prisma runs each
-- migration inside a transaction and CONCURRENTLY is not allowed in one.
-- The table holds hundreds of rows, so the lock is measured in
-- milliseconds.
CREATE INDEX "client_documents_taskId_createdAt_idx" ON "client_documents"("taskId", "createdAt");
