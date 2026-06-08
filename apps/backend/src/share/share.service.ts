import { Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "@app/prisma/prisma.service"
import { StorageService } from "@app/storage/storage.service"

type RedirectHtmlOptions = {
  title: string
  description: string
  imageUrl: string
  ogUrl: string
  redirectUrl: string
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

@Injectable()
export class ShareService {
  private static readonly DEFAULT_POST_DESCRIPTION = "캣어스에서 게시물을 확인해보세요."

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async getPostShareHtml(id: string, shareUrl: string) {
    const encodedId = encodeURIComponent(id)
    const post = await this.prisma.post.findUniqueOrThrow({
      where: { id },
      select: {
        content: true,
        isShareable: true,
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

    if (post.isShareable === false) {
      throw new NotFoundException("post not found")
    }

    return this.buildRedirectHtml({
      title: `@${post.author.nickname}님의 게시물`,
      description: post.content?.trim() || ShareService.DEFAULT_POST_DESCRIPTION,
      imageUrl: this.toPublicUrl(post.images[0]?.url ?? post.author.profileImageUrl),
      ogUrl: shareUrl,
      redirectUrl: `catus://post/${encodedId}`,
    })
  }

  async getUserShareHtml(id: string, shareUrl: string) {
    const encodedId = encodeURIComponent(id)
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        nickname: true,
        followerCount: true,
        profileImageUrl: true,
      },
    })

    return this.buildRedirectHtml({
      title: `@${user.nickname}`,
      description: `팔로워 ${user.followerCount}명`,
      imageUrl: this.toPublicUrl(user.profileImageUrl),
      ogUrl: shareUrl,
      redirectUrl: `catus://user/${encodedId}`,
    })
  }

  private buildRedirectHtml(options: RedirectHtmlOptions) {
    const title = this.escapeHtml(options.title)
    const description = this.escapeHtml(options.description)
    const imageUrl = this.escapeHtml(options.imageUrl)
    const ogUrl = this.escapeHtml(options.ogUrl)
    const redirectUrl = this.escapeHtml(options.redirectUrl)
    const scriptRedirectUrl = JSON.stringify(options.redirectUrl)

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:url" content="${ogUrl}" />
  <meta http-equiv="refresh" content="0;url=${redirectUrl}" />
</head>
<body>
  <script>window.location.href = ${scriptRedirectUrl}</script>
</body>
</html>`
  }

  private toPublicUrl(value: string | null | undefined) {
    return this.storage.getPublicUrl(value) ?? ""
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char])
  }
}
