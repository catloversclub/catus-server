import { SearchService } from "./search.service"
import { SearchTypeDto } from "./dto/search-query.dto"

describe("SearchService", () => {
  const prisma = {
    post: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    cat: {
      findMany: jest.fn(),
    },
    getPaginator: jest.fn(),
  }

  const service = new SearchService(prisma as any)

  beforeEach(() => {
    jest.clearAllMocks()
    prisma.getPaginator.mockReturnValue({})
  })

  it("filters post search results by block visibility", async () => {
    prisma.post.findMany.mockResolvedValue([])

    await service.search("viewer-id", {
      type: SearchTypeDto.POST,
      query: "cat",
    } as any)

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
        content: {
          startsWith: "cat",
          mode: "insensitive",
        },
      },
      orderBy: { id: "desc" },
      include: expect.any(Object),
    })
  })

  it("filters profile search users and cats by block visibility", async () => {
    prisma.user.findMany.mockResolvedValue([])
    prisma.cat.findMany.mockResolvedValue([])

    await service.search("viewer-id", {
      type: SearchTypeDto.PROFILE,
      query: "cat",
    } as any)

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      take: 20,
      where: {
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
        nickname: {
          startsWith: "cat",
          mode: "insensitive",
        },
      },
      orderBy: { id: "desc" },
      select: {
        id: true,
        nickname: true,
        profileImageUrl: true,
        followerCount: true,
        followingCount: true,
      },
    })
    expect(prisma.cat.findMany).toHaveBeenCalledWith({
      take: 20,
      where: {
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
        OR: [
          {
            name: {
              startsWith: "cat",
              mode: "insensitive",
            },
          },
          {
            breed: {
              startsWith: "cat",
              mode: "insensitive",
            },
          },
        ],
      },
      orderBy: { id: "desc" },
      select: expect.any(Object),
    })
  })
})
