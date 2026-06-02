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

    await expect(service.follow("follower-id", "following-id", ["cat-id"])).rejects.toThrow(
      ForbiddenException,
    )
    expect(tx.follow.create).not.toHaveBeenCalled()
    expect(notificationService.sendNewFollowerNotification).not.toHaveBeenCalled()
  })

  it("follows selected cats, removes duplicate ids, and updates counts once", async () => {
    const tx = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({ id: "follower-id", nickname: "follower" })
          .mockResolvedValueOnce({ id: "following-id" }),
        update: jest
          .fn()
          .mockResolvedValueOnce({ id: "follower-id", followingCount: 1 })
          .mockResolvedValueOnce({ id: "following-id", followerCount: 1 }),
      },
      userBlock: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      cat: {
        findMany: jest.fn().mockResolvedValue([{ id: "cat-a" }, { id: "cat-b" }]),
      },
      follow: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 10 }),
      },
      followCat: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ catId: "cat-a" }, { catId: "cat-b" }]),
      },
    }
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    }
    const service = buildService(prisma)

    await expect(
      service.follow("follower-id", "following-id", ["cat-a", "cat-a", "cat-b"]),
    ).resolves.toEqual({
      follower: { id: "follower-id", followingCount: 1 },
      target: { id: "following-id", followerCount: 1 },
      isFollowing: true,
      followedCatIds: ["cat-a", "cat-b"],
    })

    expect(tx.cat.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["cat-a", "cat-b"],
        },
        butlerId: "following-id",
      },
      select: {
        id: true,
      },
    })
    expect(tx.followCat.createMany).toHaveBeenCalledWith({
      data: [
        { followId: 10, catId: "cat-a" },
        { followId: 10, catId: "cat-b" },
      ],
      skipDuplicates: true,
    })
    expect(notificationService.sendNewFollowerNotification).toHaveBeenCalledWith({
      recipientId: "following-id",
      followerId: "follower-id",
      followerNickname: "follower",
    })
  })

  it("unfollows selected cats and deletes the user follow when none remain", async () => {
    const tx = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({ id: "follower-id" })
          .mockResolvedValueOnce({ id: "following-id" }),
        update: jest
          .fn()
          .mockResolvedValueOnce({ id: "follower-id", followingCount: 0 })
          .mockResolvedValueOnce({ id: "following-id", followerCount: 0 }),
      },
      cat: {
        findMany: jest.fn().mockResolvedValue([{ id: "cat-a" }, { id: "cat-b" }]),
      },
      follow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 10 }),
        delete: jest.fn().mockResolvedValue({ id: 10 }),
      },
      followCat: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    }
    const service = buildService(prisma)

    await expect(
      service.unfollow("follower-id", "following-id", ["cat-a", "cat-a", "cat-b"]),
    ).resolves.toEqual({
      follower: { id: "follower-id", followingCount: 0 },
      target: { id: "following-id", followerCount: 0 },
      isFollowing: false,
      followedCatIds: [],
    })

    expect(tx.followCat.deleteMany).toHaveBeenCalledWith({
      where: {
        followId: 10,
        catId: {
          in: ["cat-a", "cat-b"],
        },
      },
    })
    expect(tx.follow.delete).toHaveBeenCalledWith({
      where: {
        id: 10,
      },
    })
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "follower-id" },
      data: { followingCount: { decrement: 1 } },
      select: { id: true, followingCount: true },
    })
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "following-id" },
      data: { followerCount: { decrement: 1 } },
      select: { id: true, followerCount: true },
    })
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
