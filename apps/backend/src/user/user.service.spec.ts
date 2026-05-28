jest.mock("@app/notification/notification.service", () => ({
  NotificationService: class NotificationService {},
}))

import { ForbiddenException } from "@nestjs/common"
import { UserService } from "./user.service"

describe("UserService", () => {
  const notificationService = {
    sendNewFollowerNotification: jest.fn(),
  }

  const buildService = (prisma: any) =>
    new UserService(
      prisma,
      {} as any,
      { get: jest.fn() } as any,
      notificationService as any,
    )

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("blocks a user, removes both follow directions, and updates counts", async () => {
    const tx = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "blocked-id" }),
        update: jest.fn().mockResolvedValue({ id: "user-id" }),
      },
      userBlock: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      follow: {
        deleteMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
    }
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    }
    const service = buildService(prisma)

    await expect(service.block("blocker-id", "blocked-id")).resolves.toEqual({
      isBlockedByMe: true,
    })

    expect(tx.userBlock.create).toHaveBeenCalledWith({
      data: {
        blockerId: "blocker-id",
        blockedId: "blocked-id",
      },
    })
    expect(tx.follow.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        followerId: "blocker-id",
        followingId: "blocked-id",
      },
    })
    expect(tx.follow.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        followerId: "blocked-id",
        followingId: "blocker-id",
      },
    })
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "blocker-id" },
      data: { followingCount: { decrement: 1 } },
      select: { id: true },
    })
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "blocked-id" },
      data: { followerCount: { decrement: 1 } },
      select: { id: true },
    })
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "blocked-id" },
      data: { followingCount: { decrement: 1 } },
      select: { id: true },
    })
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "blocker-id" },
      data: { followerCount: { decrement: 1 } },
      select: { id: true },
    })
  })

  it("treats an existing block as a successful idempotent block", async () => {
    const tx = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "blocked-id" }),
      },
      userBlock: {
        create: jest.fn().mockRejectedValue({ code: "P2002" }),
      },
      follow: {
        deleteMany: jest.fn(),
      },
    }
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    }
    const service = buildService(prisma)

    await expect(service.block("blocker-id", "blocked-id")).resolves.toEqual({
      isBlockedByMe: true,
    })
    expect(tx.follow.deleteMany).not.toHaveBeenCalled()
  })

  it("rejects follow when either user has blocked the other", async () => {
    const tx = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({ id: "follower-id", nickname: "follower" })
          .mockResolvedValueOnce({ id: "following-id" }),
      },
      userBlock: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      follow: {
        create: jest.fn(),
      },
    }
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    }
    const service = buildService(prisma)

    await expect(service.follow("follower-id", "following-id")).rejects.toThrow(
      ForbiddenException,
    )
    expect(tx.follow.create).not.toHaveBeenCalled()
    expect(notificationService.sendNewFollowerNotification).not.toHaveBeenCalled()
  })

  it("returns blocked users with cursors", async () => {
    const prisma = {
      getPaginator: jest.fn().mockReturnValue({ skip: 1, cursor: { id: 10 } }),
      userBlock: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 9,
            blocked: {
              id: "blocked-id",
              nickname: "blocked",
              profileImageUrl: null,
            },
          },
        ]),
      },
    }
    const service = buildService(prisma)

    await expect(service.getBlocks("blocker-id", 10, 20)).resolves.toEqual([
      {
        id: "blocked-id",
        nickname: "blocked",
        profileImageUrl: null,
        cursor: 9,
      },
    ])
    expect(prisma.userBlock.findMany).toHaveBeenCalledWith({
      skip: 1,
      cursor: { id: 10 },
      take: 20,
      where: {
        blockerId: "blocker-id",
      },
      select: {
        id: true,
        blocked: {
          select: {
            id: true,
            nickname: true,
            profileImageUrl: true,
          },
        },
      },
      orderBy: {
        id: "desc",
      },
    })
  })
})
