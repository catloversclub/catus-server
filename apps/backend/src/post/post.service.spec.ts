import { BadRequestException } from "@nestjs/common"
import { PostService } from "./post.service"

jest.mock("@app/notification/notification.service", () => ({
  NotificationService: class NotificationService {},
}))

describe("PostService", () => {
  const prisma = {
    getPaginator: jest.fn(),
    cat: {
      findFirstOrThrow: jest.fn(),
    },
    postLike: {
      groupBy: jest.fn(),
    },
    post: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  }

  const service = new PostService(
    prisma as any,
    {} as any,
    { get: jest.fn() } as any,
    {} as any,
  )

  const buildPost = (id: string) => ({
    id,
    likeCount: 0,
    content: null,
    createdAt: new Date("2026-05-28T00:00:00.000Z"),
    updatedAt: new Date("2026-05-28T00:00:00.000Z"),
    authorId: "author-id",
    catId: null,
    cat: null,
    author: {
      id: "author-id",
      nickname: "author",
      profileImageUrl: null,
    },
    images: [],
    likes: [],
    bookmarks: [],
  })

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-05-28T04:15:00.000Z"))
    jest.clearAllMocks()
    prisma.getPaginator.mockReturnValue({})
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("returns posts ordered by today's like count in KST", async () => {
    prisma.postLike.groupBy.mockResolvedValue([
      { postId: "post-b", _count: { postId: 3 } },
      { postId: "post-a", _count: { postId: 2 } },
    ])
    prisma.post.findMany.mockResolvedValue([buildPost("post-a"), buildPost("post-b")])

    const result = await service.getDailyPopularFeed("viewer-id")

    expect(prisma.postLike.groupBy).toHaveBeenCalledWith({
      by: ["postId"],
      where: {
        createdAt: {
          gte: new Date("2026-05-27T15:00:00.000Z"),
          lt: new Date("2026-05-28T15:00:00.000Z"),
        },
        post: {
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
      take: 10,
    })
    expect(prisma.post.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["post-b", "post-a"],
        },
      },
      include: expect.any(Object),
    })
    expect(result.map((post) => ({ id: post.id, dailyLikeCount: post.dailyLikeCount }))).toEqual([
      { id: "post-b", dailyLikeCount: 3 },
      { id: "post-a", dailyLikeCount: 2 },
    ])
  })

  it("rejects a non-positive take value", async () => {
    await expect(service.getDailyPopularFeed("viewer-id", 0)).rejects.toThrow(BadRequestException)
    expect(prisma.postLike.groupBy).not.toHaveBeenCalled()
  })

  it("only allows creating a post with the author's own cat", async () => {
    prisma.cat.findFirstOrThrow.mockResolvedValue({ id: "cat-id" })
    prisma.post.create.mockResolvedValue({ id: "post-id" })
    prisma.post.findUniqueOrThrow.mockResolvedValue(buildPost("post-id"))

    await service.create("author-id", { catId: "cat-id" })

    expect(prisma.cat.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        id: "cat-id",
        butlerId: "author-id",
      },
      select: { id: true },
    })
  })

  it("only allows updating a post to the author's own cat", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: "author-id" })
    prisma.cat.findFirstOrThrow.mockResolvedValue({ id: "cat-id" })
    prisma.post.update.mockResolvedValue(buildPost("post-id"))

    await service.update("post-id", "author-id", { catId: "cat-id" })

    expect(prisma.cat.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        id: "cat-id",
        butlerId: "author-id",
      },
      select: { id: true },
    })
  })

  it("filters the following feed to posts for selected followed cats", async () => {
    prisma.post.findMany.mockResolvedValue([])

    await expect(service.getFollowingFeed("viewer-id", null, 20)).resolves.toEqual([])

    expect(prisma.post.findMany).toHaveBeenCalledWith({
      take: 20,
      where: {
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
          followers: {
            some: {
              followerId: "viewer-id",
            },
          },
        },
        cat: {
          followedBy: {
            some: {
              follow: {
                followerId: "viewer-id",
              },
            },
          },
        },
      },
      orderBy: { id: "desc" },
      include: expect.any(Object),
    })
  })
})
