import { CatService } from "./cat.service"

describe("CatService", () => {
  const buildService = (prisma: any) =>
    new CatService(prisma, { getPublicUrl: jest.fn((value: string) => value) } as any, {
      get: jest.fn(),
    } as any)

  it("returns user cats with my followed state", async () => {
    const prisma = {
      user: {
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: "following-id" }),
      },
      cat: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "cat-a",
            name: "A",
            profileImageUrl: null,
            appearances: [{ id: 1 }],
            personalities: [{ id: 2 }],
          },
          {
            id: "cat-b",
            name: "B",
            profileImageUrl: null,
            appearances: [],
            personalities: [],
          },
        ]),
      },
      follow: {
        findUnique: jest.fn().mockResolvedValue({
          followedCats: [{ catId: "cat-b" }],
        }),
      },
    }
    const service = buildService(prisma)

    await expect(service.getUserCats("following-id", "viewer-id")).resolves.toEqual([
      {
        id: "cat-a",
        name: "A",
        profileImageUrl: null,
        appearances: [1],
        personalities: [2],
        isFollowedByMe: false,
      },
      {
        id: "cat-b",
        name: "B",
        profileImageUrl: null,
        appearances: [],
        personalities: [],
        isFollowedByMe: true,
      },
    ])
    expect(prisma.follow.findUnique).toHaveBeenCalledWith({
      where: {
        followerId_followingId: {
          followerId: "viewer-id",
          followingId: "following-id",
        },
      },
      select: {
        followedCats: {
          select: {
            catId: true,
          },
        },
      },
    })
  })
})
