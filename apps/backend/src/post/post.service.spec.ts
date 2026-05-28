import { BadRequestException } from "@nestjs/common"
import { PostService } from "./post.service"

jest.mock("@app/notification/notification.service", () => ({
  NotificationService: class NotificationService {},
}))

describe("PostService", () => {
  const prisma = {
    postLike: {
      groupBy: jest.fn(),
    },
    post: {
      findMany: jest.fn(),
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
})
