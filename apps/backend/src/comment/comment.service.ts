import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import { PrismaService } from "@app/prisma/prisma.service"
import { NotificationService } from "@app/notification/notification.service"
import { getVisibleUserWhere } from "@app/common/user-block-visibility"
import { CreateCommentDto } from "./dto/create-comment.dto"
import { StorageService } from "@app/storage/storage.service"

type ProfileImageOwner = {
  profileImageUrl: string | null
}

@Injectable()
export class CommentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly storage: StorageService,
  ) {}

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
    return {
      author: getVisibleUserWhere(viewerId),
      OR: [
        {
          catId: null,
        },
        {
          cat: {
            butler: getVisibleUserWhere(viewerId),
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
        select: { id: true, authorId: true },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: authorId },
        select: { nickname: true },
      }),
    ])

    if (!post) {
      throw new BadRequestException("post not found")
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
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      select: { authorId: true },
    })

    if (!comment || comment.authorId !== userId) {
      throw new ForbiddenException("This is not your comment")
    }

    await this.prisma.comment.delete({ where: { id } })
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
}
