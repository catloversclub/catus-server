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
  const storage = {
    getPublicUrl: jest.fn((value: string) => `https://storage.catus.app/catus-media/${value}`),
  }

  const service = new SearchService(prisma as any, storage as any)

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

  it("filters post search results by block visibility", async () => {
    prisma.post.findMany.mockResolvedValue([])

    await service.search("viewer-id", {
      type: SearchTypeDto.POST,
      query: "cat",
    } as any)

    expect(prisma.post.findMany).toHaveBeenCalledWith({
      take: 20,
      where: {
        ...visiblePostWhere("viewer-id"),
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
        ...visibleUserWhere("viewer-id"),
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
        butler: visibleUserWhere("viewer-id"),
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
