import { Controller, Get, Header, Param, Req } from "@nestjs/common"
import type { Request } from "express"
import { ShareService } from "./share.service"

@Controller("share")
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Get("post/:id")
  @Header("Content-Type", "text/html")
  getPostShareHtml(@Param("id") id: string, @Req() req: Request) {
    return this.shareService.getPostShareHtml(id, this.getShareUrl(req))
  }

  @Get("user/:id")
  @Header("Content-Type", "text/html")
  getUserShareHtml(@Param("id") id: string, @Req() req: Request) {
    return this.shareService.getUserShareHtml(id, this.getShareUrl(req))
  }

  private getShareUrl(req: Request) {
    const protocol = this.getForwardedValue(req, "x-forwarded-proto") ?? req.protocol
    const host =
      this.getForwardedValue(req, "x-forwarded-host") ?? req.get("host") ?? req.hostname

    return `${protocol}://${host}${req.originalUrl}`
  }

  private getForwardedValue(req: Request, header: string) {
    return req
      .get(header)
      ?.split(",")[0]
      ?.trim()
  }
}
