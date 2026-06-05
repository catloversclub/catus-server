import {
  Body,
  Controller,
  Delete,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common"
import { JwtAuthGuard } from "@app/auth/guards/jwt-auth.guard"
import type { AuthenticatedRequest } from "@app/auth/authenticated-request.interface"
import { RegisterPushTokenDto } from "./dto/register-push-token.dto"
import { UpdatePushTokenDto } from "./dto/update-push-token.dto"
import { NotificationService } from "./notification.service"

@Controller("notification")
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post("push-token")
  registerPushToken(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.notificationService.registerPushToken(req.user.id!, dto.token, dto.platform)
  }

  @Get()
  getNotifications(
    @Req() req: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take?: number,
  ) {
    return this.notificationService.getNotifications(req.user.id!, cursor ?? null, take)
  }

  @Delete(":id")
  deleteNotification(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.notificationService.deleteNotification(req.user.id!, id)
  }

  @Get("push-token/:token")
  getPushToken(@Req() req: AuthenticatedRequest, @Param("token") token: string) {
    return this.notificationService.getPushToken(req.user.id!, token)
  }

  @Patch("push-token/:token")
  updatePushToken(
    @Req() req: AuthenticatedRequest,
    @Param("token") token: string,
    @Body() dto: UpdatePushTokenDto,
  ) {
    return this.notificationService.updatePushToken(req.user.id!, token, dto.enabled)
  }

  @Post("test")
  sendDevTestPush() {
    return this.notificationService.sendDevTestNotificationToAllTokens()
  }
}
