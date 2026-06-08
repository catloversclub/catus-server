-- CreateTable
CREATE TABLE "notification_setting" (
    "user_id" TEXT NOT NULL,
    "all_enabled" BOOLEAN NOT NULL DEFAULT true,
    "post_like_enabled" BOOLEAN NOT NULL DEFAULT true,
    "comment_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reply_enabled" BOOLEAN NOT NULL DEFAULT true,
    "follow_enabled" BOOLEAN NOT NULL DEFAULT true,
    "marketing_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_setting_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "notification_setting" ADD CONSTRAINT "notification_setting_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
