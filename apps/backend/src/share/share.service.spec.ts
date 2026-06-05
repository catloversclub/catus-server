import { ShareService } from "./share.service"

describe("ShareService", () => {
  const prisma = {
    post: {
      findUniqueOrThrow: jest.fn(),
    },
    user: {
      findUniqueOrThrow: jest.fn(),
    },
  }

  const storage = {
    getPublicUrl: jest.fn((value: string | null | undefined) =>
      value ? `https://cdn.catus.app/${value}` : null,
    ),
  }

  const service = new ShareService(prisma as any, storage as any)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("builds post OG HTML and redirects to the post deep link", async () => {
    prisma.post.findUniqueOrThrow.mockResolvedValue({
      content: "고양이 낮잠",
      author: {
        nickname: "nabi",
        profileImageUrl: "users/author/profile.webp",
      },
      images: [{ url: "posts/post-id/images/first.webp" }],
    })

    const html = await service.getPostShareHtml(
      "post-id",
      "https://api.catus.app/share/post/post-id",
    )

    expect(prisma.post.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "post-id" },
      select: {
        content: true,
        author: {
          select: {
            nickname: true,
            profileImageUrl: true,
          },
        },
        images: {
          orderBy: { order: "asc" },
          take: 1,
          select: {
            url: true,
          },
        },
      },
    })
    expect(html).toContain('<meta property="og:title" content="@nabi님의 게시물" />')
    expect(html).toContain('<meta property="og:description" content="고양이 낮잠" />')
    expect(html).toContain(
      '<meta property="og:image" content="https://cdn.catus.app/posts/post-id/images/first.webp" />',
    )
    expect(html).toContain(
      '<meta property="og:url" content="https://api.catus.app/share/post/post-id" />',
    )
    expect(html).toContain('<meta http-equiv="refresh" content="0;url=catus://post/post-id" />')
    expect(html).toContain('<script>window.location.href = "catus://post/post-id"</script>')
  })

  it("falls back to default post description and author profile image", async () => {
    prisma.post.findUniqueOrThrow.mockResolvedValue({
      content: "  ",
      author: {
        nickname: "momo",
        profileImageUrl: "users/author/profile.webp",
      },
      images: [],
    })

    const html = await service.getPostShareHtml(
      "post-id",
      "https://api.catus.app/share/post/post-id",
    )

    expect(html).toContain(
      '<meta property="og:description" content="캣어스에서 게시물을 확인해보세요." />',
    )
    expect(html).toContain(
      '<meta property="og:image" content="https://cdn.catus.app/users/author/profile.webp" />',
    )
  })

  it("builds user OG HTML and redirects to the user deep link", async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      nickname: "choco",
      followerCount: 12,
      profileImageUrl: "users/user-id/profile.webp",
    })

    const html = await service.getUserShareHtml(
      "user-id",
      "https://api.catus.app/share/user/user-id",
    )

    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "user-id" },
      select: {
        nickname: true,
        followerCount: true,
        profileImageUrl: true,
      },
    })
    expect(html).toContain('<meta property="og:title" content="@choco" />')
    expect(html).toContain('<meta property="og:description" content="팔로워 12명" />')
    expect(html).toContain(
      '<meta property="og:image" content="https://cdn.catus.app/users/user-id/profile.webp" />',
    )
    expect(html).toContain(
      '<meta property="og:url" content="https://api.catus.app/share/user/user-id" />',
    )
    expect(html).toContain('<meta http-equiv="refresh" content="0;url=catus://user/user-id" />')
    expect(html).toContain('<script>window.location.href = "catus://user/user-id"</script>')
  })

  it("escapes HTML-sensitive OG values", async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      nickname: `tom"&<cat>`,
      followerCount: 1,
      profileImageUrl: `users/user-id/profile"&<.webp`,
    })

    const html = await service.getUserShareHtml(
      "user-id",
      "https://api.catus.app/share/user/user-id",
    )

    expect(html).toContain('@tom&quot;&amp;&lt;cat&gt;')
    expect(html).toContain("profile&quot;&amp;&lt;.webp")
  })
})
