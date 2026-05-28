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
import type { Provider } from "@prisma/client"

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

  create(createUserDto: CreateUserDto, identity: { provider: Provider; id: string }) {
    const { favoritePersonalities, favoriteAppearances, ...rest } = createUserDto

    const data: any = {
      ...rest,
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

    return this.prisma.user.create({
      data,
    })
  }

  async checkNickname(nickname: string) {
    const nicknameTaken = await this.prisma.user.findUnique({
      where: { nickname },
      select: { hasAgreedToTerms: true },
    })

    return { available: !nicknameTaken }
  }

  getMe(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        favoriteAppearances: true,
        favoritePersonalities: true,
      },
    })
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
      isFollowing: followers.length > 0,
    }
  }

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException("You cannot follow yourself")
    }

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

      await tx.follow.create({
        data: { followerId, followingId },
      })

      const [follower, target] = await Promise.all([
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
        notification: {
          recipientId: followingId,
          followerId,
          followerNickname: followerUser.nickname,
        },
      }
    })

    await this.notificationService.sendNewFollowerNotification(result.notification)

    return {
      follower: result.follower,
      target: result.target,
    }
  }

  async unfollow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException("You cannot unfollow yourself")
    }

    return this.prisma.$transaction(async (tx) => {
      await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: followerId }, select: { id: true } }),
        tx.user.findUniqueOrThrow({ where: { id: followingId }, select: { id: true } }),
      ])

      await tx.follow.delete({
        where: {
          followerId_followingId: { followerId, followingId },
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
      profileImageUrl: item.follower.profileImageUrl,
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
      profileImageUrl: item.following.profileImageUrl,
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
      profileImageUrl: item.blocked.profileImageUrl,
      cursor: item.id,
    }))
  }

  update(userId: string, updateUserDto: UpdateUserDto) {
    const { favoritePersonalities, favoriteAppearances, ...rest } = updateUserDto

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...rest,
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
  }

  remove(userId: string) {
    return this.prisma.user.delete({ where: { id: userId } })
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
