import { Controller, Get, Header, Param } from "@nestjs/common"
import { ShareService } from "./share.service"

@Controller("share")
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Get("post/:id")
  @Header("Content-Type", "text/html")
  getPostShareHtml(@Param("id") id: string) {
    return this.shareService.getPostShareHtml(id)
  }

  @Get("user/:id")
  @Header("Content-Type", "text/html")
  getUserShareHtml(@Param("id") id: string) {
    return this.shareService.getUserShareHtml(id)
  }
}
