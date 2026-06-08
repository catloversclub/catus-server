jest.mock("@app/notification/notification.service", () => ({
  NotificationService: class NotificationService {},
}))
jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}))

import { CommentService } from "./comment.service"
import { ForbiddenException } from "@nestjs/common"
import axios from "axios"

describe("CommentService", () => {
  const prisma: any = {
    $transaction: jest.fn(async (operations: any): Promise<unknown> => {
      if (Array.isArray(operations)) {
        return Promise.all(operations)
      }

      return operations(prisma)
    }),
    post: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
    },
    user: {
      findUniqueOrThrow: jest.fn(),
    },
    comment: {
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    commentReport: {
      create: jest.fn(),
      count: jest.fn(),
    },
    getPaginator: jest.fn(),
  }
  const storage = {
    getPublicUrl: jest.fn((value: string) => `https://storage.catus.app/catus-media/${value}`),
  }
  const config = {
    get: jest.fn((key: string) =>
      key === "DISCORD_WEBHOOK_URL_REPORT" ? "https://discord.example/report" : undefined,
    ),
  }

  const service = new CommentService(prisma as any, {} as any, storage as any, config as any)

  const visibleUserWhere = (viewerId: string) => ({
    blocking: {
      none: {
        blockedId: viewerId,
      },
    },
    blockedBy: {
      none: {
        blockerId: viewerId,
      },
    },
  })

  const visiblePostWhere = (viewerId: string) => ({
    author: visibleUserWhere(viewerId),
    OR: [
      {
        postCats: { none: {} },
      },
      {
        postCats: {
          some: {
            cat: {
              butler: visibleUserWhere(viewerId),
            },
          },
        },
      },
    ],
  })

  beforeEach(() => {
    jest.clearAllMocks()
    prisma.getPaginator.mockReturnValue({})
  })

  it("filters comments and replies by block visibility", async () => {
    prisma.post.findFirstOrThrow.mockResolvedValue({ id: "post-id" })
    prisma.comment.findMany.mockResolvedValueOnce([
      {
        id: "comment-id",
        parentId: null,
        commentLikes: [],
      },
    ])
    prisma.comment.findMany.mockResolvedValueOnce([])

    await service.getPostComments("post-id", "viewer-id")

    expect(prisma.post.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        id: "post-id",
        ...visiblePostWhere("viewer-id"),
      },
      select: { id: true },
    })
    expect(prisma.comment.findMany).toHaveBeenNthCalledWith(1, {
      take: 20,
      where: {
        postId: "post-id",
        parentId: null,
        author: visibleUserWhere("viewer-id"),
        post: expect.any(Object),
      },
      orderBy: { id: "desc" },
      include: expect.any(Object),
    })
    expect(prisma.comment.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        parentId: { in: ["comment-id"] },
        author: visibleUserWhere("viewer-id"),
        post: expect.any(Object),
      },
      orderBy: { id: "asc" },
      include: expect.any(Object),
    })
  })

  it("rejects creating a comment when the post has comments disabled", async () => {
    prisma.post.findFirst.mockResolvedValue({
      id: "post-id",
      authorId: "post-author-id",
      isCommentable: false,
    })
    prisma.user.findUniqueOrThrow.mockResolvedValue({ nickname: "actor" })

    await expect(
      service.create("post-id", "comment-author-id", { content: "blocked" }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("deletes a comment only when the requester is the author", async () => {
    prisma.comment.deleteMany.mockResolvedValueOnce({ count: 1 })

    await service.delete("comment-id", "author-id")

    expect(prisma.comment.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "comment-id",
        authorId: "author-id",
      },
    })
  })

  it("rejects deleting another user's comment", async () => {
    prisma.comment.deleteMany.mockResolvedValueOnce({ count: 0 })

    await expect(service.delete("comment-id", "requester-id")).rejects.toBeInstanceOf(
      ForbiddenException,
    )

    expect(prisma.comment.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "comment-id",
        authorId: "requester-id",
      },
    })
  })

  it("reports a comment and sends the report webhook", async () => {
    prisma.commentReport.create.mockResolvedValueOnce({
      reporter: {
        nickname: "reporter",
      },
      comment: {
        id: "comment-id",
        content: "reported comment",
        author: {
          nickname: "comment author",
        },
        post: {
          id: "post-id",
          content: "post content",
        },
      },
    })
    prisma.commentReport.count.mockResolvedValueOnce(3)
    ;(axios.post as jest.Mock).mockResolvedValueOnce({})

    await service.reportComment("comment-id", "reporter-id")

    expect(prisma.commentReport.create).toHaveBeenCalledWith({
      data: {
        commentId: "comment-id",
        reporterId: "reporter-id",
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
    })
    expect(prisma.commentReport.count).toHaveBeenCalledWith({
      where: {
        commentId: "comment-id",
      },
    })
    expect(axios.post).toHaveBeenCalledWith(
      "https://discord.example/report",
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "🚨 댓글 신고 접수",
            fields: expect.arrayContaining([
              {
                name: "댓글 ID",
                value: "`comment-id`",
                inline: false,
              },
              {
                name: "게시글 ID",
                value: "`post-id`",
                inline: false,
              },
              {
                name: "작성자",
                value: "comment author",
                inline: true,
              },
              {
                name: "신고자",
                value: "reporter",
                inline: true,
              },
              {
                name: "누적 신고 수",
                value: "3",
                inline: true,
              },
              {
                name: "댓글 내용",
                value: "reported comment",
                inline: false,
              },
              {
                name: "게시글 내용",
                value: "post content",
                inline: false,
              },
            ]),
            footer: {
              text: "Comment Report Webhook",
            },
          }),
        ],
      }),
    )
  })

  it("truncates long report field values for Discord", async () => {
    const longContent = "a".repeat(1030)
    prisma.commentReport.create.mockResolvedValueOnce({
      reporter: {
        nickname: "reporter",
      },
      comment: {
        id: "comment-id",
        content: longContent,
        author: {
          nickname: "comment author",
        },
        post: {
          id: "post-id",
          content: null,
        },
      },
    })
    prisma.commentReport.count.mockResolvedValueOnce(1)
    ;(axios.post as jest.Mock).mockResolvedValueOnce({})

    await service.reportComment("comment-id", "reporter-id")

    expect(axios.post).toHaveBeenCalledWith(
      "https://discord.example/report",
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              {
                name: "댓글 내용",
                value: `${"a".repeat(1021)}...`,
                inline: false,
              },
              {
                name: "게시글 내용",
                value: "(내용 없음)",
                inline: false,
              },
            ]),
          }),
        ],
      }),
    )
  })
})
