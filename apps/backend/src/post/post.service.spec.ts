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
      findMany: jest.fn(),
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
    postImage: {
      createMany: jest.fn(),
    },
  }

  const storage = {
    getPublicUrl: jest.fn((value: string | null | undefined) => value ?? null),
    getObjectKey: jest.fn((value: string | null | undefined) => {
      if (!value) {
        return null
      }

      return value.replace("https://storage.catus.app/catus-media/", "")
    }),
    copyObject: jest.fn(),
  }

  const service = new PostService(
    prisma as any,
    storage as any,
    { get: jest.fn() } as any,
    {} as any,
  )

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

  const buildPost = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    likeCount: 0,
    content: null,
    isShareable: true,
    isCommentable: true,
    createdAt: new Date("2026-05-28T00:00:00.000Z"),
    updatedAt: new Date("2026-05-28T00:00:00.000Z"),
    authorId: "author-id",
    postCats: [],
    author: {
      id: "author-id",
      nickname: "author",
      profileImageUrl: null,
    },
    images: [],
    likes: [],
    bookmarks: [],
    ...overrides,
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
        post: visiblePostWhere("viewer-id"),
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

  it("only allows creating a post with the author's own cats", async () => {
    prisma.cat.findMany.mockResolvedValue([{ id: "cat-a" }, { id: "cat-b" }])
    prisma.post.create.mockResolvedValue({ id: "post-id" })
    prisma.post.findUniqueOrThrow.mockResolvedValue(buildPost("post-id"))

    await service.create("author-id", {
      catIds: ["cat-a", "cat-a", "cat-b"],
      isShareable: false,
      isCommentable: false,
    })

    expect(prisma.cat.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["cat-a", "cat-b"],
        },
        butlerId: "author-id",
      },
      select: { id: true },
    })
    expect(prisma.post.create).toHaveBeenCalledWith({
      data: {
        content: null,
        authorId: "author-id",
        isShareable: false,
        isCommentable: false,
        postCats: {
          createMany: {
            data: [
              { catId: "cat-a", order: 1 },
              { catId: "cat-b", order: 2 },
            ],
          },
        },
      },
    })
  })

  it("only allows updating a post to the author's own cats", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: "author-id" })
    prisma.cat.findMany.mockResolvedValue([{ id: "cat-a" }, { id: "cat-b" }])
    prisma.post.update.mockResolvedValue(buildPost("post-id"))

    await service.update("post-id", "author-id", { catIds: ["cat-a", "cat-b"] })

    expect(prisma.cat.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["cat-a", "cat-b"],
        },
        butlerId: "author-id",
      },
      select: { id: true },
    })
    expect(prisma.post.update).toHaveBeenCalledWith({
      where: { id: "post-id" },
      data: {
        postCats: {
          deleteMany: {},
          createMany: {
            data: [
              { catId: "cat-a", order: 1 },
              { catId: "cat-b", order: 2 },
            ],
          },
        },
      },
      include: expect.any(Object),
    })
  })

  it("keeps post images unchanged when imageUrls is omitted", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: "author-id" })
    prisma.post.update.mockResolvedValue(buildPost("post-id"))

    await service.update("post-id", "author-id", { content: "Updated content" })

    const updateArgs = prisma.post.update.mock.calls[0][0]
    expect(updateArgs.data).not.toHaveProperty("images")
    expect(storage.getObjectKey).not.toHaveBeenCalled()
    expect(storage.copyObject).not.toHaveBeenCalled()
  })

  it("replaces post images when imageUrls is provided", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: "author-id" })
    prisma.post.update.mockResolvedValue(
      buildPost("post-id", {
        images: [
          {
            id: "image-id",
            postId: "post-id",
            url: "posts/post-id/images/new.webp",
            order: 1,
          },
        ],
      }),
    )

    await service.update("post-id", "author-id", {
      imageUrls: ["https://storage.catus.app/catus-media/tmp/post/author-id/new.webp"],
    })

    expect(storage.copyObject).toHaveBeenCalledWith(
      "catus-media",
      "tmp/post/author-id/new.webp",
      "posts/post-id/images/new.webp",
    )
    expect(prisma.post.update).toHaveBeenCalledWith({
      where: { id: "post-id" },
      data: {
        images: {
          deleteMany: {},
          createMany: {
            data: [
              {
                url: "posts/post-id/images/new.webp",
                order: 1,
              },
            ],
          },
        },
      },
      include: expect.any(Object),
    })
  })

  it("clears post images when imageUrls is an empty array", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: "author-id" })
    prisma.post.update.mockResolvedValue(buildPost("post-id"))

    await service.update("post-id", "author-id", { imageUrls: [] })

    expect(storage.copyObject).not.toHaveBeenCalled()
    expect(prisma.post.update).toHaveBeenCalledWith({
      where: { id: "post-id" },
      data: {
        images: {
          deleteMany: {},
        },
      },
      include: expect.any(Object),
    })
  })

  it("keeps existing post image urls when they are included in imageUrls", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: "author-id" })
    prisma.post.update.mockResolvedValue(
      buildPost("post-id", {
        images: [
          {
            id: "image-id",
            postId: "post-id",
            url: "posts/post-id/images/existing.webp",
            order: 1,
          },
        ],
      }),
    )

    await service.update("post-id", "author-id", {
      imageUrls: ["https://storage.catus.app/catus-media/posts/post-id/images/existing.webp"],
    })

    expect(storage.copyObject).not.toHaveBeenCalled()
    expect(prisma.post.update).toHaveBeenCalledWith({
      where: { id: "post-id" },
      data: {
        images: {
          deleteMany: {},
          createMany: {
            data: [
              {
                url: "posts/post-id/images/existing.webp",
                order: 1,
              },
            ],
          },
        },
      },
      include: expect.any(Object),
    })
  })

  it("filters the following feed to posts for selected followed cats", async () => {
    prisma.post.findMany.mockResolvedValue([])

    await expect(service.getFollowingFeed("viewer-id", null, 20)).resolves.toEqual([])

    expect(prisma.post.findMany).toHaveBeenCalledWith({
      take: 20,
      where: {
        author: {
          ...visibleUserWhere("viewer-id"),
          followers: {
            some: {
              followerId: "viewer-id",
            },
          },
        },
        postCats: {
          some: {
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
        },
      },
      orderBy: { id: "desc" },
      include: expect.any(Object),
    })
  })
})
