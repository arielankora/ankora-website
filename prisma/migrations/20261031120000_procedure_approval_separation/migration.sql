-- 31.10.2026: a client's account manager approves its procedures, beside a
-- manager. A client can ask that whoever wrote a version not approve it.
-- Off for every client: nobody asked for it yet.
ALTER TABLE "clients" ADD COLUMN "procedureApprovalSeparation" BOOLEAN NOT NULL DEFAULT false;
