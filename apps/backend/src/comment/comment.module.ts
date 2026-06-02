import { Module } from "@nestjs/common"
import { CommentController, PostCommentController } from "./comment.controller"
import { CommentService } from "./comment.service"
import { PrismaModule } from "@app/prisma/prisma.module"
import { AuthModule } from "@app/auth/auth.module"
import { NotificationModule } from "@app/notification/notification.module"
import { StorageModule } from "@app/storage/storage.module"

@Module({
  imports: [PrismaModule, AuthModule, NotificationModule, StorageModule],
  controllers: [CommentController, PostCommentController],
  providers: [CommentService],
})
export class CommentModule {}
