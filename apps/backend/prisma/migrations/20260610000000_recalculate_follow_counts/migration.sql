-- Recalculate denormalized follow counters from the canonical follow table.
UPDATE "user" AS u
SET
    "follower_count" = (
        SELECT COUNT(*)::int
        FROM "follow" AS f
        WHERE f."following_id" = u."id"
    ),
    "following_count" = (
        SELECT COUNT(*)::int
        FROM "follow" AS f
        WHERE f."follower_id" = u."id"
    );
