import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "@app/prisma/prisma.service"
import { StorageService } from "@app/storage/storage.service"
import { Prisma, type PushPlatform } from "@prisma/client"
import Expo, { type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk"
import type { UpdateNotificationSettingsDto } from "./dto/update-notification-settings.dto"

type PushNotificationPayload = Omit<ExpoPushMessage, "to" | "badge">

const NOTIFICATION_PREVIEW_MAX_LENGTH = 32
const NOTIFICATION_SETTINGS_SELECT = {
  allEnabled: true,
  postLikeEnabled: true,
  commentEnabled: true,
  replyEnabled: true,
  followEnabled: true,
  marketingEnabled: true,
} as const
const DEFAULT_NOTIFICATION_SETTINGS = {
  allEnabled: true,
  postLikeEnabled: true,
  commentEnabled: true,
  replyEnabled: true,
  followEnabled: true,
  marketingEnabled: true,
}
type NotificationSettings = typeof DEFAULT_NOTIFICATION_SETTINGS
type NotificationSettingKey = Exclude<keyof NotificationSettings, "allEnabled">
type NotificationRecord = {
  id: string
  userId: string
  title: string | null
  body: string | null
  data: Prisma.JsonValue | null
  readAt: Date | null
  createdAt: Date
}
const NOTIFICATION_TYPE_SETTING_KEYS: Record<string, NotificationSettingKey> = {
  POST_LIKE: "postLikeEnabled",
  COMMENT_CREATED: "commentEnabled",
  REPLY_CREATED: "replyEnabled",
  USER_FOLLOWED: "followEnabled",
  CAT_FOLLOWED: "followEnabled",
  FOLLOWED_CAT_POST_CREATED: "followEnabled",
  NOTICE: "marketingEnabled",
}

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

  async getNotificationSettings(userId: string) {
    const settings = await this.prisma.notificationSetting.findUnique({
      where: {
        userId,
      },
      select: NOTIFICATION_SETTINGS_SELECT,
    })

    return settings ?? DEFAULT_NOTIFICATION_SETTINGS
  }

  updateNotificationSettings(userId: string, dto: UpdateNotificationSettingsDto) {
    return this.prisma.notificationSetting.upsert({
      where: {
        userId,
      },
      update: dto,
      create: {
        userId,
        ...dto,
      },
      select: NOTIFICATION_SETTINGS_SELECT,
    })
  }

  async getNotifications(userId: string, cursor?: string | null, take = 20) {
    const readAt = new Date()

    const [notifications] = await this.prisma.$transaction([
      this.findVisibleNotifications(userId, cursor ?? null, take, readAt),
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

    const visibleNotifications = notifications.filter((notification) =>
      this.hasVisibleNotificationActor(notification.data, actorById),
    )

    return visibleNotifications.map((notification) => ({
      ...notification,
      readAt: notification.readAt ?? readAt,
      actor: this.getNotificationActor(notification.data, actorById),
    }))
  }

  private findVisibleNotifications(
    userId: string,
    cursor: string | null,
    take: number,
    readAt: Date,
  ) {
    const cursorFilter =
      cursor == null ? Prisma.empty : Prisma.sql`AND n."id" < ${cursor}`

    return this.prisma.$queryRaw<NotificationRecord[]>`
      SELECT
        n."id",
        n."user_id" AS "userId",
        n."title",
        n."body",
        n."data",
        n."read_at" AS "readAt",
        n."created_at" AS "createdAt"
      FROM "notification" n
      WHERE n."user_id" = ${userId}
        AND n."created_at" <= ${readAt}
        ${cursorFilter}
        AND (
          COALESCE(n."data"->>'actorId', n."data"->>'followerId') IS NULL
          OR EXISTS (
            SELECT 1
            FROM "user" actor
            WHERE actor."id" = COALESCE(n."data"->>'actorId', n."data"->>'followerId')
          )
        )
      ORDER BY n."id" DESC
      LIMIT ${take}
    `
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
    const enabledUserIds = normalizedUserIds.length
      ? await this.getNotificationEnabledUserIds(normalizedUserIds, message)
      : []

    if (enabledUserIds.length === 0) {
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
      data: enabledUserIds.map((userId) => ({
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
            in: enabledUserIds,
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
            in: enabledUserIds,
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
      notificationCount: enabledUserIds.length,
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

  private async getNotificationEnabledUserIds(
    userIds: string[],
    message: PushNotificationPayload,
  ) {
    const settingKey = this.getNotificationSettingKey(message.data)
    const settings = await this.prisma.notificationSetting.findMany({
      where: {
        userId: {
          in: userIds,
        },
      },
      select: {
        userId: true,
        ...NOTIFICATION_SETTINGS_SELECT,
      },
    })
    const settingsByUserId = new Map(
      settings.map(({ userId, ...userSettings }) => [userId, userSettings]),
    )

    return userIds.filter((userId) => {
      const userSettings = settingsByUserId.get(userId) ?? DEFAULT_NOTIFICATION_SETTINGS
      if (!userSettings.allEnabled) {
        return false
      }

      return settingKey == null || userSettings[settingKey]
    })
  }

  private getNotificationSettingKey(data: unknown) {
    if (!this.isRecord(data)) {
      return null
    }

    const type = data.type
    if (typeof type !== "string") {
      return null
    }

    return NOTIFICATION_TYPE_SETTING_KEYS[type] ?? null
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

  private hasVisibleNotificationActor(
    data: Prisma.JsonValue | null,
    actorById: Map<string, { id: string; imageUrl: string | null }>,
  ) {
    const actorId = this.getNotificationActorId(data)
    return actorId == null || actorById.has(actorId)
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  private isJsonObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
