CREATE TABLE "user_block" (
    "id" SERIAL NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_block_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_block_blocker_id_blocked_id_key" ON "user_block"("blocker_id", "blocked_id");

CREATE INDEX "user_block_blocker_id_id_idx" ON "user_block"("blocker_id", "id");

CREATE INDEX "user_block_blocked_id_blocker_id_idx" ON "user_block"("blocked_id", "blocker_id");

ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
