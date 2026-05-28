export const getVisibleUserWhere = (viewerId: string) =>
  ({
    blocking: {
      none: {
        blockedId: viewerId,
      },
    },
    blockedBy: {
      none: {
        blockerId: viewerId,
      },
    },
  })

export const getUserBlockBetweenWhere = (userId: string, targetUserId: string) =>
  ({
    OR: [
      {
        blockerId: userId,
        blockedId: targetUserId,
      },
      {
        blockerId: targetUserId,
        blockedId: userId,
      },
    ],
  })
