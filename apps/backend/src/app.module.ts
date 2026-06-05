import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { PrismaModule } from "./prisma/prisma.module"
import { AuthModule } from "./auth/auth.module"
import { UserModule } from "./user/user.module"
import { CatModule } from "./cat/cat.module"
import { StorageModule } from "./storage/storage.module"
import { APP_FILTER } from "@nestjs/core"
import { PrismaExceptionFilter } from "./common/filters/prisma-exception.filter"
import { PostModule } from "./post/post.module"
import { CommentModule } from "./comment/comment.module"
import { AttributeModule } from "./attribute/attribute.module"
import { SearchModule } from "./search/search.module"
import { NotificationModule } from "./notification/notification.module"
import { ShareModule } from "./share/share.module"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    StorageModule,
    UserModule,
    CatModule,
    PostModule,
    CommentModule,
    AttributeModule,
    SearchModule,
    NotificationModule,
    ShareModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: PrismaExceptionFilter }],
})
export class AppModule {}
