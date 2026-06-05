import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "@app/prisma/prisma.service"
import { StorageService } from "@app/storage/storage.service"
import { Prisma, type PushPlatform } from "@prisma/client"
import Expo, { type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk"

type PushNotificationPayload = Omit<ExpoPushMessage, "to" | "badge">

const NOTIFICATION_PREVIEW_MAX_LENGTH = 32

@Injectable()
export class NotificationService {
  private readonly expo = new Expo()

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  registerPushToken(userId: string, token: string, platform: PushPlatform) {
    if (!Expo.isExpoPushToken(token)) {
      throw new BadRequestException("Invalid Expo push token")
    }

    const now = new Date()

    return this.prisma.pushToken.upsert({
      where: {
        token,
      },
      update: {
        userId,
        platform,
        enabled: true,
        lastUsedAt: now,
      },
      create: {
        userId,
        token,
        platform,
        enabled: true,
        lastUsedAt: now,
      },
    })
  }

  async getPushToken(userId: string, token: string) {
    const pushToken = await this.prisma.pushToken.findFirst({
      where: {
        token,
        userId,
      },
      select: {
        token: true,
        platform: true,
        enabled: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!pushToken) {
      throw new NotFoundException("Push token not found")
    }

    return pushToken
  }

  async updatePushToken(userId: string, token: string, enabled: boolean) {
    const updated = await this.prisma.pushToken.updateMany({
      where: {
        token,
        userId,
      },
      data: {
        enabled,
      },
    })

    if (updated.count === 0) {
      throw new NotFoundException("Push token not found")
    }

    return {
      token,
      enabled,
    }
  }

  async getNotifications(userId: string, cursor?: string | null, take = 20) {
    const readAt = new Date()
    const pagination = this.prisma.getPaginator(cursor ?? null)

    const [notifications] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        ...pagination,
        take,
        where: {
          userId,
          createdAt: {
            lte: readAt,
          },
        },
        orderBy: {
          id: "desc",
        },
      }),
      this.prisma.notification.updateMany({
        where: {
          userId,
          readAt: null,
          createdAt: {
            lte: readAt,
          },
        },
        data: {
          readAt,
        },
      }),
    ])

    const actorIds = [
      ...new Set(
        notifications
          .map((notification) => this.getNotificationActorId(notification.data))
          .filter((actorId): actorId is string => actorId != null),
      ),
    ]
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: {
            id: {
              in: actorIds,
            },
          },
          select: {
            id: true,
            profileImageUrl: true,
          },
        })
      : []
    const actorById = new Map(
      actors.map((actor) => [
        actor.id,
        {
          id: actor.id,
          imageUrl: this.toPublicProfileImageUrl(actor.profileImageUrl),
        },
      ]),
    )

    return notifications.map((notification) => ({
      ...notification,
      readAt: notification.readAt ?? readAt,
      actor: this.getNotificationActor(notification.data, actorById),
    }))
  }

  async deleteNotification(userId: string, notificationId: string) {
    const deleted = await this.prisma.notification.deleteMany({
      where: {
        id: notificationId,
        userId,
      },
    })

    if (deleted.count === 0) {
      throw new NotFoundException("Notification not found")
    }

    return {
      id: notificationId,
      deleted: true,
    }
  }

  async sendPushNotificationToUser(userId: string, message: PushNotificationPayload) {
    return this.sendPushNotificationToUsers([userId], message)
  }

  sendPostLikeNotification(params: {
    recipientId: string
    actorId: string
    actorNickname: string
    postId: string
  }) {
    if (params.recipientId === params.actorId) {
      return this.sendPushNotificationToUsers([], {})
    }

    return this.sendPushNotificationToUser(params.recipientId, {
      title: params.actorNickname,
      body: "회원님의 게시물을 좋아합니다",
      data: {
        type: "POST_LIKE",
        actorId: params.actorId,
        postId: params.postId,
      },
    })
  }

  sendCommentNotification(params: {
    recipientId: string
    actorId: string
    actorNickname: string
    postId: string
    commentId: string
    content: string
  }) {
    if (params.recipientId === params.actorId) {
      return this.sendPushNotificationToUsers([], {})
    }

    return this.sendPushNotificationToUser(params.recipientId, {
      title: `${params.actorNickname}님이 댓글을 남겼습니다`,
      body: this.preview(params.content),
      data: {
        type: "COMMENT_CREATED",
        actorId: params.actorId,
        postId: params.postId,
        commentId: params.commentId,
      },
    })
  }

  sendReplyNotification(params: {
    recipientId: string
    actorId: string
    actorNickname: string
    postId: string
    commentId: string
    parentCommentId: string
    content: string
  }) {
    if (params.recipientId === params.actorId) {
      return this.sendPushNotificationToUsers([], {})
    }

    return this.sendPushNotificationToUser(params.recipientId, {
      title: `${params.actorNickname}님이 회원님의 댓글에 답글을 남겼습니다`,
      body: this.preview(params.content),
      data: {
        type: "REPLY_CREATED",
        actorId: params.actorId,
        postId: params.postId,
        commentId: params.commentId,
        parentCommentId: params.parentCommentId,
      },
    })
  }

  sendNewFollowerNotification(params: {
    recipientId: string
    followerId: string
    followerNickname: string
  }) {
    return this.sendPushNotificationToUser(params.recipientId, {
      title: "새로운 팔로워",
      body: `${params.followerNickname}님이 회원님을 팔로우하기 시작했습니다`,
      data: {
        type: "USER_FOLLOWED",
        followerId: params.followerId,
      },
    })
  }

  sendCatFollowerNotification(params: {
    recipientId: string
    followerId: string
    followerNickname: string
    catId: string
    catName: string
  }) {
    return this.sendPushNotificationToUser(params.recipientId, {
      title: params.catName,
      body: `${params.followerNickname}님이 팔로우하기 시작했습니다`,
      data: {
        type: "CAT_FOLLOWED",
        followerId: params.followerId,
        catId: params.catId,
      },
    })
  }

  sendFollowedCatPostNotification(params: {
    recipientIds: string[]
    catId: string
    catName: string
    postId: string
  }) {
    return this.sendPushNotificationToUsers(params.recipientIds, {
      title: params.catName,
      body: "새로운 게시글이 올라왔어요",
      data: {
        type: "FOLLOWED_CAT_POST_CREATED",
        catId: params.catId,
        postId: params.postId,
      },
    })
  }

  sendNoticeNotificationToUsers(params: {
    recipientIds: string[]
    noticeId?: string
    title: string
    body: string
  }) {
    return this.sendPushNotificationToUsers(params.recipientIds, {
      title: `[공지] ${params.title}`,
      body: params.body,
      data: {
        type: "NOTICE",
        ...(params.noticeId ? { noticeId: params.noticeId } : {}),
      },
    })
  }

  async sendNoticeNotificationToAllUsers(params: {
    noticeId?: string
    title: string
    body: string
  }) {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
      },
    })

    return this.sendNoticeNotificationToUsers({
      ...params,
      recipientIds: users.map(({ id }) => id),
    })
  }

  async sendPushNotificationToUsers(userIds: string[], message: PushNotificationPayload) {
    const normalizedUserIds = [...new Set(userIds.filter(Boolean))]

    if (normalizedUserIds.length === 0) {
      return {
        notificationCount: 0,
        tokenCount: 0,
        validTokenCount: 0,
        tickets: [],
      }
    }

    const notificationData = message.data
      ? (message.data as Prisma.InputJsonValue)
      : undefined

    await this.prisma.notification.createMany({
      data: normalizedUserIds.map((userId) => ({
        userId,
        title: message.title ?? null,
        body: message.body ?? null,
        data: notificationData,
      })),
    })

    const [pushTokens, unreadCounts] = await Promise.all([
      this.prisma.pushToken.findMany({
        where: {
          userId: {
            in: normalizedUserIds,
          },
          enabled: true,
        },
        select: {
          userId: true,
          token: true,
        },
      }),
      this.prisma.notification.groupBy({
        by: ["userId"],
        where: {
          userId: {
            in: normalizedUserIds,
          },
          readAt: null,
        },
        _count: {
          _all: true,
        },
      }),
    ])

    const unreadCountByUserId = new Map(
      unreadCounts.map((item) => [item.userId, item._count._all]),
    )

    const messages = pushTokens
      .filter(({ token }) => Expo.isExpoPushToken(token))
      .map(
        ({ userId, token }): ExpoPushMessage => ({
          sound: "default",
          ...message,
          data: {
            ...(message.data ?? {}),
            unreadCount: unreadCountByUserId.get(userId) ?? 0,
          },
          badge: unreadCountByUserId.get(userId) ?? 0,
          to: token,
        }),
      )

    const tickets = await this.sendExpoMessages(messages)

    return {
      notificationCount: normalizedUserIds.length,
      tokenCount: pushTokens.length,
      validTokenCount: messages.length,
      tickets,
    }
  }

  async sendDevTestNotificationToAllTokens() {
    const pushTokens = await this.prisma.pushToken.findMany({
      where: {
        enabled: true,
      },
      select: {
        token: true,
      },
    })

    const messages = pushTokens
      .filter(({ token }) => Expo.isExpoPushToken(token))
      .map(
        ({ token }): ExpoPushMessage => ({
          to: token,
          sound: "default",
          title: "개발 테스트 알림",
          body: "Expo Push Service 테스트 알림입니다.",
          data: {
            type: "DEV_TEST_NOTIFICATION",
          },
        }),
      )

    const tickets = await this.sendExpoMessages(messages)

    return {
      tokenCount: pushTokens.length,
      validTokenCount: messages.length,
      tickets,
    }
  }

  private async sendExpoMessages(messages: ExpoPushMessage[]) {
    if (messages.length === 0) {
      return []
    }

    const chunks = this.expo.chunkPushNotifications(messages)
    const tickets: ExpoPushTicket[] = []

    for (const chunk of chunks) {
      const result = await this.expo.sendPushNotificationsAsync(chunk)
      tickets.push(...result)
    }

    return tickets
  }

  private preview(content: string) {
    return content.replace(/\s+/g, " ").trim().slice(0, NOTIFICATION_PREVIEW_MAX_LENGTH)
  }

  private toPublicProfileImageUrl(value: string | null) {
    return value ? this.storage.getPublicUrl(value) : value
  }

  private getNotificationActor(
    data: Prisma.JsonValue | null,
    actorById: Map<string, { id: string; imageUrl: string | null }>,
  ) {
    const actorId = this.getNotificationActorId(data)
    if (actorId == null) {
      return null
    }

    return actorById.get(actorId) ?? { id: actorId, imageUrl: null }
  }

  private getNotificationActorId(data: Prisma.JsonValue | null) {
    if (!this.isJsonObject(data)) {
      return null
    }

    const actorId = data.actorId
    if (typeof actorId === "string") {
      return actorId
    }

    const followerId = data.followerId
    if (typeof followerId === "string") {
      return followerId
    }

    return null
  }

  private isJsonObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
