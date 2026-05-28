import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import { CreatePostDto } from "./dto/create-post.dto"
import { UpdatePostDto } from "./dto/update-post.dto"
import { PrismaService } from "@app/prisma/prisma.service"
import { StorageService } from "@app/storage/storage.service"
import { ConfigService } from "@nestjs/config"
import { NotificationService } from "@app/notification/notification.service"
import { uuidv7 } from "uuidv7"
import axios from "axios"

type PostWithViewerState = {
  likes: Array<{ userId: string }>
  bookmarks: Array<{ userId: string }>
}

@Injectable()
export class PostService {
  private static readonly KST_OFFSET_MS = 9 * 60 * 60 * 1000
  private readonly bucket: string
  private readonly webhookUrl: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly notificationService: NotificationService,
  ) {
    this.bucket = this.config.get<string>("S3_BUCKET") ?? "catus-media"
    this.webhookUrl = this.config.get<string>("DISCORD_WEBHOOK_URL_REPORT")!
  }

  private getPostInclude(viewerId: string) {
    return {
      cat: true,
      author: {
        select: {
          id: true,
          nickname: true,
          profileImageUrl: true,
        },
      },
      images: true,
      likes: {
        where: { userId: viewerId },
        select: { userId: true },
      },
      bookmarks: {
        where: { userId: viewerId },
        select: { userId: true },
      },
    } as const
  }

  private attachViewerState<T extends PostWithViewerState>(post: T) {
    const { likes, bookmarks, ...rest } = post

    return {
      ...rest,
      isLikedByMe: likes.length > 0,
      isBookmarkedByMe: bookmarks.length > 0,
    }
  }

  private attachViewerStateList<T extends PostWithViewerState>(posts: T[]) {
    return posts.map((post) => this.attachViewerState(post))
  }

  private getTodayRangeInKst() {
    const now = new Date()
    const kstNow = new Date(now.getTime() + PostService.KST_OFFSET_MS)
    kstNow.setUTCHours(0, 0, 0, 0)

    const startAt = new Date(kstNow.getTime() - PostService.KST_OFFSET_MS)
    const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000)

    return { startAt, endAt }
  }

  async create(authorId: string, createPostDto: CreatePostDto) {
    const { catId, content, imageUrls } = createPostDto

    const post = await this.prisma.post.create({
      data: {
        content: content ?? null,
        authorId,
        catId: catId ?? null,
      },
    })

    try {
      if (imageUrls && imageUrls.length > 0) {
        const images = await Promise.all(
          imageUrls.map(async (tmpUrl, index) => {
            const prefix = `https://storage.catus.app/catus-media/`

            if (!tmpUrl.startsWith(`${prefix}tmp/post/${authorId}/`)) {
              throw new BadRequestException("invalid image key")
            }

            const tmpKey = tmpUrl.replace(prefix, "")

            const fileName = tmpKey.split("/").pop()
            if (!fileName) {
              throw new BadRequestException("invalid image key")
            }

            const destKey = `posts/${post.id}/images/${fileName}`

            await this.storage.copyObject(this.bucket, tmpKey, destKey)

            return {
              postId: post.id,
              url: destKey,
              order: index + 1,
            }
          }),
        )

        if (images.length > 0) {
          await this.prisma.postImage.createMany({
            data: images,
          })
        }
      }

      const createdPost = await this.prisma.post.findUniqueOrThrow({
        where: { id: post.id },
        include: this.getPostInclude(authorId),
      })

      return this.attachViewerState(createdPost)
    } catch (err) {
      await this.prisma.post.delete({
        where: { id: post.id },
      })
      throw err
    }
  }

  async getUserPosts(userId: string, viewerId: string, cursor?: string | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    const posts = await this.prisma.post.findMany({
      ...pagination,
      take,
      where: { authorId: userId },
      orderBy: { id: "desc" },
      include: this.getPostInclude(viewerId),
    })

    return this.attachViewerStateList(posts)
  }

  getMyPosts(viewerId: string, cursor?: string | null, take = 20) {
    return this.getUserPosts(viewerId, viewerId, cursor, take)
  }

  async getMyBookmarkedPosts(viewerId: string, cursor?: string | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    const posts = await this.prisma.post.findMany({
      ...pagination,
      take,
      where: {
        bookmarks: {
          some: {
            userId: viewerId,
          },
        },
      },
      orderBy: { id: "desc" },
      include: this.getPostInclude(viewerId),
    })

    return this.attachViewerStateList(posts)
  }

  async getMyLikedPosts(viewerId: string, cursor?: string | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    const posts = await this.prisma.post.findMany({
      ...pagination,
      take,
      where: {
        likes: {
          some: {
            userId: viewerId,
          },
        },
      },
      orderBy: { id: "desc" },
      include: this.getPostInclude(viewerId),
    })

    return this.attachViewerStateList(posts)
  }

  async getCatPosts(catId: string, viewerId: string, cursor?: string | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    const posts = await this.prisma.post.findMany({
      ...pagination,
      take,
      where: { catId },
      orderBy: { id: "desc" },
      include: this.getPostInclude(viewerId),
    })

    return this.attachViewerStateList(posts)
  }

  async getRecommendedFeed(userId: string, cursor?: string | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        favoriteAppearances: true,
        favoritePersonalities: true,
      },
    })

    const favoriteAppearanceIds = user.favoriteAppearances.map((a) => a.id)
    const favoritePersonalityIds = user.favoritePersonalities.map((p) => p.id)

    const posts = await this.prisma.post.findMany({
      ...pagination,
      take,
      where: {
        cat: {
          OR: [
            {
              appearances: {
                some: {
                  id: { in: favoriteAppearanceIds },
                },
              },
            },
            {
              personalities: {
                some: {
                  id: { in: favoritePersonalityIds },
                },
              },
            },
          ],
        },
      },
      orderBy: { id: "desc" },
      include: this.getPostInclude(userId),
    })

    return this.attachViewerStateList(posts)
  }

  async getFollowingFeed(userId: string, cursor?: string | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    const posts = await this.prisma.post.findMany({
      ...pagination,
      take,
      where: {
        author: {
          followers: {
            some: {
              followerId: userId,
            },
          },
        },
      },
      orderBy: { id: "desc" },
      include: this.getPostInclude(userId),
    })

    return this.attachViewerStateList(posts)
  }

  async getDailyPopularFeed(viewerId: string, take = 10) {
    if (take < 1) {
      throw new BadRequestException("take must be at least 1")
    }

    const { startAt, endAt } = this.getTodayRangeInKst()

    const dailyLikeCounts = await this.prisma.postLike.groupBy({
      by: ["postId"],
      where: {
        createdAt: {
          gte: startAt,
          lt: endAt,
        },
      },
      _count: {
        postId: true,
      },
      orderBy: [
        {
          _count: {
            postId: "desc",
          },
        },
        {
          postId: "desc",
        },
      ],
      take,
    })

    const postIds = dailyLikeCounts.map((dailyLikeCount) => dailyLikeCount.postId)

    if (postIds.length === 0) {
      return []
    }

    const posts = await this.prisma.post.findMany({
      where: {
        id: {
          in: postIds,
        },
      },
      include: this.getPostInclude(viewerId),
    })

    const postById = new Map(posts.map((post) => [post.id, post]))

    return dailyLikeCounts.flatMap((dailyLikeCount) => {
      const post = postById.get(dailyLikeCount.postId)

      if (!post) {
        return []
      }

      return [
        {
          ...this.attachViewerState(post),
          dailyLikeCount: dailyLikeCount._count.postId,
        },
      ]
    })
  }

  async findAll(viewerId: string, cursor?: string | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    const posts = await this.prisma.post.findMany({
      ...pagination,
      take,
      orderBy: { id: "desc" },
      include: this.getPostInclude(viewerId),
    })

    return this.attachViewerStateList(posts)
  }

  async findOne(id: string, viewerId: string) {
    const post = await this.prisma.post.findUniqueOrThrow({
      where: { id },
      include: this.getPostInclude(viewerId),
    })

    return this.attachViewerState(post)
  }

  private async assertMyPost(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      select: { authorId: true },
    })

    if (!post || post.authorId !== userId) {
      throw new ForbiddenException("This is not your post")
    }
  }

  async update(id: string, userId: string, updatePostDto: UpdatePostDto) {
    await this.assertMyPost(id, userId)

    const { catId, ...rest } = updatePostDto

    const post = await this.prisma.post.update({
      where: { id },
      data: {
        ...rest,
        ...(catId !== undefined && { catId: catId ?? null }),
      },
      include: this.getPostInclude(userId),
    })

    return this.attachViewerState(post)
  }

  async delete(id: string, userId: string) {
    await this.assertMyPost(id, userId)

    return this.prisma.post.delete({ where: { id } })
  }

  async likePost(postId: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const [post, actor] = await Promise.all([
        tx.post.findUnique({
          where: { id: postId },
          select: { id: true, authorId: true },
        }),
        tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { nickname: true },
        }),
      ])

      if (!post) {
        throw new BadRequestException("post not found")
      }

      let likeCount: number
      let shouldNotify = false

      try {
        await tx.postLike.create({
          data: { postId, userId },
        })

        const updated = await tx.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
          select: { likeCount: true },
        })

        likeCount = updated.likeCount
        shouldNotify = post.authorId !== userId
      } catch (err: any) {
        if (err.code !== "P2002") {
          throw err
        }

        const current = await tx.post.findUniqueOrThrow({
          where: { id: postId },
          select: { likeCount: true },
        })

        likeCount = current.likeCount
      }

      return {
        likeCount,
        notification: shouldNotify
          ? {
              recipientId: post.authorId,
              actorId: userId,
              actorNickname: actor.nickname,
              postId,
            }
          : null,
      }
    })

    if (result.notification) {
      await this.notificationService.sendPostLikeNotification(result.notification)
    }

    return {
      likeCount: result.likeCount,
    }
  }

  async unlikePost(postId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const post = await tx.post.findUnique({
        where: { id: postId },
        select: { id: true },
      })

      if (!post) {
        throw new BadRequestException("post not found")
      }

      let likeCount: number

      const existing = await tx.postLike.findUnique({
        where: {
          postId_userId: {
            postId,
            userId,
          },
        },
      })

      if (!existing) {
        const current = await tx.post.findUniqueOrThrow({
          where: { id: postId },
          select: { likeCount: true },
        })

        return {
          likeCount: current.likeCount,
        }
      }

      await tx.postLike.delete({
        where: {
          postId_userId: {
            postId,
            userId,
          },
        },
      })

      const updated = await tx.post.update({
        where: { id: postId },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      })

      likeCount = updated.likeCount

      return {
        likeCount,
      }
    })
  }

  async bookmarkPost(postId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const post = await tx.post.findUnique({
        where: { id: postId },
        select: { id: true },
      })

      if (!post) {
        throw new BadRequestException("post not found")
      }

      try {
        await tx.postBookmark.create({
          data: { postId, userId },
        })
      } catch (err: any) {
        if (err.code !== "P2002") {
          throw err
        }
      }

      return {
        isBookmarkedByMe: true,
      }
    })
  }

  async unbookmarkPost(postId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const post = await tx.post.findUnique({
        where: { id: postId },
        select: { id: true },
      })

      if (!post) {
        throw new BadRequestException("post not found")
      }

      const existing = await tx.postBookmark.findUnique({
        where: {
          postId_userId: {
            postId,
            userId,
          },
        },
      })

      if (!existing) {
        return {
          isBookmarkedByMe: false,
        }
      }

      await tx.postBookmark.delete({
        where: {
          postId_userId: {
            postId,
            userId,
          },
        },
      })

      return {
        isBookmarkedByMe: false,
      }
    })
  }

  async reportPost(id: string, reporterId: string) {
    const [reportResult, reportCount] = await this.prisma.$transaction([
      this.prisma.report.create({
        data: {
          postId: id,
          reporterId,
        },
        select: {
          reporter: {
            select: {
              nickname: true,
            },
          },
          post: {
            select: {
              id: true,
              content: true,
              author: {
                select: {
                  nickname: true,
                },
              },
              images: {
                select: {
                  url: true,
                  order: true,
                },
                orderBy: {
                  order: "asc",
                },
              },
            },
          },
        },
      }),
      this.prisma.report.count({
        where: {
          postId: id,
        },
      }),
    ])

    const imageUrls = reportResult.post.images.map((image) => image.url)
    const firstImageUrl = imageUrls[0]

    await axios.post(this.webhookUrl, {
      embeds: [
        {
          title: "🚨 게시글 신고 접수",
          color: 0xff3b30,
          fields: [
            {
              name: "게시글 ID",
              value: `\`${reportResult.post.id}\``,
              inline: false,
            },
            {
              name: "작성자",
              value: reportResult.post.author.nickname,
              inline: true,
            },
            {
              name: "신고자",
              value: reportResult.reporter.nickname,
              inline: true,
            },
            {
              name: "누적 신고 수",
              value: String(reportCount),
              inline: true,
            },
            {
              name: "게시글 내용",
              value: reportResult.post.content ?? "(내용 없음)",
              inline: false,
            },
            {
              name: "게시글 이미지",
              value:
                imageUrls.length > 0
                  ? imageUrls
                      .map((url, index) => `${index + 1}. ${url}`)
                      .join("\n")
                      .slice(0, 1024)
                  : "(이미지 없음)",
              inline: false,
            },
          ],
          ...(firstImageUrl
            ? {
                image: {
                  url: firstImageUrl,
                },
              }
            : {}),
          timestamp: new Date().toISOString(),
          footer: {
            text: "Post Report Webhook",
          },
        },
      ],
    })
  }

  async getImageUploadUrls(userId: string, count: number) {
    if (!count || count < 1) {
      throw new BadRequestException("count must be at least 1")
    }

    const uploads = await Promise.all(
      Array.from({ length: count }).map(async () => {
        const unique = uuidv7()
        const objectKey = `tmp/post/${userId}/${unique}.webp`

        const { url, fields } = await this.storage.getPresignedUploadUrl(this.bucket, objectKey, {
          contentType: "image/webp",
          expiresInSeconds: 60 * 2,
          maxSizeBytes: 5 * 1024 * 1024,
        })

        return { url, fields, key: objectKey }
      }),
    )

    return { uploads }
  }
}
