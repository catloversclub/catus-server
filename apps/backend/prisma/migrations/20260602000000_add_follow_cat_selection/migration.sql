-- CreateTable
CREATE TABLE "follow_cat" (
    "follow_id" INTEGER NOT NULL,
    "cat_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_cat_pkey" PRIMARY KEY ("follow_id","cat_id")
);

-- Backfill existing user follows with the target user's current cats.
INSERT INTO "follow_cat" ("follow_id", "cat_id")
SELECT "follow"."id", "cat"."id"
FROM "follow"
JOIN "cat" ON "cat"."butlerId" = "follow"."following_id";

-- CreateIndex
CREATE INDEX "follow_cat_cat_id_idx" ON "follow_cat"("cat_id");

-- AddForeignKey
ALTER TABLE "follow_cat" ADD CONSTRAINT "follow_cat_follow_id_fkey" FOREIGN KEY ("follow_id") REFERENCES "follow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_cat" ADD CONSTRAINT "follow_cat_cat_id_fkey" FOREIGN KEY ("cat_id") REFERENCES "cat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
