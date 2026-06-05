import { Module } from "@nestjs/common"
import { AuthModule } from "@app/auth/auth.module"
import { PrismaModule } from "@app/prisma/prisma.module"
import { StorageModule } from "@app/storage/storage.module"
import { NotificationService } from "./notification.service"
import { NotificationController } from "./notification.controller"

@Module({
  imports: [PrismaModule, AuthModule, StorageModule],
  providers: [NotificationService],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
