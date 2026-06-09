import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import { getImageExtension } from "@app/storage/image-types.const"
import { ConfigService } from "@nestjs/config"
import type { CreateUserDto } from "./dto/create-user.dto"
import type { UpdateUserDto } from "./dto/update-user.dto"
import { PrismaService } from "@app/prisma/prisma.service"
import { StorageService } from "@app/storage/storage.service"
import { NotificationService } from "@app/notification/notification.service"
import { getUserBlockBetweenWhere, getVisibleUserWhere } from "@app/common/user-block-visibility"
import { uuidv7 } from "uuidv7"
import type { Prisma, Provider } from "@prisma/client"

@Injectable()
export class UserService {
  private readonly bucket: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly notificationService: NotificationService,
  ) {
    this.bucket = this.config.get<string>("S3_BUCKET") ?? "catus-media"
  }

  private toPublicProfileImageUrl(value: string | null) {
    return value ? this.storage.getPublicUrl(value) : value
  }

  private formatProfileImage<T extends { profileImageUrl: string | null }>(item: T): T {
    return {
      ...item,
      profileImageUrl: this.toPublicProfileImageUrl(item.profileImageUrl),
    }
  }

  private normalizeProfileImageUrl<T extends { profileImageUrl?: string | null }>(item: T): T {
    if (item.profileImageUrl === undefined) {
      return item
    }

    return {
      ...item,
      profileImageUrl: this.storage.normalizeStorageValue(item.profileImageUrl),
    }
  }

  private getUniqueCatIds(catIds: string[]) {
    return [...new Set(catIds.map((catId) => catId.trim()).filter(Boolean))]
  }

  private assertSelectedCats(catIds: string[]) {
    if (catIds.length === 0) {
      throw new BadRequestException("catIds must include at least one cat")
    }
  }

  private async assertCatsBelongToUser(
    tx: Prisma.TransactionClient,
    userId: string,
    catIds: string[],
  ) {
    const cats = await tx.cat.findMany({
      where: {
        id: {
          in: catIds,
        },
        butlerId: userId,
      },
      select: {
        id: true,
      },
    })

    if (cats.length !== catIds.length) {
      throw new BadRequestException("catIds must belong to the followed user")
    }
  }

  private async syncFollowCounts(tx: Prisma.TransactionClient, userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)]

    if (uniqueUserIds.length === 0) {
      return
    }

    const [followerCounts, followingCounts] = await Promise.all([
      tx.follow.groupBy({
        by: ["followingId"],
        where: {
          followingId: {
            in: uniqueUserIds,
          },
        },
        _count: {
          _all: true,
        },
      }),
      tx.follow.groupBy({
        by: ["followerId"],
        where: {
          followerId: {
            in: uniqueUserIds,
          },
        },
        _count: {
          _all: true,
        },
      }),
    ])

    const followerCountByUserId = new Map(
      followerCounts.map((item) => [item.followingId, item._count._all]),
    )
    const followingCountByUserId = new Map(
      followingCounts.map((item) => [item.followerId, item._count._all]),
    )

    await Promise.all(
      uniqueUserIds.map((id) =>
        tx.user.update({
          where: { id },
          data: {
            followerCount: followerCountByUserId.get(id) ?? 0,
            followingCount: followingCountByUserId.get(id) ?? 0,
          },
          select: { id: true },
        }),
      ),
    )
  }

  async create(createUserDto: CreateUserDto, identity: { provider: Provider; id: string }) {
    const { favoritePersonalities, favoriteAppearances, ...rest } = createUserDto
    const normalizedRest = this.normalizeProfileImageUrl(rest)

    const data: any = {
      ...normalizedRest,
      // TODO: Stop storing kakao id on User once all clients use UserIdentity.
      ...(identity.provider === "KAKAO" ? { kakaoId: identity.id } : {}),
      UserIdentity: {
        create: {
          provider: identity.provider,
          id: identity.id,
        },
      },
      ...(favoritePersonalities?.length && {
        favoritePersonalities: {
          connect: favoritePersonalities.map((id) => ({ id })),
        },
      }),
      ...(favoriteAppearances?.length && {
        favoriteAppearances: {
          connect: favoriteAppearances.map((id) => ({ id })),
        },
      }),
    }

    const user = await this.prisma.user.create({
      data,
    })

    return this.formatProfileImage(user)
  }

  async checkNickname(nickname: string) {
    const nicknameTaken = await this.prisma.user.findUnique({
      where: { nickname },
      select: { hasAgreedToTerms: true },
    })

    return { available: !nicknameTaken }
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        favoriteAppearances: true,
        favoritePersonalities: true,
      },
    })

    return this.formatProfileImage(user)
  }

  async getOne(userId: string, viewerId: string) {
    const user = await this.prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        ...getVisibleUserWhere(viewerId),
      },
      select: {
        nickname: true,
        profileImageUrl: true,
        followerCount: true,
        followingCount: true,
        followers: {
          where: { followerId: viewerId },
          select: { followerId: true },
        },
      },
    })

    const { followers, ...rest } = user

    return {
      ...rest,
      profileImageUrl: this.toPublicProfileImageUrl(rest.profileImageUrl),
      isFollowing: followers.length > 0,
    }
  }

  async follow(followerId: string, followingId: string, catIds: string[]) {
    if (followerId === followingId) {
      throw new BadRequestException("You cannot follow yourself")
    }

    const selectedCatIds = this.getUniqueCatIds(catIds)
    this.assertSelectedCats(selectedCatIds)

    const result = await this.prisma.$transaction(async (tx) => {
      const [followerUser] = await Promise.all([
        tx.user.findUniqueOrThrow({
          where: { id: followerId },
          select: { id: true, nickname: true },
        }),
        tx.user.findUniqueOrThrow({ where: { id: followingId }, select: { id: true } }),
      ])

      const block = await tx.userBlock.findFirst({
        where: getUserBlockBetweenWhere(followerId, followingId),
        select: { id: true },
      })

      if (block) {
        throw new ForbiddenException("You cannot follow a blocked user")
      }

      await this.assertCatsBelongToUser(tx, followingId, selectedCatIds)

      const existingFollow = await tx.follow.findUnique({
        where: {
          followerId_followingId: { followerId, followingId },
        },
        select: {
          id: true,
        },
      })

      const follow =
        existingFollow ??
        (await tx.follow.create({
          data: { followerId, followingId },
          select: { id: true },
        }))

      await tx.followCat.createMany({
        data: selectedCatIds.map((catId) => ({
          followId: follow.id,
          catId,
        })),
        skipDuplicates: true,
      })

      const followedCats = await tx.followCat.findMany({
        where: {
          followId: follow.id,
        },
        select: {
          catId: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      })

      const [follower, target] = existingFollow
        ? await Promise.all([
            tx.user.findUniqueOrThrow({
              where: { id: followerId },
              select: { id: true, followingCount: true },
            }),
            tx.user.findUniqueOrThrow({
              where: { id: followingId },
              select: { id: true, followerCount: true },
            }),
          ])
        : await Promise.all([
            tx.user.update({
              where: { id: followerId },
              data: { followingCount: { increment: 1 } },
              select: { id: true, followingCount: true },
            }),
            tx.user.update({
              where: { id: followingId },
              data: { followerCount: { increment: 1 } },
              select: { id: true, followerCount: true },
            }),
          ])

      return {
        follower,
        target,
        isFollowing: true,
        followedCatIds: followedCats.map((cat) => cat.catId),
        notification: existingFollow
          ? null
          : {
              recipientId: followingId,
              followerId,
              followerNickname: followerUser.nickname,
            },
      }
    })

    if (result.notification) {
      await this.notificationService.sendNewFollowerNotification(result.notification)
    }

    return {
      follower: result.follower,
      target: result.target,
      isFollowing: result.isFollowing,
      followedCatIds: result.followedCatIds,
    }
  }

  async unfollow(followerId: string, followingId: string, catIds: string[]) {
    if (followerId === followingId) {
      throw new BadRequestException("You cannot unfollow yourself")
    }

    const selectedCatIds = this.getUniqueCatIds(catIds)
    this.assertSelectedCats(selectedCatIds)

    return this.prisma.$transaction(async (tx) => {
      await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: followerId }, select: { id: true } }),
        tx.user.findUniqueOrThrow({ where: { id: followingId }, select: { id: true } }),
      ])

      const follow = await tx.follow.findUniqueOrThrow({
        where: {
          followerId_followingId: { followerId, followingId },
        },
        select: {
          id: true,
        },
      })

      await this.assertCatsBelongToUser(tx, followingId, selectedCatIds)

      await tx.followCat.deleteMany({
        where: {
          followId: follow.id,
          catId: {
            in: selectedCatIds,
          },
        },
      })

      const remainingCats = await tx.followCat.findMany({
        where: {
          followId: follow.id,
        },
        select: {
          catId: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      })

      if (remainingCats.length > 0) {
        const [follower, target] = await Promise.all([
          tx.user.findUniqueOrThrow({
            where: { id: followerId },
            select: { id: true, followingCount: true },
          }),
          tx.user.findUniqueOrThrow({
            where: { id: followingId },
            select: { id: true, followerCount: true },
          }),
        ])

        return {
          follower,
          target,
          isFollowing: true,
          followedCatIds: remainingCats.map((cat) => cat.catId),
        }
      }

      await tx.follow.delete({
        where: {
          id: follow.id,
        },
      })

      const [follower, target] = await Promise.all([
        tx.user.update({
          where: { id: followerId },
          data: { followingCount: { decrement: 1 } },
          select: { id: true, followingCount: true },
        }),
        tx.user.update({
          where: { id: followingId },
          data: { followerCount: { decrement: 1 } },
          select: { id: true, followerCount: true },
        }),
      ])

      return {
        follower,
        target,
        isFollowing: false,
        followedCatIds: [],
      }
    })
  }

  async getFollowers(myId: string, userId: string, cursor?: number | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    await this.prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        ...getVisibleUserWhere(myId),
      },
      select: { id: true },
    })

    const followers = await this.prisma.follow.findMany({
      ...pagination,
      take,
      where: {
        followingId: userId,
        follower: getVisibleUserWhere(myId),
      },
      select: {
        id: true,
        follower: {
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

    const followerIds = followers.map((item) => item.follower.id)

    const myFollowings = followerIds.length
      ? await this.prisma.follow.findMany({
          where: {
            followerId: myId,
            followingId: {
              in: followerIds,
            },
          },
          select: {
            followingId: true,
          },
        })
      : []

    const followedSet = new Set(myFollowings.map((item) => item.followingId))

    return followers.map((item) => ({
      id: item.follower.id,
      nickname: item.follower.nickname,
      profileImageUrl: this.toPublicProfileImageUrl(item.follower.profileImageUrl),
      isFollowedByMe: followedSet.has(item.follower.id),
      cursor: item.id,
    }))
  }

  async getFollowings(myId: string, userId: string, cursor?: number | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    await this.prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        ...getVisibleUserWhere(myId),
      },
      select: { id: true },
    })

    const followers = await this.prisma.follow.findMany({
      ...pagination,
      take,
      where: {
        followerId: userId,
        following: getVisibleUserWhere(myId),
      },
      select: {
        id: true,
        following: {
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

    let followedSet: Set<string>

    if (myId !== userId) {
      const followerIds = followers.map((item) => item.following.id)

      const myFollowings = followerIds.length
        ? await this.prisma.follow.findMany({
            where: {
              followerId: myId,
              followingId: {
                in: followerIds,
              },
            },
            select: {
              followingId: true,
            },
          })
        : []

      followedSet = new Set(myFollowings.map((item) => item.followingId))
    }

    return followers.map((item) => ({
      id: item.following.id,
      nickname: item.following.nickname,
      profileImageUrl: this.toPublicProfileImageUrl(item.following.profileImageUrl),
      isFollowedByMe: myId === userId ? true : followedSet.has(item.following.id),
      cursor: item.id,
    }))
  }

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException("You cannot block yourself")
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({
        where: { id: blockedId },
        select: { id: true },
      })

      try {
        await tx.userBlock.create({
          data: {
            blockerId,
            blockedId,
          },
        })
      } catch (err: any) {
        if (err.code === "P2002") {
          return
        }

        throw err
      }

      const [blockingFollow, blockedByFollow] = await Promise.all([
        tx.follow.deleteMany({
          where: {
            followerId: blockerId,
            followingId: blockedId,
          },
        }),
        tx.follow.deleteMany({
          where: {
            followerId: blockedId,
            followingId: blockerId,
          },
        }),
      ])

      await Promise.all([
        ...(blockingFollow.count > 0
          ? [
              tx.user.update({
                where: { id: blockerId },
                data: { followingCount: { decrement: blockingFollow.count } },
                select: { id: true },
              }),
              tx.user.update({
                where: { id: blockedId },
                data: { followerCount: { decrement: blockingFollow.count } },
                select: { id: true },
              }),
            ]
          : []),
        ...(blockedByFollow.count > 0
          ? [
              tx.user.update({
                where: { id: blockedId },
                data: { followingCount: { decrement: blockedByFollow.count } },
                select: { id: true },
              }),
              tx.user.update({
                where: { id: blockerId },
                data: { followerCount: { decrement: blockedByFollow.count } },
                select: { id: true },
              }),
            ]
          : []),
      ])
    })

    return {
      isBlockedByMe: true,
    }
  }

  async unblock(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException("You cannot unblock yourself")
    }

    await this.prisma.user.findUniqueOrThrow({
      where: { id: blockedId },
      select: { id: true },
    })

    await this.prisma.userBlock.deleteMany({
      where: {
        blockerId,
        blockedId,
      },
    })

    return {
      isBlockedByMe: false,
    }
  }

  async getBlocks(userId: string, cursor?: number | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    const blocks = await this.prisma.userBlock.findMany({
      ...pagination,
      take,
      where: {
        blockerId: userId,
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

    return blocks.map((item) => ({
      id: item.blocked.id,
      nickname: item.blocked.nickname,
      profileImageUrl: this.toPublicProfileImageUrl(item.blocked.profileImageUrl),
      cursor: item.id,
    }))
  }

  async update(userId: string, updateUserDto: UpdateUserDto) {
    const { favoritePersonalities, favoriteAppearances, ...rest } = updateUserDto
    const normalizedRest = this.normalizeProfileImageUrl(rest)

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...normalizedRest,
        ...(favoritePersonalities !== undefined && {
          favoritePersonalities: {
            set: favoritePersonalities.map((id) => ({ id })),
          },
        }),
        ...(favoriteAppearances !== undefined && {
          favoriteAppearances: {
            set: favoriteAppearances.map((id) => ({ id })),
          },
        }),
      },
    })

    return this.formatProfileImage(user)
  }

  async remove(userId: string) {
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "user"
        WHERE "id" = ${userId}
        FOR UPDATE
      `

      const [followers, followings] = await Promise.all([
        tx.follow.findMany({
          where: { followingId: userId },
          select: { followerId: true },
        }),
        tx.follow.findMany({
          where: { followerId: userId },
          select: { followingId: true },
        }),
      ])

      const affectedUserIds = [
        ...followers.map((item) => item.followerId),
        ...followings.map((item) => item.followingId),
      ].filter((id) => id !== userId)

      const deletedUser = await tx.user.delete({ where: { id: userId } })

      await this.syncFollowCounts(tx, affectedUserIds)

      return deletedUser
    })

    return this.formatProfileImage(user)
  }

  async getProfileImageUploadUrl(userId: string, contentType?: string) {
    if (!contentType) {
      throw new BadRequestException("contentType required")
    }
    const ext = getImageExtension(contentType)
    if (!ext) {
      throw new BadRequestException("Only image content types are allowed: jpeg, png, webp, avif")
    }
    const unique = uuidv7()
    const objectKey = `users/${userId}/profile/${unique}.${ext}`

    const { url, fields } = await this.storage.getPresignedUploadUrl(this.bucket, objectKey, {
      contentType,
      expiresInSeconds: 60 * 2,
      maxSizeBytes: 5 * 1024 * 1024,
    })

    return { url, fields }
  }
}
