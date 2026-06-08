ALTER TABLE "post"
ADD COLUMN "is_shareable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "is_commentable" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "post_cat" (
    "post_id" TEXT NOT NULL,
    "cat_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_cat_pkey" PRIMARY KEY ("post_id","cat_id")
);

INSERT INTO "post_cat" ("post_id", "cat_id", "order", "created_at")
SELECT "id", "cat_id", 1, "created_at"
FROM "post"
WHERE "cat_id" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "post_cat_post_id_order_key" ON "post_cat"("post_id", "order");
CREATE INDEX "post_cat_cat_id_post_id_idx" ON "post_cat"("cat_id", "post_id");

ALTER TABLE "post_cat" ADD CONSTRAINT "post_cat_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_cat" ADD CONSTRAINT "post_cat_cat_id_fkey" FOREIGN KEY ("cat_id") REFERENCES "cat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "post_cat_id_id_idx";
ALTER TABLE "post" DROP CONSTRAINT IF EXISTS "post_cat_id_fkey";
ALTER TABLE "post" DROP COLUMN "cat_id";
