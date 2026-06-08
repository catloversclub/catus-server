-- CreateTable
CREATE TABLE "comment_report" (
    "comment_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,

    CONSTRAINT "comment_report_pkey" PRIMARY KEY ("comment_id","reporter_id")
);

-- AddForeignKey
ALTER TABLE "comment_report" ADD CONSTRAINT "comment_report_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_report" ADD CONSTRAINT "comment_report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
