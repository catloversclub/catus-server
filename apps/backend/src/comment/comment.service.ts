import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import { PrismaService } from "@app/prisma/prisma.service"
import { NotificationService } from "@app/notification/notification.service"
import { getVisibleUserWhere } from "@app/common/user-block-visibility"
import { CreateCommentDto } from "./dto/create-comment.dto"
import { StorageService } from "@app/storage/storage.service"
import { ConfigService } from "@nestjs/config"
import axios from "axios"

type ProfileImageOwner = {
  profileImageUrl: string | null
}

@Injectable()
export class CommentService {
  private readonly webhookUrl: string
  private static readonly DISCORD_FIELD_VALUE_MAX_LENGTH = 1024

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    this.webhookUrl = this.config.get<string>("DISCORD_WEBHOOK_URL_REPORT")!
  }

  private toPublicProfileImageUrl(value: string | null) {
    return value ? this.storage.getPublicUrl(value) : value
  }

  private formatProfileImage<T extends ProfileImageOwner>(item: T): T {
    return {
      ...item,
      profileImageUrl: this.toPublicProfileImageUrl(item.profileImageUrl),
    }
  }

  private formatCommentAuthor<T extends { author?: ProfileImageOwner }>(comment: T): T {
    if (!comment.author) {
      return comment
    }

    return {
      ...comment,
      author: this.formatProfileImage(comment.author),
    }
  }

  private getVisiblePostWhere(viewerId: string) {
    const visibleUserWhere = getVisibleUserWhere(viewerId)

    return {
      author: visibleUserWhere,
      OR: [
        {
          postCats: { none: {} },
        },
        {
          postCats: {
            some: {
              cat: {
                butler: visibleUserWhere,
              },
            },
          },
        },
      ],
    }
  }

  private getVisibleCommentWhere(viewerId: string) {
    return {
      author: getVisibleUserWhere(viewerId),
      post: this.getVisiblePostWhere(viewerId),
    }
  }

  private toDiscordFieldValue(value: string | null | undefined, fallback = "(내용 없음)") {
    const text = value?.trim() ? value : fallback

    if (text.length <= CommentService.DISCORD_FIELD_VALUE_MAX_LENGTH) {
      return text
    }

    return `${text.slice(0, CommentService.DISCORD_FIELD_VALUE_MAX_LENGTH - 3)}...`
  }

  async create(postId: string, authorId: string, dto: CreateCommentDto) {
    const { content, parentId } = dto
    if (!content?.trim()) {
      throw new BadRequestException("content is required")
    }

    const [post, actor] = await Promise.all([
      this.prisma.post.findFirst({
        where: {
          id: postId,
          ...this.getVisiblePostWhere(authorId),
        },
        select: { id: true, authorId: true, isCommentable: true },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: authorId },
        select: { nickname: true },
      }),
    ])

    if (!post) {
      throw new BadRequestException("post not found")
    }

    if (!post.isCommentable) {
      throw new ForbiddenException("comments are disabled for this post")
    }

    let normalizedParentId: string | null = null
    let parent: { id: string; postId: string; authorId: string } | null = null

    if (parentId) {
      parent = await this.prisma.comment.findFirst({
        where: {
          id: parentId,
          postId,
          ...this.getVisibleCommentWhere(authorId),
        },
        select: { id: true, postId: true, authorId: true },
      })
      if (!parent || parent.postId !== postId) {
        throw new BadRequestException("invalid parent comment")
      }
      normalizedParentId = parentId
    }

    const comment = await this.prisma.comment.create({
      data: {
        content,
        postId,
        authorId,
        parentId: normalizedParentId,
      },
      include: {
        author: {
          select: {
            id: true,
            nickname: true,
            profileImageUrl: true,
          },
        },
      },
    })

    if (parent) {
      await this.notificationService.sendReplyNotification({
        recipientId: parent.authorId,
        actorId: authorId,
        actorNickname: actor.nickname,
        postId,
        commentId: comment.id,
        parentCommentId: parent.id,
        content,
      })
    } else {
      await this.notificationService.sendCommentNotification({
        recipientId: post.authorId,
        actorId: authorId,
        actorNickname: actor.nickname,
        postId,
        commentId: comment.id,
        content,
      })
    }

    return this.formatCommentAuthor(comment)
  }

  async getPostComments(postId: string, userId: string, cursor?: string | null, take = 20) {
    const pagination = this.prisma.getPaginator(cursor ?? null)

    await this.prisma.post.findFirstOrThrow({
      where: {
        id: postId,
        ...this.getVisiblePostWhere(userId),
      },
      select: { id: true },
    })

    const parents = await this.prisma.comment.findMany({
      ...pagination,
      take,
      where: {
        postId,
        parentId: null,
        ...this.getVisibleCommentWhere(userId),
      },
      orderBy: { id: "desc" },
      include: {
        author: {
          select: {
            id: true,
            nickname: true,
            profileImageUrl: true,
          },
        },
        commentLikes: {
          where: { userId },
          select: { userId: true },
        },
      },
    })

    if (parents.length === 0) {
      return []
    }

    const parentIds = parents.map((c) => c.id)

    const replies = await this.prisma.comment.findMany({
      where: {
        parentId: { in: parentIds },
        ...this.getVisibleCommentWhere(userId),
      },
      orderBy: { id: "asc" },
      include: {
        author: {
          select: {
            id: true,
            nickname: true,
            profileImageUrl: true,
          },
        },
        commentLikes: {
          where: { userId },
          select: { userId: true },
        },
      },
    })

    const replyMap = new Map<string, any[]>()

    for (const reply of replies) {
      const enriched = {
        ...reply,
        isLikedByMe: reply.commentLikes.length > 0,
      }

      if (!replyMap.has(reply.parentId!)) {
        replyMap.set(reply.parentId!, [])
      }
      replyMap.get(reply.parentId!)!.push(this.formatCommentAuthor(enriched))
    }

    return parents.map((comment) => ({
      ...this.formatCommentAuthor(comment),
      isLikedByMe: comment.commentLikes.length > 0,
      replies: replyMap.get(comment.id) ?? [],
    }))
  }

  async delete(id: string, userId: string) {
    const result = await this.prisma.comment.deleteMany({
      where: { id, authorId: userId },
    })

    if (result.count === 0) {
      throw new ForbiddenException("This is not your comment")
    }
  }

  async likeComment(commentId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.findFirst({
        where: {
          id: commentId,
          ...this.getVisibleCommentWhere(userId),
        },
        select: { id: true },
      })

      if (!comment) {
        throw new BadRequestException("comment not found")
      }

      let likeCount: number

      try {
        await tx.commentLike.create({
          data: {
            commentId,
            userId,
          },
        })

        const updated = await tx.comment.update({
          where: { id: commentId },
          data: { likeCount: { increment: 1 } },
          select: { likeCount: true },
        })

        likeCount = updated.likeCount
      } catch (err: any) {
        if (err.code !== "P2002") {
          throw err
        }

        const current = await tx.comment.findUniqueOrThrow({
          where: { id: commentId },
          select: { likeCount: true },
        })

        likeCount = current.likeCount
      }

      return {
        likeCount,
      }
    })
  }

  async unlikeComment(commentId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.findFirst({
        where: {
          id: commentId,
          ...this.getVisibleCommentWhere(userId),
        },
        select: { id: true },
      })

      if (!comment) {
        throw new BadRequestException("comment not found")
      }

      let likeCount: number

      const existing = await tx.commentLike.findUnique({
        where: {
          commentId_userId: {
            commentId,
            userId,
          },
        },
      })

      if (!existing) {
        const current = await tx.comment.findUniqueOrThrow({
          where: { id: commentId },
          select: { likeCount: true },
        })

        return {
          likeCount: current.likeCount,
        }
      }

      await tx.commentLike.delete({
        where: {
          commentId_userId: {
            commentId,
            userId,
          },
        },
      })

      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      })

      likeCount = updated.likeCount

      return {
        likeCount,
      }
    })
  }

  async reportComment(id: string, reporterId: string) {
    const [reportResult, reportCount] = await this.prisma.$transaction([
      this.prisma.commentReport.create({
        data: {
          commentId: id,
          reporterId,
        },
        select: {
          reporter: {
            select: {
              nickname: true,
            },
          },
          comment: {
            select: {
              id: true,
              content: true,
              author: {
                select: {
                  nickname: true,
                },
              },
              post: {
                select: {
                  id: true,
                  content: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.commentReport.count({
        where: {
          commentId: id,
        },
      }),
    ])

    await axios.post(this.webhookUrl, {
      embeds: [
        {
          title: "🚨 댓글 신고 접수",
          color: 0xff3b30,
          fields: [
            {
              name: "댓글 ID",
              value: `\`${reportResult.comment.id}\``,
              inline: false,
            },
            {
              name: "게시글 ID",
              value: `\`${reportResult.comment.post.id}\``,
              inline: false,
            },
            {
              name: "작성자",
              value: reportResult.comment.author.nickname,
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
              name: "댓글 내용",
              value: this.toDiscordFieldValue(reportResult.comment.content),
              inline: false,
            },
            {
              name: "게시글 내용",
              value: this.toDiscordFieldValue(reportResult.comment.post.content),
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: "Comment Report Webhook",
          },
        },
      ],
    })
  }
}
