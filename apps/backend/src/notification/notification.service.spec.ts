import { NotFoundException } from "@nestjs/common"
import { NotificationService } from "./notification.service"

jest.mock("expo-server-sdk", () => {
  class Expo {
    static isExpoPushToken = jest.fn(() => true)

    chunkPushNotifications = jest.fn((messages: unknown[]) => [messages])
    sendPushNotificationsAsync = jest.fn(async (messages: unknown[]) =>
      messages.map(() => ({ status: "ok" })),
    )
  }

  return {
    __esModule: true,
    default: Expo,
  }
})

describe("NotificationService", () => {
  const prisma = {
    notificationSetting: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    pushToken: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    getPaginator: jest.fn(),
    $transaction: jest.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
  }
  const storage = {
    getPublicUrl: jest.fn((value: string) => `https://storage.catus.app/catus-media/${value}`),
  }
  const service = new NotificationService(prisma as any, storage as any)

  beforeEach(() => {
    jest.clearAllMocks()
    prisma.getPaginator.mockReturnValue({})
    prisma.notificationSetting.findMany.mockResolvedValue([])
    prisma.notificationSetting.findUnique.mockResolvedValue(null)
    prisma.notification.createMany.mockResolvedValue({ count: 0 })
    prisma.notification.groupBy.mockResolvedValue([])
    prisma.notification.updateMany.mockResolvedValue({ count: 0 })
    prisma.pushToken.findMany.mockResolvedValue([])
  })

  it("adds actor imageUrl when notifications contain actorId or followerId", async () => {
    const alreadyReadAt = new Date("2026-06-01T00:00:00.000Z")

    prisma.notification.findMany.mockResolvedValue([
      {
        id: "notification-1",
        userId: "recipient-id",
        title: "actor",
        body: "liked",
        data: {
          type: "POST_LIKE",
          actorId: "actor-id",
          postId: "post-id",
        },
        readAt: null,
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
      },
      {
        id: "notification-2",
        userId: "recipient-id",
        title: "새로운 팔로워",
        body: "followed",
        data: {
          type: "USER_FOLLOWED",
          followerId: "follower-id",
        },
        readAt: alreadyReadAt,
        createdAt: new Date("2026-06-02T00:01:00.000Z"),
      },
      {
        id: "notification-3",
        userId: "recipient-id",
        title: "[공지] 안내",
        body: "notice",
        data: {
          type: "NOTICE",
        },
        readAt: null,
        createdAt: new Date("2026-06-02T00:02:00.000Z"),
      },
    ])
    prisma.user.findMany.mockResolvedValue([
      {
        id: "actor-id",
        profileImageUrl: "profiles/actor.webp",
      },
      {
        id: "follower-id",
        profileImageUrl: null,
      },
    ])

    const result = await service.getNotifications("recipient-id")

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["actor-id", "follower-id"],
        },
      },
      select: {
        id: true,
        profileImageUrl: true,
      },
    })
    expect(result[0]).toMatchObject({
      id: "notification-1",
      actor: {
        id: "actor-id",
        imageUrl: "https://storage.catus.app/catus-media/profiles/actor.webp",
      },
    })
    expect(result[0].readAt).toBeInstanceOf(Date)
    expect(result[1]).toMatchObject({
      id: "notification-2",
      readAt: alreadyReadAt,
      actor: {
        id: "follower-id",
        imageUrl: null,
      },
    })
    expect(result[2]).toMatchObject({
      id: "notification-3",
      actor: null,
    })
  })

  it("deletes a notification owned by the user", async () => {
    prisma.notification.deleteMany.mockResolvedValue({ count: 1 })

    await expect(
      service.deleteNotification("recipient-id", "notification-id"),
    ).resolves.toEqual({
      id: "notification-id",
      deleted: true,
    })

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "notification-id",
        userId: "recipient-id",
      },
    })
  })

  it("throws not found when deleting a missing or foreign notification", async () => {
    prisma.notification.deleteMany.mockResolvedValue({ count: 0 })

    await expect(
      service.deleteNotification("recipient-id", "notification-id"),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it("returns default notification settings when settings do not exist yet", async () => {
    await expect(service.getNotificationSettings("recipient-id")).resolves.toEqual({
      allEnabled: true,
      postLikeEnabled: true,
      commentEnabled: true,
      replyEnabled: true,
      followEnabled: true,
      marketingEnabled: true,
    })

    expect(prisma.notificationSetting.findUnique).toHaveBeenCalledWith({
      where: {
        userId: "recipient-id",
      },
      select: {
        allEnabled: true,
        postLikeEnabled: true,
        commentEnabled: true,
        replyEnabled: true,
        followEnabled: true,
        marketingEnabled: true,
      },
    })
  })

  it("updates notification settings partially", async () => {
    prisma.notificationSetting.upsert.mockResolvedValue({
      allEnabled: true,
      postLikeEnabled: false,
      commentEnabled: true,
      replyEnabled: true,
      followEnabled: true,
      marketingEnabled: false,
    })

    await expect(
      service.updateNotificationSettings("recipient-id", {
        postLikeEnabled: false,
        marketingEnabled: false,
      }),
    ).resolves.toEqual({
      allEnabled: true,
      postLikeEnabled: false,
      commentEnabled: true,
      replyEnabled: true,
      followEnabled: true,
      marketingEnabled: false,
    })

    expect(prisma.notificationSetting.upsert).toHaveBeenCalledWith({
      where: {
        userId: "recipient-id",
      },
      update: {
        postLikeEnabled: false,
        marketingEnabled: false,
      },
      create: {
        userId: "recipient-id",
        postLikeEnabled: false,
        marketingEnabled: false,
      },
      select: {
        allEnabled: true,
        postLikeEnabled: true,
        commentEnabled: true,
        replyEnabled: true,
        followEnabled: true,
        marketingEnabled: true,
      },
    })
  })

  it("does not create or push notifications disabled by user settings", async () => {
    prisma.notificationSetting.findMany.mockResolvedValue([
      {
        userId: "like-disabled-id",
        allEnabled: true,
        postLikeEnabled: false,
        commentEnabled: true,
        replyEnabled: true,
        followEnabled: true,
        marketingEnabled: true,
      },
      {
        userId: "all-disabled-id",
        allEnabled: false,
        postLikeEnabled: true,
        commentEnabled: true,
        replyEnabled: true,
        followEnabled: true,
        marketingEnabled: true,
      },
    ])
    prisma.pushToken.findMany.mockResolvedValue([
      {
        userId: "default-enabled-id",
        token: "ExponentPushToken[default-enabled]",
      },
    ])
    prisma.notification.groupBy.mockResolvedValue([
      {
        userId: "default-enabled-id",
        _count: {
          _all: 3,
        },
      },
    ])

    await expect(
      service.sendPushNotificationToUsers(
        ["default-enabled-id", "like-disabled-id", "all-disabled-id"],
        {
          title: "actor",
          body: "회원님의 게시물을 좋아합니다",
          data: {
            type: "POST_LIKE",
          },
        },
      ),
    ).resolves.toMatchObject({
      notificationCount: 1,
      tokenCount: 1,
      validTokenCount: 1,
    })

    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "default-enabled-id",
          title: "actor",
          body: "회원님의 게시물을 좋아합니다",
          data: {
            type: "POST_LIKE",
          },
        },
      ],
    })
    expect(prisma.pushToken.findMany).toHaveBeenCalledWith({
      where: {
        userId: {
          in: ["default-enabled-id"],
        },
        enabled: true,
      },
      select: {
        userId: true,
        token: true,
      },
    })
  })
})
