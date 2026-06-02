jest.mock("@app/notification/notification.service", () => ({
  NotificationService: class NotificationService {},
}))

import { CommentService } from "./comment.service"

describe("CommentService", () => {
  const prisma = {
    post: {
      findFirstOrThrow: jest.fn(),
    },
    comment: {
      findMany: jest.fn(),
    },
    getPaginator: jest.fn(),
  }
  const storage = {
    getPublicUrl: jest.fn((value: string) => `https://storage.catus.app/catus-media/${value}`),
  }

  const service = new CommentService(prisma as any, {} as any, storage as any)

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
        author: {
          blocking: {
            none: {
              blockedId: "viewer-id",
            },
          },
          blockedBy: {
            none: {
              blockerId: "viewer-id",
            },
          },
        },
        OR: [
          {
            catId: null,
          },
          {
            cat: {
              butler: {
                blocking: {
                  none: {
                    blockedId: "viewer-id",
                  },
                },
                blockedBy: {
                  none: {
                    blockerId: "viewer-id",
                  },
                },
              },
            },
          },
        ],
      },
      select: { id: true },
    })
    expect(prisma.comment.findMany).toHaveBeenNthCalledWith(1, {
      take: 20,
      where: {
        postId: "post-id",
        parentId: null,
        author: {
          blocking: {
            none: {
              blockedId: "viewer-id",
            },
          },
          blockedBy: {
            none: {
              blockerId: "viewer-id",
            },
          },
        },
        post: expect.any(Object),
      },
      orderBy: { id: "desc" },
      include: expect.any(Object),
    })
    expect(prisma.comment.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        parentId: { in: ["comment-id"] },
        author: {
          blocking: {
            none: {
              blockedId: "viewer-id",
            },
          },
          blockedBy: {
            none: {
              blockerId: "viewer-id",
            },
          },
        },
        post: expect.any(Object),
      },
      orderBy: { id: "asc" },
      include: expect.any(Object),
    })
  })
})
